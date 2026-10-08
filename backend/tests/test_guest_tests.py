"""Guest tests perform stateless image work while clinical records remain private."""

import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import smoke_tests  # Configures an isolated database and storage before app loading.


class GuestTestAccess(unittest.TestCase):
    def setUp(self):
        self.app = smoke_tests.backend_app_module.app
        self.client = self.app.test_client()
        self.image = smoke_tests.encode_png_data_url(smoke_tests.build_sample_image())

    def test_anonymous_records_and_original_clinical_endpoints_stay_protected(self):
        for method, path in [('get', '/api/patients'), ('get', '/api/results'),
                             ('get', '/api/admin/dashboard'), ('post', '/api/predict'),
                             ('post', '/api/tear-meniscus/measure'), ('post', '/api/enhance')]:
            with self.subTest(path=path):
                self.assertEqual(getattr(self.client, method)(path).status_code, 401)

    def test_guest_status_does_not_load_models_or_reveal_server_paths(self):
        with patch('app.modules.meibography.service.ensure_meibography_service') as initialize:
            response = self.client.get('/api/guest/meibography/status')
        self.assertEqual(response.status_code, 200)
        self.assertIn('available', response.get_json())
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertNotIn('model_folder', response.get_json())
        initialize.assert_not_called()

    def test_guest_enhance_and_tear_measurements_are_real_and_do_not_write_files(self):
        folder = Path(self.app.config['UPLOAD_FOLDER'])
        before = set(folder.iterdir())
        enhanced = self.client.post('/api/guest/meibography/enhance', json={'image_data': self.image})
        self.assertEqual(enhanced.status_code, 200, enhanced.get_data(as_text=True))
        self.assertTrue(enhanced.get_json()['result']['enhanced_image_data'].startswith('data:image/png;base64,'))
        measured = self.client.post('/api/guest/meibography/tear-meniscus', json={
            'image_data': self.image, 'points': [{'x': .5, 'y': .5}, {'x': .5, 'y': .55}],
            'cornea_width_pixels': 100,
        })
        self.assertEqual(measured.status_code, 200, measured.get_data(as_text=True))
        result = measured.get_json()['result']
        self.assertAlmostEqual(result['tmh_mm'], 11.7 * result['distance_pixels'] / 100)
        self.assertTrue(result['annotated_image_data'].startswith('data:image/png;base64,'))
        self.assertEqual(set(folder.iterdir()), before)

    def test_guest_analysis_receives_only_validated_decoded_image(self):
        with patch('app.modules.meibography.guest.analyze_meibography_request', return_value=({'result': {'coverage_pct': 78}}, 200)) as analyze:
            response = self.client.post('/api/guest/meibography/analyze', json={'image_data': self.image, 'lid': 'lower'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['result']['coverage_pct'], 78)
        self.assertIsNotNone(analyze.call_args.kwargs['decoded_image'][0])
        self.assertTrue(response.get_json()['guest_preview'])

    def test_guest_never_accepts_patient_or_storage_references(self):
        for action in ('analyze', 'enhance', 'tear-meniscus'):
            for field in ('patient_id', 'image_url', 'file_path'):
                with self.subTest(action=action, field=field):
                    response = self.client.post(f'/api/guest/meibography/{action}', json={
                        'image_data': self.image, field: '/uploads/private.png',
                    })
                    self.assertEqual(response.status_code, 400)

    def test_unavailable_models_report_unavailable_without_fabricating_results(self):
        with patch('app.modules.meibography.service.get_model_status', return_value={'available': False, 'error': 'Models unavailable.'}):
            with patch('app.modules.meibography.service.ensure_meibography_service') as initialize:
                response = self.client.post('/api/guest/meibography/analyze', json={'image_data': self.image})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()['error'], 'Models unavailable.')
        self.assertNotIn('result', response.get_json())
        initialize.assert_not_called()

    def test_guest_image_pixel_limit_applies_before_full_decode(self):
        with patch('app.modules.meibography.guest.MAX_GUEST_PIXELS', 1000):
            with patch('app.utils.image_utils.cv2.imdecode') as full_decode:
                response = self.client.post('/api/guest/meibography/enhance', json={'image_data': self.image})
        self.assertEqual(response.status_code, 400)
        full_decode.assert_not_called()

    def test_invalid_points_and_oversized_request_reject_before_processing(self):
        with patch('app.modules.meibography.guest.decode_request_image') as decode:
            response = self.client.post('/api/guest/meibography/tear-meniscus', json={
                'image_data': self.image, 'points': [{'x': 2, 'y': 0}, {'x': .5, 'y': .5}],
            })
            self.assertEqual(response.status_code, 400)
            with patch('app.modules.meibography.guest.MAX_GUEST_REQUEST_BYTES', 16):
                response = self.client.post('/api/guest/meibography/enhance', json={'image_data': self.image})
            self.assertEqual(response.status_code, 413)
        decode.assert_not_called()

    def test_busy_guest_slot_returns_retry_and_recovers_after_invalid_input(self):
        slot = threading.BoundedSemaphore(1)
        with patch('app.modules.meibography.guest.GUEST_ANALYSIS_SLOT', slot):
            slot.acquire()
            response = self.client.post('/api/guest/meibography/enhance', json={'image_data': self.image})
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers['Retry-After'], '5')
            slot.release()
            self.assertEqual(self.client.post('/api/guest/meibography/enhance', json={}).status_code, 400)
            self.assertEqual(self.client.post('/api/guest/meibography/enhance', json={'image_data': self.image}).status_code, 200)


if __name__ == '__main__':
    unittest.main()
