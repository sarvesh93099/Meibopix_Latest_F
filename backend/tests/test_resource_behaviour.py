"""Regression checks for bounded processing and optional ML startup."""

import base64
import sys
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import smoke_tests  # noqa: E402 - configures isolated storage/database before app import
from app.utils.image_utils import auto_enhance_image, decode_request_image  # noqa: E402
from app.services.storage_service import save_storage_bytes  # noqa: E402


class ResourceBehaviourTests(unittest.TestCase):
    def setUp(self):
        self.app = smoke_tests.backend_app_module.app
        self.client = self.app.test_client()
        response = self.client.post('/api/auth/login', json={
            'username': 'smoke-admin',
            'password': 'smoke-password',
        })
        self.assertEqual(response.status_code, 200)

    def test_status_probe_does_not_initialize_segmentation(self):
        before = 'torch' in sys.modules
        with patch('app.modules.meibography.service.ensure_meibography_service') as initialize:
            response = self.client.get('/api/model/status')
        self.assertEqual(response.status_code, 200)
        self.assertIn('available', response.get_json())
        self.assertTrue(response.get_json()['load_on_first_analysis'])
        initialize.assert_not_called()
        self.assertEqual('torch' in sys.modules, before)

    def test_contrast_summary_preserves_selected_test_name(self):
        for field in ('testName', 'test_name'):
            with self.subTest(field=field):
                response = self.client.post('/api/clinical/contrast-sensitivity', json={
                    field: 'Cataract', 'rows': {},
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json()['result']['test_name'], 'Cataract')

    def test_enhancement_preserves_measurement_geometry(self):
        source = smoke_tests.build_sample_image(480, 360)
        enhanced = auto_enhance_image(source)
        self.assertEqual(enhanced.shape, source.shape)
        self.assertEqual(enhanced.dtype, np.uint8)
        self.assertFalse(np.array_equal(source, enhanced))

    def test_large_enhancement_bounds_working_plane(self):
        source = smoke_tests.build_sample_image(1000, 750)
        bounded_clahe = Mock(wraps=cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)))
        with self.app.app_context(), patch.dict(self.app.config, {'IMAGE_PROCESSING_MAX_DIMENSION': 256}):
            with patch('app.utils.image_utils.cv2.createCLAHE', return_value=bounded_clahe):
                enhanced = auto_enhance_image(source)
        self.assertEqual(enhanced.shape, source.shape)
        processed_plane = bounded_clahe.apply.call_args.args[0]
        self.assertLessEqual(max(processed_plane.shape), 256)

    def test_multipart_image_limit_returns_413(self):
        ok, encoded = cv2.imencode('.png', smoke_tests.build_sample_image())
        self.assertTrue(ok)
        with patch.dict(self.app.config, {'MAX_IMAGE_UPLOAD_BYTES': 64}):
            response = self.client.post('/api/upload', data={
                'file': (BytesIO(encoded.tobytes()), 'bounded-image.png'),
            }, content_type='multipart/form-data')
        self.assertEqual(response.status_code, 413)

    def test_report_upload_limit_returns_413(self):
        patient_response = self.client.post('/api/patients', json={
            'full_name': 'Resource Test Patient', 'age': 28,
            'mobile': '9999999999', 'gender': 'Other',
        })
        self.assertEqual(patient_response.status_code, 201)
        with patch.dict(self.app.config, {'MAX_REPORT_UPLOAD_BYTES': 64}):
            response = self.client.post('/api/results', data={
                'kind': 'report', 'patient_id': str(patient_response.get_json()['id']),
                'file': (BytesIO(b'%PDF-1.4\n' + b'x' * 1024), 'bounded-report.pdf'),
            }, content_type='multipart/form-data')
        self.assertEqual(response.status_code, 413)

    def test_rapid_image_uploads_keep_distinct_files(self):
        ok, encoded = cv2.imencode('.png', smoke_tests.build_sample_image())
        self.assertTrue(ok)
        saved_names = []
        for _ in range(2):
            response = self.client.post('/api/upload', data={
                'file': (BytesIO(encoded.tobytes()), 'same-image.png'),
            }, content_type='multipart/form-data')
            self.assertEqual(response.status_code, 200)
            saved_names.append(response.get_json()['file_path'])
        self.assertNotEqual(saved_names[0], saved_names[1])

    def test_image_pixel_limit_rejects_before_full_decode(self):
        source = smoke_tests.build_sample_image(160, 120)
        payload = {'image_data': smoke_tests.encode_png_data_url(source)}
        with self.app.app_context(), patch.dict(self.app.config, {'MAX_IMAGE_PIXELS': 1000}):
            with patch('app.utils.image_utils.cv2.imdecode') as fallback_decoder:
                with self.assertRaisesRegex(ValueError, 'limits|resolution'):
                    decode_request_image(payload)
        fallback_decoder.assert_not_called()

    def test_image_byte_limit_rejects_encoded_payload(self):
        payload = {'image_data': 'data:image/png;base64,' + base64.b64encode(b'x' * 2048).decode('ascii')}
        with self.app.app_context(), patch.dict(self.app.config, {'MAX_IMAGE_UPLOAD_BYTES': 1024}):
            with self.assertRaisesRegex(ValueError, 'too large'):
                decode_request_image(payload)

    def test_invalid_image_returns_clear_validation_error(self):
        response = self.client.post('/api/enhance', json={'image_data': 'data:image/png;base64,bm90LWFuLWltYWdl'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.get_json())

    def test_local_download_uses_range_response(self):
        payload = b'%PDF-1.4\n' + b'demo-report' * 1000
        with self.app.app_context():
            save_storage_bytes('report', 'resource-range.pdf', payload)
        response = self.client.get('/reports/resource-range.pdf', headers={'Range': 'bytes=0-7'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, payload[:8])
        self.assertIn('bytes 0-7/', response.headers['Content-Range'])
        response.close()


if __name__ == '__main__':
    unittest.main()
