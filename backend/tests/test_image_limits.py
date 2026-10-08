"""Large image work shares a bound without blocking lightweight requests."""

import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import smoke_tests
from app.utils.resource_limits import IMAGE_PROCESSING_SLOT


class SharedImageLimitTests(unittest.TestCase):
    def setUp(self):
        self.client = smoke_tests.backend_app_module.app.test_client()
        response = self.client.post('/api/auth/login', json={'username': 'smoke-admin', 'password': 'smoke-password'})
        self.assertEqual(response.status_code, 200)

    def test_guest_and_clinician_work_share_the_same_slot(self):
        IMAGE_PROCESSING_SLOT.acquire()
        try:
            for path in ['/api/predict', '/api/model/analyze', '/api/enhance', '/api/tear-meniscus/measure', '/api/guest/meibography/analyze']:
                response = self.client.post(path, json={})
                self.assertEqual(response.status_code, 429, path)
                self.assertEqual(response.headers['Retry-After'], '5')
            self.assertEqual(self.client.get('/api/health').status_code, 200)
        finally:
            IMAGE_PROCESSING_SLOT.release()

    def test_processing_failure_releases_the_slot(self):
        with patch('app.modules.meibography.routes.enhance_snapshot_request', side_effect=ValueError('Invalid image')):
            self.assertEqual(self.client.post('/api/enhance', json={}).status_code, 400)
        with patch('app.modules.meibography.routes.enhance_snapshot_request', return_value={'ok': True}):
            self.assertEqual(self.client.post('/api/enhance', json={}).status_code, 200)
