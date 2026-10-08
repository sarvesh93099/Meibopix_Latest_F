"""Basic pre-deployment smoke tests for the backend API, ML models, and image processing."""

import argparse
import atexit
import base64
import importlib.util
import os
import shutil
import sys
import unittest
import uuid
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np


BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
EXPECTED_MODEL_FILES = (
    'best_lower_eyelid_effb5.pth',
    'best_lower_meibo_effb5.pth',
    'best_upper_eyelid_effb5_unet.pth',
    'best_upper_meibo_effb5_unet.pth',
)
SMOKE_RUNTIME_PARENT = BACKEND_DIR / '.smoke_runtime'
SMOKE_RUNTIME_PARENT.mkdir(parents=True, exist_ok=True)
RUNTIME_ROOT = SMOKE_RUNTIME_PARENT / f'meibography-smoke-{uuid.uuid4().hex[:8]}'
RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)


def configure_test_environment():
    env_values = {
        'SECRET_KEY': 'smoke-test-secret-key',
        'APP_ENV': 'development',
        'AUTH_BOOTSTRAP_USERNAME': 'smoke-admin',
        'AUTH_BOOTSTRAP_PASSWORD': 'smoke-password',
        'AUTH_ADMIN_USERNAME': '',
        'AUTH_ADMIN_PASSWORD': '',
        'ADMIN_USERNAME': '',
        'ADMIN_PASSWORD': '',
        'AUTH_ENABLE_2FA': 'false',
        'DEBUG': 'false',
        'ENFORCE_HTTPS': 'false',
        'SESSION_COOKIE_SECURE': 'false',
        'AUTH_COOKIE_SAMESITE': 'Lax',
        'ENABLE_CAMERA': 'false',
        'STORAGE_BACKEND': 'local',
        'DATABASE_URL': f"sqlite:///{(RUNTIME_ROOT / 'smoke.db').as_posix()}",
        'UPLOAD_FOLDER': str(RUNTIME_ROOT / 'uploads'),
        'REPORT_FOLDER': str(RUNTIME_ROOT / 'reports'),
        'MODEL_PATH': str(BACKEND_DIR / 'meibography_models'),
        'FRONTEND_DIST_DIR': str(REPO_ROOT / 'frontend' / 'dist'),
        'APP_LOG_FILE': '',
    }

    for key, value in env_values.items():
        os.environ[key] = value


configure_test_environment()
sys.path.insert(0, str(BACKEND_DIR))


def _load_backend_app_module():
    module_name = '_backend_root_app'
    cached_module = sys.modules.get(module_name)
    if cached_module is not None:
        return cached_module

    module_path = BACKEND_DIR / 'app.py'
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Unable to load backend app module from {module_path}')

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


backend_app_module = _load_backend_app_module()  # noqa: E402


def meibography_models_available():
    models_root = Path(os.environ.get('MODEL_PATH') or (BACKEND_DIR / 'meibography_models'))
    return all((models_root / filename).is_file() for filename in EXPECTED_MODEL_FILES)


def build_sample_image(width=160, height=120):
    """Create a synthetic eye-like image that can exercise enhancement and model code paths."""
    image = np.zeros((height, width, 3), dtype=np.uint8)
    gradient = np.linspace(25, 110, width, dtype=np.uint8)
    image[:, :, 0] = gradient
    image[:, :, 1] = np.tile(np.linspace(20, 95, height, dtype=np.uint8)[:, None], (1, width))
    image[:, :, 2] = 45

    center = (width // 2, height // 2)
    cv2.ellipse(image, center, (width // 3, height // 4), 0, 0, 360, (185, 185, 185), -1)
    cv2.ellipse(image, center, (width // 5, height // 7), 0, 0, 360, (120, 120, 120), -1)
    cv2.line(image, (width // 4, height // 2), (3 * width // 4, height // 2), (220, 220, 220), 2)
    cv2.line(image, (width // 3, height // 3), (2 * width // 3, 2 * height // 3), (90, 90, 90), 1)
    cv2.GaussianBlur(image, (3, 3), 0, dst=image)
    return image


def encode_png_data_url(image_bgr):
    encoded_ok, encoded = cv2.imencode('.png', image_bgr)
    if not encoded_ok:
        raise RuntimeError('Failed to encode smoke-test image.')
    payload = base64.b64encode(encoded.tobytes()).decode('ascii')
    return f'data:image/png;base64,{payload}'


class ApiSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = backend_app_module.app

    def setUp(self):
        self.client = self.app.test_client()
        self.sample_image = build_sample_image()
        self.sample_image_data = encode_png_data_url(self.sample_image)

    def login(self):
        response = self.client.post(
            '/api/auth/login',
            json={
                'username': os.environ['AUTH_BOOTSTRAP_USERNAME'],
                'password': os.environ['AUTH_BOOTSTRAP_PASSWORD'],
            },
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_health_endpoint(self):
        response = self.client.get('/api/health', headers={'X-Request-Id': 'smoke-health-check'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertIn(payload.get('status'), {'ok', 'degraded'})
        self.assertIn('database', payload)
        self.assertIn('storage_backend', payload)
        self.assertEqual(response.headers.get('X-Request-Id'), 'smoke-health-check')

    def test_auth_session_flow(self):
        config_response = self.client.get('/api/auth/config')
        self.assertEqual(config_response.status_code, 200, config_response.get_data(as_text=True))

        self.login()
        me_response = self.client.get('/api/auth/me')
        self.assertEqual(me_response.status_code, 200, me_response.get_data(as_text=True))
        payload = me_response.get_json()
        self.assertTrue(payload.get('authenticated'))
        self.assertEqual(payload['user']['username'], os.environ['AUTH_BOOTSTRAP_USERNAME'])

    def test_image_enhancement_endpoint(self):
        self.login()
        response = self.client.post('/api/enhance', json={'image_data': self.sample_image_data})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload.get('status'), 'ok')
        self.assertTrue(payload['result']['enhanced_image_data'].startswith('data:image/png;base64,'))

    def test_canonical_workflow_routes(self):
        self.login()

        patient_response = self.client.post(
            '/api/patients',
            json={
                'full_name': 'Smoke Test Patient',
                'age': 29,
                'mobile': '9999999999',
                'gender': 'Other',
            },
        )
        self.assertEqual(patient_response.status_code, 201, patient_response.get_data(as_text=True))
        patient = patient_response.get_json()
        patient_id = patient['id']

        upload_response = self.client.post(
            '/api/upload',
            json={
                'patient_id': patient_id,
                'eye': 'left',
                'lid': 'lower',
                'brightness': 55,
                'contrast': 60,
                'image_data': self.sample_image_data,
            },
        )
        self.assertEqual(upload_response.status_code, 200, upload_response.get_data(as_text=True))
        upload_payload = upload_response.get_json()
        self.assertEqual(upload_payload.get('status'), 'uploaded')
        self.assertEqual(upload_payload.get('upload_type'), 'capture')
        self.assertEqual(upload_payload.get('patient_id'), patient_id)
        self.assertTrue(upload_payload.get('image_url'))

        file_encoded_ok, file_encoded = cv2.imencode('.png', self.sample_image)
        self.assertTrue(file_encoded_ok)
        file_upload_response = self.client.post(
            '/api/upload',
            data={
                'patient_id': str(patient_id),
                'eye': 'right',
                'lid': 'upper',
                'file': (BytesIO(file_encoded.tobytes()), 'smoke-upload.png'),
            },
            content_type='multipart/form-data',
        )
        self.assertEqual(file_upload_response.status_code, 200, file_upload_response.get_data(as_text=True))
        file_upload_payload = file_upload_response.get_json()
        self.assertEqual(file_upload_payload.get('status'), 'uploaded')
        self.assertEqual(file_upload_payload.get('upload_type'), 'file')
        self.assertEqual(file_upload_payload.get('patient_id'), patient_id)
        self.assertTrue(file_upload_payload.get('image_url'))

        predict_lid = None
        if meibography_models_available():
            predict_response = self.client.post(
                '/api/predict',
                json={
                    'image_url': upload_payload['image_url'],
                    'eye': 'left',
                    'lid': 'lower',
                    'brightness': 55,
                    'contrast': 60,
                },
            )
            self.assertEqual(predict_response.status_code, 200, predict_response.get_data(as_text=True))
            predict_payload = predict_response.get_json()
            self.assertEqual(predict_payload.get('status'), 'ok')
            self.assertIn('result', predict_payload)
            self.assertEqual(predict_payload['result'].get('lid'), 'lower')
            predict_lid = predict_payload['result'].get('lid')

        assessment_response = self.client.post(
            '/api/results',
            json={
                'kind': 'assessment',
                'patient_id': patient_id,
                'completed_tests': ['Meibography'],
                'session_data': {
                    'notes': 'Smoke test session',
                    'predict_lid': predict_lid,
                },
                'left_analysis': 'Lower lid analyzed',
                'right_analysis': '',
            },
        )
        self.assertEqual(assessment_response.status_code, 200, assessment_response.get_data(as_text=True))
        assessment_payload = assessment_response.get_json()
        self.assertEqual(assessment_payload.get('patient_id'), patient_id)
        self.assertEqual(assessment_payload.get('status'), 'draft')

        report_response = self.client.post(
            '/api/results',
            data={
                'kind': 'report',
                'patient_id': str(patient_id),
                'assessment_id': str(assessment_payload['id']),
                'left_analysis': 'Lower lid analyzed',
                'right_analysis': '',
                'session_data': '{"notes":"Smoke test session"}',
                'completed_tests': '["Meibography"]',
                'file': (BytesIO(b'%PDF-1.4\n% smoke test\n%%EOF'), 'smoke-report.pdf'),
            },
            content_type='multipart/form-data',
        )
        self.assertEqual(report_response.status_code, 201, report_response.get_data(as_text=True))
        report_payload = report_response.get_json()
        self.assertEqual(report_payload.get('patient_id'), patient_id)
        self.assertTrue(report_payload.get('download_url'))

        reports_response = self.client.get('/api/results', query_string={'kind': 'report', 'patient_id': patient_id})
        self.assertEqual(reports_response.status_code, 200, reports_response.get_data(as_text=True))
        reports_payload = reports_response.get_json()
        self.assertEqual(len(reports_payload), 1)
        self.assertEqual(reports_payload[0].get('patient_id'), patient_id)

        latest_assessment_response = self.client.get(
            '/api/results',
            query_string={'kind': 'assessment', 'patient_id': patient_id, 'latest': 'true'},
        )
        self.assertEqual(latest_assessment_response.status_code, 200, latest_assessment_response.get_data(as_text=True))
        latest_assessment_payload = latest_assessment_response.get_json()
        self.assertEqual(latest_assessment_payload.get('report_id'), report_payload['id'])
        self.assertEqual(latest_assessment_payload.get('status'), 'reported')


class ImageProcessingSmokeTests(unittest.TestCase):
    def test_basic_image_processing_helpers(self):
        sample_image = build_sample_image()
        adjusted = backend_app_module.apply_brightness_contrast(sample_image, 65, 60)
        self.assertEqual(adjusted.shape, sample_image.shape)
        self.assertFalse(np.array_equal(adjusted, sample_image))

        enhanced = backend_app_module.auto_enhance_image(sample_image)
        self.assertEqual(enhanced.ndim, 3)
        self.assertEqual(enhanced.shape[2], 3)
        self.assertGreaterEqual(enhanced.shape[0], sample_image.shape[0])
        self.assertGreaterEqual(enhanced.shape[1], sample_image.shape[1])


class MeibographyModelSmokeTests(unittest.TestCase):
    def test_meibography_models_load_and_infer(self):
        if not meibography_models_available():
            self.skipTest('Meibography model weights are not present in backend/meibography_models.')

        sample_image = build_sample_image(width=192, height=144)
        service = backend_app_module._ensure_meibography_service()
        service.ensure_loaded()

        status = service.get_status()
        self.assertTrue(status.get('loaded'), status)
        self.assertTrue(status.get('lower_models_ready'), status)

        analysis = service.analyze(sample_image, lid='lower')
        self.assertIn('stats', analysis)
        self.assertIn('summary', analysis)
        self.assertIn('meibo_frame', analysis)
        self.assertEqual(analysis['source_frame'].shape[:2], sample_image.shape[:2])
        self.assertEqual(analysis['meibo_frame'].shape[:2], sample_image.shape[:2])

        stats = analysis['stats']
        self.assertGreaterEqual(stats.get('coverage_pct', 0), 0)
        self.assertLessEqual(stats.get('coverage_pct', 0), 100)
        self.assertGreaterEqual(stats.get('dropout_pct', 0), 0)
        self.assertLessEqual(stats.get('dropout_pct', 0), 100)


def build_suite(skip_ml=False):
    loader = unittest.defaultTestLoader
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(ApiSmokeTests))
    suite.addTests(loader.loadTestsFromTestCase(ImageProcessingSmokeTests))
    if not skip_ml:
        suite.addTests(loader.loadTestsFromTestCase(MeibographyModelSmokeTests))
    return suite


_runtime_cleaned = False


def cleanup_smoke_runtime():
    """Dispose the isolated database before removing only this run's workspace."""
    global _runtime_cleaned
    if _runtime_cleaned:
        return
    with backend_app_module.app.app_context():
        backend_app_module.db.session.remove()
        backend_app_module.db.engine.dispose()
    if RUNTIME_ROOT.resolve().parent != SMOKE_RUNTIME_PARENT.resolve():
        raise RuntimeError('Smoke runtime cleanup is outside its expected workspace.')
    shutil.rmtree(RUNTIME_ROOT, ignore_errors=True)
    try:
        SMOKE_RUNTIME_PARENT.rmdir()
    except OSError:
        pass
    _runtime_cleaned = True


atexit.register(cleanup_smoke_runtime)


def main():
    parser = argparse.ArgumentParser(description='Run backend pre-deployment smoke tests.')
    parser.add_argument('--skip-ml', action='store_true', help='Skip the meibography model smoke inference.')
    args = parser.parse_args()

    result = unittest.TextTestRunner(verbosity=2).run(build_suite(skip_ml=args.skip_ml))

    cleanup_smoke_runtime()
    raise SystemExit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
