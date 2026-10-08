"""Bound model residency and verify the small-host profile rejects extra work."""
import sys
import types
import unittest
import weakref
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import smoke_tests
from app.modules.meibography.inference_backends import OnnxBackend
from app.utils.resource_limits import IMAGE_PROCESSING_SLOT


class FakeOptions:
    def add_session_config_entry(self, *_):
        pass


class FakeSession:
    def get_inputs(self):
        return [types.SimpleNamespace(name='image', shape=[1, 3, 512, 512])]

    def run(self, *_):
        return [np.zeros((1, 1, 512, 512), dtype=np.float32)]


class OnnxResidencyTests(unittest.TestCase):
    def runtime(self, create):
        return types.SimpleNamespace(
            SessionOptions=FakeOptions, InferenceSession=create,
            ExecutionMode=types.SimpleNamespace(ORT_SEQUENTIAL=0),
            GraphOptimizationLevel=types.SimpleNamespace(ORT_ENABLE_BASIC=1),
        )

    def test_reuses_one_session_and_evicts_before_loading_another(self):
        backend = OnnxBackend()
        references = []

        def create(*_, **kwargs):
            if references:
                self.assertIsNone(references[-1](), 'Old weights overlap new session construction')
            self.assertFalse(kwargs['sess_options'].enable_cpu_mem_arena)
            session = FakeSession()
            references.append(weakref.ref(session))
            return session

        array = np.zeros((1, 3, 512, 512), dtype=np.float32)
        with patch.dict(sys.modules, {'onnxruntime': self.runtime(create)}):
            backend.predict('lower-eye.onnx', array)
            backend.predict('lower-eye.onnx', array)
            self.assertEqual(len(references), 1)
            backend.predict('lower-glands.onnx', array)
            self.assertEqual(len(references), 2)
            self.assertEqual(backend.get_status()['resident_models'], 1)
            backend.release()
            self.assertIsNone(references[-1]())

    def test_failed_replacement_does_not_keep_old_session_resident(self):
        backend = OnnxBackend()
        array = np.zeros((1, 3, 512, 512), dtype=np.float32)
        with patch.dict(sys.modules, {'onnxruntime': self.runtime(lambda *_, **__: FakeSession())}):
            backend.predict('first.onnx', array)
        reference = weakref.ref(backend._session)

        def fail(*_, **__):
            self.assertIsNone(reference())
            raise RuntimeError('Invalid model')

        with patch.dict(sys.modules, {'onnxruntime': self.runtime(fail)}):
            with self.assertRaisesRegex(RuntimeError, 'Invalid model'):
                backend.predict('invalid.onnx', array)
        self.assertEqual(backend.get_status()['resident_models'], 0)


class SmallHostApiTests(unittest.TestCase):
    def setUp(self):
        self.app = smoke_tests.backend_app_module.app
        self.client = self.app.test_client()
        self.assertEqual(self.client.post('/api/auth/login', json={
            'username': 'smoke-admin', 'password': 'smoke-password',
        }).status_code, 200)

    def test_guest_respects_smaller_host_pixel_limit_before_full_decode(self):
        payload = {'image_data': smoke_tests.encode_png_data_url(smoke_tests.build_sample_image(160, 120))}
        with patch.dict(self.app.config, {'MAX_IMAGE_PIXELS': 1000}):
            with patch('app.utils.image_utils.cv2.imdecode') as decode:
                response = self.client.post('/api/guest/meibography/enhance', json=payload)
        self.assertEqual(response.status_code, 400)
        decode.assert_not_called()

    def test_server_blink_disabled_without_loading_detection_engine(self):
        with patch.dict(self.app.config, {'SERVER_BLINK_ENABLED': False}):
            with patch('app.services.runtime_services.get_blink_counter_functions') as detector:
                for path in ('/api/blink-counter/analyze', '/api/blink-counter/frame',
                             '/api/blink-counter/live/start'):
                    self.assertEqual(self.client.post(path, json={}).status_code, 503)
        detector.assert_not_called()

    def test_video_and_frame_cannot_overlap_segmentation(self):
        IMAGE_PROCESSING_SLOT.acquire()
        try:
            for path in ('/api/blink-counter/analyze', '/api/blink-counter/frame'):
                self.assertEqual(self.client.post(path, json={}).status_code, 429)
            self.assertEqual(self.client.get('/api/health').status_code, 200)
        finally:
            IMAGE_PROCESSING_SLOT.release()


if __name__ == '__main__':
    unittest.main()
