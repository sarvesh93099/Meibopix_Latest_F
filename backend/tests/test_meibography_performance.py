"""Check inference reuse without changing masks, metrics, or lid validation."""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import smoke_tests  # Isolates database/storage before loading the application.
from app.modules.meibography.service import analyze_meibography_request

ML_AVAILABLE = all(importlib.util.find_spec(name) is not None for name in (
    'torch', 'segmentation_models_pytorch',
))
if ML_AVAILABLE:
    from app.modules.meibography import model_service as models


@unittest.skipUnless(ML_AVAILABLE, 'Optional segmentation dependencies are not installed.')
class InferenceReuseTests(unittest.TestCase):
    def setUp(self):
        self.service = models.MeibographyModelService('unused-test-weights')
        self.service.loaded = True
        for slot in ('lower_eyelid_model', 'upper_eyelid_model',
                     'lower_meibo_model', 'upper_meibo_model'):
            setattr(self.service, slot, Mock(name=slot))
        self.image = smoke_tests.build_sample_image(160, 120)
        self.eyelid_probability = np.zeros(self.image.shape[:2], dtype=np.float32)
        self.eyelid_probability[30:90, 40:120] = 0.9

    def infer(self, image, model):
        if model in (self.service.lower_eyelid_model, self.service.upper_eyelid_model):
            return self.eyelid_probability.copy()
        return np.full(image.shape[:2], 0.1, dtype=np.float32)

    def test_each_selected_eyelid_runs_once_and_full_crop_is_reused(self):
        for lid in ('lower', 'upper'):
            with self.subTest(lid=lid), patch.object(models, '_infer_probability', side_effect=self.infer) as infer:
                maps = {}
                detection = self.service.detect_lid_side(self.image, probability_maps=maps)
                analysis = self.service.analyze(
                    self.image, lid=lid, eyelid_probability=maps[lid], include_progress_frames=False,
                )
                self.assertEqual(infer.call_count, 5)  # Two eyelids, three distinct gland views.
                for model in (self.service.lower_eyelid_model, self.service.upper_eyelid_model):
                    self.assertEqual(sum(call.args[1] is model for call in infer.call_args_list), 1)
                self.assertEqual(set(maps), {'lower', 'upper'})
                self.assertNotIn('probability_map', detection['candidates'][lid])
                np.testing.assert_array_equal(analysis['eyelid_mask'], (maps[lid] > 0.5).astype(np.uint8) * 255)

    def test_reused_eyelid_and_omitted_animation_preserve_final_results(self):
        with patch.object(models, '_infer_probability', side_effect=self.infer):
            original = self.service.analyze(self.image)
            reused = self.service.analyze(
                self.image, eyelid_probability=self.eyelid_probability, include_progress_frames=False,
            )
        self.assertEqual(original['stats'], reused['stats'])
        for key in ('eyelid_mask', 'meibo_mask', 'probability_map', 'eyelid_frame', 'meibo_frame'):
            np.testing.assert_array_equal(original[key], reused[key])
        self.assertGreater(len(original['gland_progress_frames']), 0)
        self.assertEqual(reused['gland_progress_frames'], [])

    def test_manual_outline_takes_precedence_over_cached_prediction(self):
        manual = np.zeros(self.image.shape[:2], dtype=np.uint8)
        manual[45:75, 55:105] = 255
        with patch.object(models, '_infer_probability', side_effect=self.infer) as infer:
            analysis = self.service.analyze(
                self.image, manual_eyelid_mask=manual, eyelid_probability=self.eyelid_probability,
                include_progress_frames=False,
            )
        np.testing.assert_array_equal(analysis['eyelid_mask'], manual)
        self.assertEqual(infer.call_count, 3)

    def test_a_partial_crop_still_gets_its_own_prediction(self):
        image = smoke_tests.build_sample_image(600, 200)
        probability = np.zeros(image.shape[:2], dtype=np.float32)
        probability[60:140, 280:320] = 0.9
        with patch.object(models, '_infer_probability', return_value=np.zeros(image.shape[:2], dtype=np.float32)) as infer:
            def predict_view(view, model):
                return np.full(view.shape[:2], 0.1, dtype=np.float32)
            infer.side_effect = predict_view
            self.service.analyze(image, eyelid_probability=probability, include_progress_frames=False)
        self.assertEqual(infer.call_count, 4)
        self.assertEqual(infer.call_args_list[1].args[0].shape[:2], (200, 279))

    def test_hysteresis_lookup_matches_component_loop(self):
        # Includes strong-seeded weak regions, isolated weak noise, and no seeds.
        for seed in range(4):
            probability = np.random.default_rng(seed).random((100, 140), dtype=np.float32)
            eyelid = np.zeros(probability.shape, dtype=np.uint8)
            eyelid[10:90, 15:125] = 255
            for strong_threshold in (0.85, 1.0):
                strong = (probability > strong_threshold).astype(np.uint8) * 255
                weak = (probability > 0.65).astype(np.uint8) * 255
                strong[eyelid == 0] = 0
                weak[eyelid == 0] = 0
                count, labels, _, _ = cv2.connectedComponentsWithStats(weak, connectivity=8)
                expected = np.zeros_like(weak)
                for label in range(1, count):
                    region = labels == label
                    if np.any(strong[region] > 0):
                        expected[region] = 255
                expected = cv2.morphologyEx(expected, cv2.MORPH_CLOSE, models.HYSTERESIS_CLOSE_KERNEL)
                expected = cv2.morphologyEx(expected, cv2.MORPH_OPEN, models.HYSTERESIS_OPEN_KERNEL)
                expected[eyelid == 0] = 0
                actual = models._build_hysteresis_mask(probability, eyelid, strong_threshold, 0.65)
                np.testing.assert_array_equal(actual, expected)


class AnalysisRequestTests(unittest.TestCase):
    def setUp(self):
        self.app = smoke_tests.backend_app_module.app
        self.image = smoke_tests.build_sample_image(160, 120)
        self.service = Mock()
        self.probability = np.full(self.image.shape[:2], 0.9, dtype=np.float32)

        def detect(image, *, probability_maps):
            probability_maps.update({'lower': self.probability, 'upper': self.probability})
            return {'predicted_lid': 'lower', 'confident': False}

        self.service.detect_lid_side.side_effect = detect
        self.service.analyze.return_value = {
            'stats': {'grade': 'N/A'}, 'summary': 'Test analysis',
            'source_frame': self.image, 'eyelid_frame': self.image, 'meibo_frame': self.image,
            'gland_progress_frames': [],
        }
        self.service.get_status.return_value = {'loaded': True}

    def analyze(self, payload):
        with self.app.app_context(), patch('app.modules.meibography.service.get_model_status', return_value={'available': True}):
            with patch('app.modules.meibography.service.ensure_meibography_service', return_value=self.service):
                return analyze_meibography_request(payload, decoded_image=(self.image, 'test'))

    def test_request_reuses_prediction_and_defaults_to_final_overlays(self):
        response, status = self.analyze({'lid': 'lower'})
        self.assertEqual(status, 200)
        kwargs = self.service.analyze.call_args.kwargs
        self.assertIs(kwargs['eyelid_probability'], self.probability)
        self.assertFalse(kwargs['include_progress_frames'])
        self.assertEqual(response['result']['gland_progression_image_data'], [])
        self.assertGreater(response['result']['analysis_duration_ms'], 0)
        self.assertTrue(response['result']['eyelid_boundary_image_data'].startswith('data:image/png;base64,'))

    def test_progression_is_available_when_explicitly_requested(self):
        self.service.analyze.return_value['gland_progress_frames'] = [self.image]
        response, status = self.analyze({'include_gland_progression': True})
        self.assertEqual(status, 200)
        self.assertTrue(self.service.analyze.call_args.kwargs['include_progress_frames'])
        self.assertEqual(len(response['result']['gland_progression_image_data']), 1)

    def test_compact_response_sends_the_same_gland_overlay_once(self):
        original, _ = self.analyze({})
        compact, status = self.analyze({'compact_response': True})
        self.assertEqual(status, 200)
        self.assertNotIn('annotated_image_data', compact['result'])
        self.assertEqual(compact['result']['meibomian_evaluation_image_data'], original['result']['annotated_image_data'])

    def test_confident_lid_mismatch_stops_before_gland_inference(self):
        self.service.detect_lid_side.side_effect = None
        self.service.detect_lid_side.return_value = {'predicted_lid': 'lower', 'confident': True}
        response, status = self.analyze({'lid': 'upper'})
        self.assertEqual(status, 400)
        self.assertEqual(response['detected_lid'], 'lower')
        self.service.analyze.assert_not_called()

    def test_guest_rejects_non_boolean_progression_before_decoding(self):
        client = self.app.test_client()
        with patch('app.modules.meibography.guest.decode_request_image') as decode:
            response = client.post('/api/guest/meibography/analyze', json={
                'image_data': smoke_tests.encode_png_data_url(self.image),
                'include_gland_progression': 'false',
            })
        self.assertEqual(response.status_code, 400)
        decode.assert_not_called()


if __name__ == '__main__':
    unittest.main()
