/**
 * Reflux stores for keeping all the user data.
 *
 * Using it in multiple components helps with keeping whole application up to
 * date and avoids making unnecessary calls to Backend.
 *
 * It is tightly connected to actions and the most kosher way of handling data
 * would be to trigger Backend calls through actions but to observe the results
 * throught stores not actions callbacks (for applicable stores of course - not
 * every action is connected to a store).
 *
 * TODO: it would be best to split these to separate files within `jsapp/js/stores`
 * directory and probably import all of them here and keep this file as a single
 * source for all stores(?).
 */

import Reflux from 'reflux';
import {Cookies} from 'react-cookie';
import clonedeep from 'lodash.clonedeep';
import dkobo_xlform from '../xlform/src/_xlform.init';
import {parsed, parseTags} from './assetParserUtils';
import {actions} from './actions';
import {
  log,
  notify,
  assign,
} from 'utils';

const cookies = new Cookies();

function changes(orig_obj, new_obj) {
  var out = {},
      any = false;
  Object.keys(new_obj).forEach(function(key) {
    if (orig_obj[key] !== new_obj[key]) {
      out[key] = new_obj[key];
      any = true;
    }
  });
  if (!any) {
    return false;
  }
  return out;
}

export var stores = {};

stores.tags = Reflux.createStore({
  init () {
    this.queries = {};
    this.listenTo(actions.resources.listTags.completed, this.listTagsCompleted);
  },
  listTagsCompleted (data) {
    this.trigger(data.results);
  }
});

const MAX_SEARCH_AGE = (5 * 60); // seconds

stores.surveyState = Reflux.createStore({
  init () {
    this.state = {};
  },
  setState (state) {
    var chz = changes(this.state, state);
    if (chz) {
      assign(this.state, state);
      this.trigger(chz);
    }
  },
});

stores.assetSearch = Reflux.createStore({
  init () {
    this.queries = {};
    this.listenTo(actions.search.assets.completed, this.onSearchAssetsCompleted);
  },
  getRecentSearch (queryString) {
    if (queryString in this.queries) {
      var age = new Date().getTime() - this.queries[queryString][1].getTime();
      if (age < MAX_SEARCH_AGE * 1000) {
        return this.queries[queryString][0];
      }
    }
    return false;
  },
  onSearchAssetsCompleted (searchData, response) {
    response.query = searchData.q;
    this.queries[searchData.q] = [response, new Date()];
    if(response.count > 0) {
      this.trigger(response);
    }
  }
});

stores.translations = Reflux.createStore({
  init() {
    this.state = {
      isTranslationTableUnsaved: false
    }
  },
  setState (change) {
    const changed = changes(this.state, change);
    if (changed) {
      assign(this.state, changed);
      this.trigger(changed);
    }
  },
  setTranslationTableUnsaved (isUnsaved) {
    this.setState({
      isTranslationTableUnsaved: isUnsaved
    });
  },
});

stores.pageState = Reflux.createStore({
  init () {
    this.state = {
      assetNavExpanded: false,
      showFixedDrawer: false
    };
  },
  setState (chz) {
    var changed = changes(this.state, chz);
    if (changed) {
      assign(this.state, changed);
      this.trigger(changed);
    }
  },
  toggleFixedDrawer () {
    var _changes = {};
    var newval = !this.state.showFixedDrawer;
    _changes.showFixedDrawer = newval;
    assign(this.state, _changes);
    this.trigger(_changes);
  },
  showModal (params) {
    this.setState({
      modal: params
    });
  },
  hideModal () {
    if (this._onHideModal) {
      this._onHideModal();
    }
    this.setState({
      modal: false
    });
  },
  // use it when you have one modal opened and want to display different one
  // because just calling showModal has weird outcome
  switchModal (params) {
    this.hideModal();
    // HACK switch to setState callback after updating to React 16+
    window.setTimeout(() => {
      this.showModal(params);
    }, 0);
  },
  switchToPreviousModal() {
    this.switchModal({
      type: this.state.modal.previousType
    });
  },
  hasPreviousModal() {
    return this.state.modal && this.state.modal.previousType;
  }
});

stores.snapshots = Reflux.createStore({
  init () {
    this.listenTo(actions.resources.createSnapshot.completed, this.snapshotCreated);
    this.listenTo(actions.resources.createSnapshot.failed, this.snapshotCreationFailed);
  },
  snapshotCreated (snapshot) {
    this.trigger(assign({success: true}, snapshot));
  },
  snapshotCreationFailed (jqxhr) {
    this.trigger(assign({success: false}, jqxhr.responseJSON));
  },
});

stores.asset = Reflux.createStore({
  init: function () {
    this.data = {};
    this.listenTo(actions.resources.loadAsset.completed, this.onLoadAssetCompleted);
    this.listenTo(actions.resources.updateAsset.completed, this.onUpdateAssetCompleted);
  },

  onUpdateAssetCompleted: function (resp/*, req, jqhr*/){
    this.data[resp.uid] = parsed(resp);
    this.trigger(this.data, resp.uid, {asset_updated: true});
  },
  onLoadAssetCompleted: function (resp/*, req, jqxhr*/) {
    if (!resp.uid) {
      throw new Error('no uid found in response');
    }
    this.data[resp.uid] = parsed(resp);
    this.trigger(this.data, resp.uid);
  }
});

stores.session = Reflux.createStore({
  init() {
    this.listenTo(actions.auth.getEnvironment.completed, this.triggerEnv);
    this.listenTo(actions.auth.verifyLogin.loggedin, this.triggerLoggedIn);
    this.listenTo(actions.auth.verifyLogin.anonymous, (data)=>{
      log('login confirmed anonymous', data.message);
    });
    this.listenTo(actions.auth.verifyLogin.failed, (xhr)=> {
      log('login not verified', xhr.status, xhr.statusText);
    });
    actions.auth.verifyLogin();
    actions.auth.getEnvironment();
  },
  getInitialState() {
    return {
      isLoggedIn: false,
      sessionIsLoggedIn: false
    };
  },
  triggerEnv(environment) {
    const nestedArrToChoiceObjs = (i) => {
      return {
        value: i[0],
        label: i[1],
      };
    };
    if (environment.available_sectors) {
      environment.available_sectors = environment.available_sectors.map(
        nestedArrToChoiceObjs);
    }
    if (environment.available_countries) {
      environment.available_countries = environment.available_countries.map(
        nestedArrToChoiceObjs);
    }
    if (environment.interface_languages) {
      environment.interface_languages = environment.interface_languages.map(
        nestedArrToChoiceObjs);
    }
    if (environment.all_languages) {
      environment.all_languages = environment.all_languages.map(
        nestedArrToChoiceObjs);
    }
    this.environment = environment;
    this.trigger({environment: environment});
  },
  triggerLoggedIn(acct) {
    this.currentAccount = acct;
    this.trigger({
      isLoggedIn: true,
      sessionIsLoggedIn: true,
      sessionAccount: acct,
      currentAccount: acct
    });
  }
});

stores.assetContent = Reflux.createStore({
  init: function () {
    this.data = {};
    this.surveys = {};
    this.listenTo(actions.resources.loadAssetContent.completed, this.onLoadAssetContentCompleted);
  },
  onLoadAssetContentCompleted: function(resp/*, req, jqxhr*/) {
    this.data[resp.uid] = resp;
    this.trigger(this.data, resp.uid);
  },
});

stores.surveyCompanion = Reflux.createStore({
  init () {
    this.listenTo(actions.survey.addExternalItemAtPosition, this.addExternalItemAtPosition);
  },
  addExternalItemAtPosition ({position, survey, uid, groupId}) {
    // `survey` is what's currently open in the form builder
    // `uid` identifies the library item being added to `survey`
    stores.allAssets.whenLoaded(uid, function(asset){
      // `asset` is the library item being added to `survey`
      // be careful not to mutate it, becuase it's kept in a store and not
      // re-fetched from the server each time it's loaded
      let assetCopy = clonedeep(asset);
      // `loadDict()` will mutate its first argument; see `inputParser.parse()`
      let _s = dkobo_xlform.model.Survey.loadDict(assetCopy.content, survey)
      survey.insertSurvey(_s, position, groupId);
    });
  }
})

stores.allAssets = Reflux.createStore({
  init() {
    this.data = [];
    this.byUid = {};
    this._waitingOn = {};

    this.listenTo(actions.search.assets.completed, this.onListAssetsCompleted);
    this.listenTo(actions.search.assets.failed, this.onListAssetsFailed);
    this.listenTo(actions.resources.updateAsset.completed, this.onUpdateAssetCompleted);
    this.listenTo(actions.resources.deleteAsset.completed, this.onDeleteAssetCompleted);
    this.listenTo(actions.resources.cloneAsset.completed, this.onCloneAssetCompleted);
    this.listenTo(actions.resources.loadAsset.completed, this.onLoadAssetCompleted);
  },
  whenLoaded (uid, cb) {
    if (typeof uid !== 'string' || typeof cb !== 'function') {
      return;
    }

    if (this.byUid[uid] && this.byUid[uid].content) {
      cb.call(this, this.byUid[uid]);
    } else {
      if (!this._waitingOn[uid]) {
        this._waitingOn[uid] = [];
      }
      this._waitingOn[uid].push(cb);
      actions.resources.loadAsset({id: uid});
    }
  },
  onUpdateAssetCompleted (asset) {
    this.registerAsset(asset);
    this.data.forEach((dataAsset, index) => {
      if (dataAsset.uid === asset.uid) {
        this.data[index] = asset;
      }
    });
  },
  onLoadAssetCompleted (asset) {
    this.registerAsset(asset);
  },
  onCloneAssetCompleted (asset) {
    this.registerAsset(asset);
    this.byUid[asset.uid] = asset;
    this.data.unshift(asset);
    this.trigger(this.data);
  },
  onDeleteAssetCompleted (asset) {
    if (this.byUid[asset.uid]) {
      this.byUid[asset.uid].deleted = 'true';
      this.trigger(this.data);
      window.setTimeout(()=> {
        this.data = this.data.filter(function(item){
          return item.uid !== asset.uid;
        });
        this.trigger(this.data);
      }, 500);
    }
  },
  registerAsset (asset) {
    const parsedObj = parseTags(asset);
    asset.tags = parsedObj.tags;
    this.byUid[asset.uid] = asset;
    if (asset.content) {
      this.callCallbacks(asset);
    }
  },
  callCallbacks (asset) {
    if (this._waitingOn[asset.uid]) {
      while (this._waitingOn[asset.uid].length > 0) {
        var cb = this._waitingOn[asset.uid].pop();
        cb.call(this, asset);
      }
    }
  },
  onListAssetsCompleted: function(searchData, response) {
    response.results.forEach(this.registerAsset);
    this.data = response.results;
    this.trigger(this.data);
  },
  onListAssetsFailed: function (searchData, response) {
    notify(response.responseJSON.detail || t('failed to list assets'));
  }
});

stores.selectedAsset = Reflux.createStore({
  init () {
    this.uid = cookies.get('selectedAssetUid');
    this.listenTo(actions.resources.cloneAsset.completed, this.onCloneAssetCompleted);
  },
  onCloneAssetCompleted (asset) {
    this.uid = asset.uid;
    this.asset = stores.allAssets.byUid[asset.uid];
    if (!this.asset) {
      console.error('selectedAssetStore error');
    }
    this.trigger(this.asset);
  },
  toggleSelect (uid, forceSelect=false) {
    if (forceSelect || this.uid !== uid) {
      this.uid = uid;
      this.asset = stores.allAssets.byUid[uid];
    } else {
      this.uid = false;
      this.asset = {};
    }
    cookies.set('selectedAssetUid', this.uid);
    this.trigger({
      selectedAssetUid: this.uid,
    });
    return this.uid !== false;
  }
});

stores.userExists = Reflux.createStore({
  init () {
    this.checked = {};
    this.listenTo(actions.misc.checkUsername.completed, this.usernameExists);
    this.listenTo(actions.misc.checkUsername.failed, this.usernameDoesntExist);
  },
  checkUsername (username) {
    if (username in this.checked) {
      return this.checked[username];
    }
  },
  usernameExists (username) {
    this.checked[username] = true;
    this.trigger(this.checked, username);
  },
  usernameDoesntExist (username) {
    this.checked[username] = false;
    this.trigger(this.checked, username);
  }
});

stores.serverEnvironment = Reflux.createStore({
  init() {
    this.state = {};
    this.listenTo(actions.misc.getServerEnvironment.completed,
                  this.updateEnvironment);
  },
  setState (state) {
    var chz = changes(this.state, state);
    if (chz) {
      assign(this.state, state);
      this.trigger(chz);
    }
  },
  updateEnvironment(response) {
    this.setState(response);
  },
});