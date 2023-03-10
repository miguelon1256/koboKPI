# coding: utf-8
import json

import responses
from django.conf import settings
from django.urls import reverse
from ipaddress import ip_address
from rest_framework import status

from kpi.constants import INSTANCE_FORMAT_TYPE_JSON, INSTANCE_FORMAT_TYPE_XML
from kpi.exceptions import BadFormatException
from kpi.tests.kpi_test_case import KpiTestCase
from ..constants import HOOK_LOG_FAILED
from ..models import HookLog, Hook


class MockSSRFProtect(object):

    @staticmethod
    def _get_ip_address(url):
        return ip_address('1.2.3.4')


class HookTestCase(KpiTestCase):

    def setUp(self):
        self.client.login(username="someuser", password="someuser")
        self.asset = self.create_asset(
            "some_asset",
            content=json.dumps({'survey': [
                {'type': 'text', 'name': 'q1'},
                {'type': 'begin_group', 'name': 'group1'},
                {'type': 'text', 'name': 'q2'},
                {'type': 'text', 'name': 'q3'},
                {'type': 'end_group'},
                {'type': 'begin_group', 'name': 'group2'},
                {'type': 'begin_group', 'name': 'subgroup1'},
                {'type': 'text', 'name': 'q4'},
                {'type': 'text', 'name': 'q5'},
                {'type': 'text', 'name': 'q6'},
                {'type': 'end_group'},
                {'type': 'end_group'},
            ]}),
            format='json')
        self.asset.deploy(backend='mock', active=True)
        self.asset.save()
        self.hook = Hook()
        self._submission_pk = 1

        settings.CELERY_TASK_ALWAYS_EAGER = True

    def _create_hook(self, return_response_only=False, **kwargs):

        format_type = kwargs.get('format_type', INSTANCE_FORMAT_TYPE_JSON)

        if format_type == INSTANCE_FORMAT_TYPE_JSON:
            self.__prepare_json_submission()
            _asset = self.asset
        elif format_type == INSTANCE_FORMAT_TYPE_XML:
            self.__prepare_xml_submission()
            _asset = self.asset_xml
        else:
            raise BadFormatException(
                'The format {} is not supported'.format(format_type)
            )

        url = reverse('hook-list', kwargs={'parent_lookup_asset': _asset.uid})
        data = {
            'name': kwargs.get('name', 'some external service with token'),
            'endpoint': kwargs.get('endpoint', 'http://external.service.local/'),
            'settings': kwargs.get('settings', {
                'custom_headers': {
                    'X-Token': '1234abcd'
                }
            }),
            'export_type': format_type,
            'active': kwargs.get('active', True),
            'subset_fields': kwargs.get('subset_fields', []),
            'payload_template': kwargs.get('payload_template', None)
        }

        response = self.client.post(url, data, format='json')
        if return_response_only:
            return response
        else:
            self.assertEqual(response.status_code, status.HTTP_201_CREATED,
                             msg=response.data)
            hook = _asset.hooks.last()
            self.assertTrue(hook.active)
            return hook

    def _send_and_fail(self):
        """
        The public method which calls this method needs to be decorated by
        `@responses.activate`

        :return: dict
        """
        self.hook = self._create_hook()

        ServiceDefinition = self.hook.get_service_definition()
        submissions = self.asset.deployment.get_submissions(self.asset.owner.id)
        instance_id = submissions[0].get(self.asset.deployment.INSTANCE_ID_FIELDNAME)
        service_definition = ServiceDefinition(self.hook, instance_id)
        first_mock_response = {'error': 'not found'}

        # Mock first request's try
        responses.add(responses.POST, self.hook.endpoint,
                      json=first_mock_response, status=status.HTTP_404_NOT_FOUND)

        # Mock next requests' tries
        responses.add(responses.POST, self.hook.endpoint,
                      status=status.HTTP_200_OK,
                      content_type='application/json')

        # Try to send data to external endpoint
        success = service_definition.send()
        self.assertFalse(success)

        # Retrieve the corresponding log
        url = reverse('hook-log-list', kwargs={
            'parent_lookup_asset': self.hook.asset.uid,
            'parent_lookup_hook': self.hook.uid
        })

        response = self.client.get(url)
        first_hooklog_response = response.data.get('results')[0]

        # Result should match first try
        self.assertEqual(first_hooklog_response.get('status_code'), status.HTTP_404_NOT_FOUND)
        self.assertEqual(json.loads(first_hooklog_response.get('message')), first_mock_response)

        # Fakes Celery n retries by forcing status to `failed` (where n is `settings.HOOKLOG_MAX_RETRIES`)
        first_hooklog = HookLog.objects.get(uid=first_hooklog_response.get('uid'))
        first_hooklog.change_status(HOOK_LOG_FAILED)

        return first_hooklog_response

    def __prepare_json_submission(self):
        v_uid = self.asset.latest_deployed_version.uid
        submission = {
            '__version__': v_uid,
            'q1': u'??Qu?? tal?',
            'group1/q2': u'??C??mo est?? en el grupo uno la primera vez?',
            'group1/q3': u'??C??mo est?? en el grupo uno la segunda vez?',
            'group2/subgroup1/q4': u'??C??mo est?? en el subgrupo uno la primera vez?',
            'group2/subgroup1/q5': u'??C??mo est?? en el subgrupo uno la segunda vez?',
            'group2/subgroup1/q6': u'??C??mo est?? en el subgrupo uno la tercera vez?',
            'group2/subgroup11/q1': u'??C??mo est?? en el subgrupo once?',
            '_id': self._submission_pk
        }
        self.__inject_submission(self.asset, submission)

    def __prepare_xml_submission(self):
        v_uid = self.asset_xml.latest_deployed_version.uid
        submission = ('<{asset_uid}>'
                      '   <__version__>{v_uid}</__version__>'
                      '   <q1>??Qu?? tal?</q1>'
                      '   <group1>'
                      '      <q2>??C??mo est?? en el grupo uno la primera vez?</q2>'
                      '      <q3>??C??mo est?? en el grupo uno la segunda vez?</q3>'
                      '   </group1>'
                      '   <group2>'
                      '      <subgroup1>'
                      '          <q4>??C??mo est?? en el subgrupo uno la primera vez?</q4>'
                      '          <q5>??C??mo est?? en el subgrupo uno la segunda vez?</q5>'
                      '          <q6>??C??mo est?? en el subgrupo uno la tercera vez?</q6>'
                      '      </subgroup1>'
                      '      <subgroup11>'
                      '          <q1>??C??mo est?? en el subgrupo once?</q1>'
                      '      </subgroup11>'
                      '   </group2>'
                      '   <_id>{id}</_id>'
                      '</{asset_uid}>').format(
            asset_uid=self.asset_xml.uid,
            v_uid=v_uid,
            id=self._submission_pk
        )
        self.__inject_submission(self.asset_xml, submission)

    def __inject_submission(self, asset, submission):
        self._submission_pk += 1
        submissions = asset.deployment.get_submissions(asset.owner.id)
        submissions.append(submission)
        asset.deployment.mock_submissions(submissions)
