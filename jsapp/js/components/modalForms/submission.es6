import React from 'react';
import autoBind from 'react-autobind';
import Reflux from 'reflux';
import alertify from 'alertifyjs';
import reactMixin from 'react-mixin';
import Select from 'react-select';
import enketoHandler from 'js/enketoHandler';
import {dataInterface} from 'js/dataInterface';
import {actions} from 'js/actions';
import mixins from 'js/mixins';
import {bem} from 'js/bem';
import {notify, launchPrinting} from 'utils';
import {stores} from 'js/stores';
import {
  VALIDATION_STATUSES_LIST,
  MODAL_TYPES,
  GROUP_TYPES_BEGIN,
  GROUP_TYPES_END
} from 'js/constants';
import SubmissionDataTable from 'js/components/submissionDataTable';
import Checkbox from 'js/components/common/checkbox';

const DETAIL_NOT_FOUND = '{\"detail\":\"Not found.\"}';

class Submission extends React.Component {
  constructor(props) {
    super(props);
    let translations = this.props.asset.content.translations,
        translationOptions = [];

    if (translations.length > 1) {
      translationOptions = translations.map((trns) => {
        return {
          value: trns,
          label: trns || t('Unnamed language')
        };
      });
    }

    this.state = {
      submission: {},
      loading: true,
      error: false,
      // For previous and next:
      // -1 means there is none,
      // -2 means there is but on different table page.
      previous: -1,
      next: -1,
      sid: props.sid,
      showBetaFieldsWarning: false,
      isEditLoading: false,
      isDuplicated: props.isDuplicated,
      duplicatedSubmission: props.duplicatedSubmission || null,
      isEditingDuplicate: false,
      promptRefresh: false,
      translationIndex: 0,
      translationOptions: translationOptions,
      showXMLNames: false
    };

    autoBind(this);
  }

  componentDidMount() {
    this.getSubmission(this.props.asset.uid, this.state.sid);
    this.listenTo(actions.resources.updateSubmissionValidationStatus.completed, this.refreshSubmissionValidationStatus);
    this.listenTo(actions.resources.removeSubmissionValidationStatus.completed, this.refreshSubmissionValidationStatus);
    this.listenTo(actions.resources.deleteSubmission.completed, this.onDeletedSubmissionCompleted);
  }

  refreshSubmissionValidationStatus(result) {
    if (result && result.uid) {
      this.state.submission._validation_status = result;
    } else {
      this.state.submission._validation_status = {};
    }
    this.setState({submission: this.state.submission});
  }

  isSubmissionEditable() {
    return this.props.asset.deployment__active && !this.state.isEditLoading;
  }

  getSubmission(assetUid, sid) {
    dataInterface.getSubmission(assetUid, sid).done((data) => {
      let prev = -1;
      let next = -1;

      if (this.props.ids && sid) {
        const c = this.props.ids.findIndex((k) => {return k === parseInt(sid);});
        let tableInfo = this.props.tableInfo || false;
        if (this.props.ids[c - 1]) {
          prev = this.props.ids[c - 1];
        }
        if (this.props.ids[c + 1]) {
          next = this.props.ids[c + 1];
        }

        // table submissions pagination
        if (tableInfo) {
          const nextAvailable = tableInfo.resultsTotal > (tableInfo.currentPage + 1) * tableInfo.pageSize;
          if (c + 1 === this.props.ids.length && nextAvailable) {
            next = -2;
          }

          if (tableInfo.currentPage > 0 && prev === -1) {
            prev = -2;
          }
        }
      }

      this.setState({
        submission: data,
        loading: false,
        next: next,
        previous: prev
      });
    }).fail((error) => {
      if (error.responseText) {
        let error_message = error.responseText;
        if (error_message === DETAIL_NOT_FOUND) {
          error_message = t('The submission could not be found. It may have been deleted. Submission ID: ##id##').replace('##id##', sid);
        }
        this.setState({error: error_message, loading: false});
      } else if (error.statusText) {
          this.setState({error: error.statusText, loading: false});
      } else {
        this.setState({error: t('Error: could not load data.'), loading: false});
      }
    });
  }

  componentWillReceiveProps(nextProps) {
    this.setState({
      sid: nextProps.sid,
      promptRefresh: false
    });

    this.getSubmission(nextProps.asset.uid, nextProps.sid);
  }

  deleteSubmission() {
    let dialog = alertify.dialog('confirm');
    let opts = {
      title: t('Delete submission?'),
      message: `${t('Are you sure you want to delete this submission?')} ${t('This action cannot be undone')}.`,
      labels: {ok: t('Delete'), cancel: t('Cancel')},
      onok: () => {
        actions.resources.deleteSubmission(this.props.asset.uid, this.props.sid);
      },
      oncancel: () => {
        dialog.destroy();
      }
    };
    dialog.set(opts).show();
  }

  onDeletedSubmissionCompleted() {
    stores.pageState.hideModal();
  }

  launchEditSubmission() {
    this.setState({
      promptRefresh: true,
      isEditLoading: true,
      isEditingDuplicate: true,
    });
    enketoHandler.editSubmission(this.props.asset.uid, this.state.sid).then(
      () => {this.setState({isEditLoading: false});},
      () => {this.setState({isEditLoading: false});}
    );
  }

  duplicateSubmission() {
    // Due to how modals are created, we must close this modal and recreate
    // an almost identical one to display the new submission with a different
    // title bar
    stores.pageState.hideModal();
    actions.resources.duplicateSubmission(this.props.asset.uid, this.state.sid, this.state.submission);
  }

  triggerRefresh() {
    this.getSubmission(this.props.asset.uid, this.props.sid);
    this.setState({
      promptRefresh: false
    });
    // Prompt table to refresh submission list
    actions.resources.refreshTableSubmissions();
  }

  switchSubmission(sid) {
    this.setState({ loading: true});
    stores.pageState.showModal({
      type: MODAL_TYPES.SUBMISSION,
      sid: sid,
      asset: this.props.asset,
      ids: this.props.ids,
      tableInfo: this.props.tableInfo || false
    });
  }

  prevTablePage() {
    this.setState({ loading: true});

    stores.pageState.showModal({
      type: MODAL_TYPES.SUBMISSION,
      sid: false,
      page: 'prev'
    });
  }

  nextTablePage() {
    this.setState({ loading: true});

    stores.pageState.showModal({
      type: MODAL_TYPES.SUBMISSION,
      sid: false,
      page: 'next'
    });
  }

  onShowXMLNamesChange(newValue) {
    this.setState({showXMLNames: newValue});
  }

  validationStatusChange(evt) {
    if (evt.value === null) {
      actions.resources.removeSubmissionValidationStatus(this.props.asset.uid, this.state.sid);
    } else {
      actions.resources.updateSubmissionValidationStatus(this.props.asset.uid, this.state.sid, {'validation_status.uid': evt.value});
    }
  }

  languageChange(e) {
    let index = this.state.translationOptions.findIndex((x) => {return x === e;});
    this.setState({
      translationIndex: index || 0
    });
  }

  render() {
    if (this.state.loading) {
      return (
        <bem.Loading>
          <bem.Loading__inner>
            <i />
            {t('loading...')}
          </bem.Loading__inner>
        </bem.Loading>
      );
    }

    if (this.state.error) {
      return (
        <bem.Loading>
          <bem.Loading__inner>
            {this.state.error}
          </bem.Loading__inner>
        </bem.Loading>
      );
    }

    const s = this.state.submission;
    let translationOptions = this.state.translationOptions;

    // Use this modal if we just duplicated a submission, but not if we are
    // editing it
    if (this.state.isDuplicated && !this.state.isEditingDuplicate) {
      return(
        <bem.FormModal>
          <h1 className='submission-duplicate__header'>{t('Duplicate created')}</h1>
          <p className='submission-duplicate__text'>
            {t('A duplicate of the submission record was successfully created. You can view the new instance below and make changes using the action buttons below.')}
            <br/>
            <br/>
            {t('Source submission uuid:' + ' ')}
            <code>{this.state.duplicatedSubmission._uuid}</code>
          </p>
          <bem.FormModal__group>
            <div className='submission-duplicate__actions'>
              {this.userCan('change_submissions', this.props.asset) &&
                <a
                  onClick={this.launchEditSubmission.bind(this)}
                  className='kobo-button kobo-button--blue'
                  disabled={!this.isSubmissionEditable()}
                >
                  {this.state.isEditLoading && t('Loading…')}
                  {!this.state.isEditLoading && t('Edit')}
                </a>
              }

              {this.userCan('delete_submissions', this.props.asset) &&
                <a
                  onClick={this.deleteSubmission}
                  className='kobo-button kobo-button--red submission-duplicate__button'
                  data-tip={t('Discard duplicated submission')}
                >
                  {t('Discard')}
                </a>
              }
            </div>
          </bem.FormModal__group>

          {this.props.asset.deployment__active &&
            <bem.FormModal__group>
              {translationOptions.length > 1 &&
                <div className='switch--label-language'>
                  <label>{t('Language:')}</label>
                  <Select
                    isClearable={false}
                    value={translationOptions[this.state.translationIndex]}
                    options={translationOptions}
                    onChange={this.languageChange}
                    className='kobo-select'
                    classNamePrefix='kobo-select'
                    menuPlacement='auto'
                  />
                </div>
              }
              <div className='switch--validation-status'>
                <label>{t('Validation status:')}</label>
                <Select
                  isDisabled={!this.userCan('validate_submissions', this.props.asset)}
                  isClearable={false}
                  value={s._validation_status && s._validation_status.uid ? s._validation_status : false}
                  options={VALIDATION_STATUSES_LIST}
                  onChange={this.validationStatusChange}
                  className='kobo-select'
                  classNamePrefix='kobo-select'
                  menuPlacement='auto'
                />
              </div>
            </bem.FormModal__group>
          }

          <SubmissionDataTable
            asset={this.props.asset}
            submissionData={this.state.submission}
            translationIndex={this.state.translationIndex}
            showXMLNames={this.state.showXMLNames}
          />
        </bem.FormModal>
      );
    }

    // Use this modal if we are not viewing a duplicate, or we are editing one
    if (!this.state.isDuplicated || this.state.isEditingDuplicate) {
      return (
        <bem.FormModal>
          {this.state.promptRefresh &&
            <div className='submission--warning'>
              <p>{t('Click on the button below to load the most recent data for this submission. ')}</p>
              <a onClick={this.triggerRefresh} className='kobo-button kobo-button--blue'>
                {t('Refresh submission')}
              </a>
            </div>
          }

          {this.props.asset.deployment__active &&
            <bem.FormModal__group>
              {translationOptions.length > 1 &&
                <div className='switch--label-language'>
                  <label>{t('Language:')}</label>
                  <Select
                    isClearable={false}
                    value={translationOptions[this.state.translationIndex]}
                    options={translationOptions}
                    onChange={this.languageChange}
                    className='kobo-select'
                    classNamePrefix='kobo-select'
                    menuPlacement='auto'
                  />
                </div>
              }
              <div className='switch--validation-status'>
                <label>{t('Validation status:')}</label>
                <Select
                  isDisabled={!this.userCan('validate_submissions', this.props.asset)}
                  isClearable={false}
                  value={s._validation_status && s._validation_status.uid ? s._validation_status : false}
                  options={VALIDATION_STATUSES_LIST}
                  onChange={this.validationStatusChange}
                  className='kobo-select'
                  classNamePrefix='kobo-select'
                  menuPlacement='auto'
                />
              </div>
            </bem.FormModal__group>
          }

          <bem.FormModal__group>

            {this.state.isEditingDuplicate &&
              <div className='preserveFlexCSS'/>
            }

            {!this.state.isEditingDuplicate &&
              <div className='submission-pager'>
                {/* don't display previous button if `previous` is -1 */}
                {this.state.previous > -1 &&
                  <a
                    onClick={this.switchSubmission.bind(this, this.state.previous)}
                    className='mdl-button mdl-button--colored'
                  >
                    <i className='k-icon k-icon-prev' />
                    {t('Previous')}
                  </a>
                }
                {this.state.previous === -2 &&
                  <a
                    onClick={this.prevTablePage}
                    className='mdl-button mdl-button--colored'
                  >
                    <i className='k-icon k-icon-prev' />
                    {t('Previous')}
                  </a>
                }

                {/* don't display next button if `next` is -1 */}
                {this.state.next > -1 &&
                  <a
                    onClick={this.switchSubmission.bind(this, this.state.next)}
                    className='mdl-button mdl-button--colored'
                  >
                    {t('Next')}
                    <i className='k-icon-next' />
                  </a>
                }
                {this.state.next === -2 &&
                  <a
                    onClick={this.nextTablePage}
                    className='mdl-button mdl-button--colored'
                  >
                    {t('Next')}
                    <i className='k-icon-next' />
                  </a>
                }
              </div>
            }

            <div className='submission-actions'>
              <Checkbox
                checked={this.state.showXMLNames}
                onChange={this.onShowXMLNamesChange}
                label={t('Display XML names')}
              />

              {this.userCan('change_submissions', this.props.asset) &&
                <a
                  onClick={this.launchEditSubmission.bind(this)}
                  className='kobo-button kobo-button--blue submission-duplicate__button'
                  disabled={!this.isSubmissionEditable()}
                >
                  {this.state.isEditLoading && t('Loading…')}
                  {!this.state.isEditLoading && t('Edit')}
                </a>
              }

              {this.userCan('change_submissions', this.props.asset) &&
                <a
                  onClick={this.duplicateSubmission.bind(this)}
                  className='kobo-button kobo-button--blue submission-duplicate__button'
                  disabled={!this.isSubmissionEditable()}
                >
                  {t('Duplicate')}
                </a>
              }

              <bem.Button m='icon' className='report-button__print'
                      onClick={launchPrinting}
                      data-tip={t('Print')}>
                <i className='k-icon-print' />
              </bem.Button>

              {this.userCan('delete_submissions', this.props.asset) &&
                <a
                  onClick={this.deleteSubmission}
                  className='mdl-button mdl-button--icon mdl-button--colored mdl-button--red right-tooltip'
                  data-tip={t('Delete submission')}
                >
                  <i className='k-icon-trash' />
                </a>
              }
            </div>
          </bem.FormModal__group>

          <SubmissionDataTable
            asset={this.props.asset}
            submissionData={this.state.submission}
            translationIndex={this.state.translationIndex}
            showXMLNames={this.state.showXMLNames}
          />
        </bem.FormModal>
      );
    }
  }
}

reactMixin(Submission.prototype, Reflux.ListenerMixin);
reactMixin(Submission.prototype, mixins.permissions);

export default Submission;
