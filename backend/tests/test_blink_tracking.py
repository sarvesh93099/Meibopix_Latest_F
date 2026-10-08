"""Blink regressions use deterministic landmarks/frames, with no camera or download."""

import sys
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from flask import Flask
from werkzeug.datastructures import FileStorage

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import smoke_tests  # Configure the isolated runtime before app compatibility imports.
from app.modules.blink import detector
from app.modules.blink.service import _session_duration, analyze_blink_video_form
from app.modules.blink.tracker import BlinkTracker


def frame(ear=0.3, score=0.05, face=True):
    return {'face_found': face, 'combined_ear': ear, 'blink_score': score}


def landmarks(ear, width=480, height=360):
    points = [SimpleNamespace(x=0.5, y=0.5) for _ in range(478)]
    for indices, offset in ((detector.LEFT_EYE, 0.3), (detector.RIGHT_EYE, 0.6)):
        half_height = ear * 0.1 * width / (2 * height)
        coordinates = [(offset, 0.5), (offset + 0.03, 0.5 - half_height),
                       (offset + 0.07, 0.5 - half_height), (offset + 0.1, 0.5),
                       (offset + 0.07, 0.5 + half_height), (offset + 0.03, 0.5 + half_height)]
        for index, (x, y) in zip(indices, coordinates):
            points[index] = SimpleNamespace(x=x, y=y)
    return points


class BlinkTrackingTests(unittest.TestCase):
    def test_open_eyes_do_not_generate_blinks(self):
        tracker = BlinkTracker()
        for index in range(101):
            tracker.update(frame(), index * 0.05)
        self.assertEqual(tracker.blink_timestamps, [])
        self.assertTrue(tracker.result(5)['quality'])
        self.assertEqual(tracker.result(5)['bpm_overall'], 0)

    def test_blink_counts_once_after_reopening(self):
        tracker = BlinkTracker()
        tracker.update(frame(), 0)
        for index in range(1, 6):
            tracker.update(frame(0.06, 0.8), index * 0.05)
            self.assertEqual(len(tracker.blink_timestamps), 0)
        tracker.update(frame(), 0.3)
        tracker.update(frame(), 0.35)
        self.assertEqual(tracker.blink_timestamps, [0.3])

    def test_tracking_loss_cancels_an_incomplete_blink(self):
        tracker = BlinkTracker()
        tracker.update(frame(), 0)
        tracker.update(frame(0.05, 0.9), 0.05)
        tracker.update(frame(face=False), 0.1)
        tracker.update(frame(), 0.15)
        self.assertEqual(tracker.blink_timestamps, [])

    def test_long_closure_and_initial_closed_eyes_are_not_blinks(self):
        tracker = BlinkTracker()
        tracker.update(frame(0.05, 0.9), 0)
        tracker.update(frame(), 0.2)
        self.assertEqual(tracker.blink_timestamps, [])
        tracker.update(frame(0.05, 0.9), 0.3)
        tracker.update(frame(), 2)
        self.assertEqual(tracker.blink_timestamps, [])

    def test_no_face_has_no_valid_bpm_and_time_partitions(self):
        tracker = BlinkTracker()
        for index in range(100):
            tracker.update(frame(face=False), index * 0.05)
        result = tracker.result(5)
        self.assertFalse(result['quality'])
        self.assertIsNone(result['bpm_overall'])
        self.assertEqual(result['face_detected_seconds'] + result['no_face_seconds'], 5)

    def test_dropped_frames_do_not_invent_face_time(self):
        tracker = BlinkTracker()
        tracker.update(frame(), 0)
        tracker.update(frame(), 30)
        result = tracker.result(30)
        self.assertEqual(result['face_detected_seconds'], 0.2)
        self.assertFalse(result['quality'])

    def test_frame_ear_is_geometric_and_scores_are_selected_by_name(self):
        categories = [SimpleNamespace(category_name='jawOpen', score=0.99),
                      SimpleNamespace(category_name='eyeBlinkRight', score=0.02),
                      SimpleNamespace(category_name='eyeBlinkLeft', score=0.04)]
        result = SimpleNamespace(face_landmarks=[landmarks(0.3)], face_blendshapes=[categories])
        metrics = detector._frame_metrics(result, 480, 360)
        self.assertAlmostEqual(metrics['combined_ear'], 0.3)
        self.assertAlmostEqual(metrics['blink_score'], 0.03)
        self.assertFalse(metrics['is_closed'])
        result.face_landmarks = []
        self.assertFalse(detector._frame_metrics(result, 480, 360)['face_found'])

    def test_duplicate_container_timestamps_are_handled_and_video_inference_is_bounded(self):
        class Capture:
            def __init__(self): self.index = 0; self.released = False
            def isOpened(self): return True
            def get(self, property_id):
                return {detector.cv2.CAP_PROP_FPS: 60, detector.cv2.CAP_PROP_FRAME_WIDTH: 640,
                        detector.cv2.CAP_PROP_FRAME_HEIGHT: 480}.get(property_id, 0)
            def read(self):
                self.index += 1
                return (True, np.zeros((48, 64, 3), dtype=np.uint8)) if self.index <= 60 else (False, None)
            def release(self): self.released = True
        class Landmarker:
            def __init__(self): self.timestamps = []; self.closed = False
            def detect_for_video(self, image, timestamp):
                if self.timestamps: assert timestamp > self.timestamps[-1]
                self.timestamps.append(timestamp)
                return SimpleNamespace(face_landmarks=[], face_blendshapes=[])
            def close(self): self.closed = True
        capture, landmarker = Capture(), Landmarker()
        mp = SimpleNamespace(Image=lambda **kwargs: kwargs, ImageFormat=SimpleNamespace(SRGB=1))
        vision = SimpleNamespace(RunningMode=SimpleNamespace(VIDEO=1))
        with patch.object(detector, '_ensure_dependencies'), patch.object(detector, 'mp', mp), \
                patch.object(detector, 'mp_vision', vision), patch.object(detector.cv2, 'VideoCapture', return_value=capture), \
                patch.object(detector, '_create_face_landmarker', return_value=landmarker):
            result = detector.analyze_blink_video('fake.webm', session_duration=1)
        self.assertEqual(len(landmarker.timestamps), 20)
        self.assertEqual(result['no_face_seconds'], 1)
        self.assertEqual(result['total_blinks'], 0)
        self.assertTrue(capture.released)
        self.assertTrue(landmarker.closed)

    def test_session_duration_rejects_non_finite_values(self):
        for value in ('nan', 'inf', '0', '121', 'abc'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                _session_duration({'session_duration_seconds': value})

    def test_failed_upload_analysis_removes_temporary_video(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            app = Flask(__name__)
            app.config['UPLOAD_FOLDER'] = directory
            video = FileStorage(stream=BytesIO(b'fake-video'), filename='clip.webm', content_type='video/webm')
            with app.app_context(), patch('app.modules.blink.service.get_blink_counter_functions', side_effect=RuntimeError('model missing')):
                with self.assertRaises(RuntimeError):
                    analyze_blink_video_form({'video': video}, {})
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
