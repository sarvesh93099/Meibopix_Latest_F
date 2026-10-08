"""Bounded MediaPipe detection: real landmarks and completed blink cycles."""
import math
import os
import shutil
import tempfile
import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
except ImportError as error:
    mp = mp_python = mp_vision = None
    MEDIAPIPE_IMPORT_ERROR = error
else:
    MEDIAPIPE_IMPORT_ERROR = None

from .tracker import BlinkTracker

LEFT_EYE = [362, 385, 387, 263, 373, 380]
RIGHT_EYE = [33, 160, 158, 133, 153, 144]
DEFAULT_SESSION_DURATION = 30
DEFAULT_EAR_THRESHOLD = 0.18
DEFAULT_MIN_CLOSED_FRAMES = 1
DEFAULT_MIN_BLINK_INTERVAL_SECONDS = 0.20
MAX_DETECTION_FRAME_WIDTH = 480
MAX_ANALYSIS_FPS = 20.0
DEFAULT_FALLBACK_FPS = 24.0
BLINK_MODEL_NAME = 'MediaPipe Face Landmarker'
MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
_FACE_LANDMARKER_IMAGE = None
_MODEL_LOCK = threading.RLock()
_IMAGE_DETECTOR_LOCK = threading.Lock()


def _ensure_dependencies():
    if MEDIAPIPE_IMPORT_ERROR is not None:
        raise RuntimeError('Install mediapipe in the backend environment to recheck a recording.') from MEDIAPIPE_IMPORT_ERROR


def _get_model_path():
    configured = os.environ.get('BLINK_MODEL_PATH')
    if configured:
        if not os.path.isfile(configured):
            raise RuntimeError('The configured blink model file was not found.')
        return configured
    model_dir = str(Path(__file__).resolve().parents[3] / 'mp_models')
    model_path = os.path.join(model_dir, 'face_landmarker.task')
    with _MODEL_LOCK:
        os.makedirs(model_dir, exist_ok=True)
        if os.path.isfile(model_path) and os.path.getsize(model_path) > 0:
            return model_path
        temporary_path = ''
        try:
            with tempfile.NamedTemporaryFile(dir=model_dir, suffix='.download', delete=False) as output:
                temporary_path = output.name
                with urllib.request.urlopen(MODEL_URL, timeout=30) as response:
                    shutil.copyfileobj(response, output, length=64 * 1024)
            os.replace(temporary_path, model_path)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)
    return model_path


def _create_face_landmarker(running_mode):
    _ensure_dependencies()
    options = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=_get_model_path()),
        running_mode=running_mode, num_faces=1,
        min_face_detection_confidence=0.35, min_face_presence_confidence=0.4,
        min_tracking_confidence=0.4, output_face_blendshapes=True,
    )
    return mp_vision.FaceLandmarker.create_from_options(options)


def _get_face_landmarker():
    global _FACE_LANDMARKER_IMAGE
    _ensure_dependencies()
    with _MODEL_LOCK:
        if _FACE_LANDMARKER_IMAGE is None:
            _FACE_LANDMARKER_IMAGE = _create_face_landmarker(mp_vision.RunningMode.IMAGE)
    return _FACE_LANDMARKER_IMAGE


def _resize_for_detection(frame):
    height, width = frame.shape[:2]
    if width <= MAX_DETECTION_FRAME_WIDTH:
        return frame
    scale = MAX_DETECTION_FRAME_WIDTH / width
    return cv2.resize(frame, (MAX_DETECTION_FRAME_WIDTH, max(1, round(height * scale))), interpolation=cv2.INTER_AREA)


def _eye_aspect_ratio(landmarks, indices, width, height):
    points = [np.array([landmarks[index].x * width, landmarks[index].y * height]) for index in indices]
    eye_axis = points[3] - points[0]
    horizontal = np.linalg.norm(eye_axis)
    if horizontal < 1e-6:
        return None
    axis = eye_axis / horizontal
    perpendicular = np.array([-axis[1], axis[0]])
    vertical_one = abs(float(np.dot(points[1] - points[5], perpendicular)))
    vertical_two = abs(float(np.dot(points[2] - points[4], perpendicular)))
    # Project lid separation perpendicular to each eye's own corner axis so
    # head roll does not make a normally open eye appear closed.
    return float((vertical_one + vertical_two) / (2 * horizontal))


def _frame_metrics(result, width, height, ear_threshold=DEFAULT_EAR_THRESHOLD):
    empty = {
        'face_found': False, 'detection_mode': 'NONE', 'combined_ear': None,
        'blink_score': None, 'is_closed': False, 'ear_threshold': ear_threshold, 'overlay_anchor': None,
    }
    if not result.face_landmarks:
        return empty
    landmarks = result.face_landmarks[0]
    if len(landmarks) <= max(max(LEFT_EYE), max(RIGHT_EYE)):
        return empty
    left = _eye_aspect_ratio(landmarks, LEFT_EYE, width, height)
    right = _eye_aspect_ratio(landmarks, RIGHT_EYE, width, height)
    categories = result.face_blendshapes[0] if result.face_blendshapes else []
    scores = {category.category_name: category.score for category in categories}
    left_score = float(scores['eyeBlinkLeft']) if 'eyeBlinkLeft' in scores else None
    right_score = float(scores['eyeBlinkRight']) if 'eyeBlinkRight' in scores else None
    available_ears = [value for value in (left, right) if value is not None]
    available_scores = [value for value in (left_score, right_score) if value is not None]
    if not available_ears and not available_scores:
        return empty
    ear = sum(available_ears) / len(available_ears) if available_ears else None
    score = sum(available_scores) / len(available_scores) if available_scores else None
    # EAR stays geometric (lower = closed); blendshape stays separate (higher = closed).
    return {
        'face_found': True, 'detection_mode': 'MEDIAPIPE',
        'combined_ear': round(ear, 4) if ear is not None else None,
        'blink_score': round(score, 4) if score is not None else None,
        'left_ear': round(left, 4) if left is not None else None,
        'right_ear': round(right, 4) if right is not None else None,
        'left_blink_score': round(left_score, 4) if left_score is not None else None,
        'right_blink_score': round(right_score, 4) if right_score is not None else None,
        'is_closed': bool(any(value is not None and value < ear_threshold for value in (left, right)) or any(value is not None and value >= 0.45 for value in (left_score, right_score))),
        'ear_threshold': ear_threshold, 'overlay_anchor': None,
    }


def analyze_blink_frame(image_bgr, ear_threshold=DEFAULT_EAR_THRESHOLD):
    if image_bgr is None or image_bgr.size == 0:
        raise ValueError('Unable to analyze an empty frame.')
    detector = _get_face_landmarker()
    frame = _resize_for_detection(image_bgr)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    with _IMAGE_DETECTOR_LOCK:
        result = detector.detect(image)
    return _frame_metrics(result, frame.shape[1], frame.shape[0], ear_threshold)


def analyze_blink_video(
    video_path, ear_threshold=DEFAULT_EAR_THRESHOLD, min_closed_frames=DEFAULT_MIN_CLOSED_FRAMES,
    session_duration=DEFAULT_SESSION_DURATION, min_blink_interval_seconds=DEFAULT_MIN_BLINK_INTERVAL_SECONDS,
):
    _ensure_dependencies()
    session_duration = float(session_duration)
    if not math.isfinite(session_duration) or not 1 <= session_duration <= 120:
        raise ValueError('Session length must be between 1 and 120 seconds.')
    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        capture.release()
        raise ValueError('Unable to open this recording. Try recording again.')
    detector = None
    tracker = BlinkTracker(min_closed_frames, min_blink_interval_seconds)
    reported_fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    valid_fps = math.isfinite(reported_fps) and 1 <= reported_fps <= 120
    timeline_fps = reported_fps if valid_fps else DEFAULT_FALLBACK_FPS
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frame_index, last_video_ms = 0, -1
    last_analysis_seconds, analyzed_duration = -math.inf, 0.0
    try:
        detector = _create_face_landmarker(mp_vision.RunningMode.VIDEO)
        while frame_index < math.ceil(session_duration * timeline_fps):
            success, frame = capture.read()
            if not success:
                break
            source_seconds = frame_index / timeline_fps
            frame_index += 1
            position = float(capture.get(cv2.CAP_PROP_POS_MSEC) or 0) / 1000
            if math.isfinite(position) and source_seconds <= position <= source_seconds + 1:
                source_seconds = max(source_seconds, position)
            if source_seconds > session_duration:
                break
            analyzed_duration = min(session_duration, source_seconds + 1 / timeline_fps)
            if source_seconds - last_analysis_seconds < 1 / MAX_ANALYSIS_FPS - 1e-6:
                continue
            last_analysis_seconds = source_seconds
            frame = _resize_for_detection(frame)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            # One inference per source frame, strictly increasing timestamps.
            timestamp_ms = max(last_video_ms + 1, round(source_seconds * 1000))
            last_video_ms = timestamp_ms
            result = detector.detect_for_video(image, timestamp_ms)
            tracker.update(_frame_metrics(result, frame.shape[1], frame.shape[0], ear_threshold), source_seconds)
    finally:
        capture.release()
        if detector is not None:
            detector.close()
    if not frame_index:
        raise ValueError('No frames could be read from this recording.')
    result = tracker.result(analyzed_duration)
    result.update({
        'session_duration_seconds': session_duration, 'model_name': BLINK_MODEL_NAME,
        'session_mode': 'recorded_video', 'resolution': {'width': width, 'height': height},
        'fps': round(timeline_fps, 1), 'analysis_fps_limit': MAX_ANALYSIS_FPS,
        'reported_fps': round(reported_fps, 3) if math.isfinite(reported_fps) else 0,
        'timeline_fps': round(timeline_fps, 3), 'used_fallback_fps': not valid_fps,
    })
    return result
