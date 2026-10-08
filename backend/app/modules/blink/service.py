"""Business logic for uploaded and live blink analysis."""

import os
import math
import tempfile
import time

import cv2
import numpy as np
from flask import current_app
from werkzeug.utils import secure_filename

from ...core import runtime
from ...core.constants import (
    BLINK_ALLOWED_EXTENSIONS,
    BLINK_ALLOWED_MIME_TYPES,
    BLINK_MAX_UPLOAD_BYTES,
    DEFAULT_SESSION_DURATION,
)
from ...services.runtime_services import (
    cleanup_stale_blink_live_sessions,
    create_blink_live_session,
    ensure_camera_manager,
    get_blink_counter_functions,
    update_blink_live_session,
)
from ...utils.image_utils import decode_request_image
from ...utils.logging_utils import log_info, log_warning


def analyze_blink_video_form(files, form):
    temp_video_path = ''
    try:
        if 'video' not in files:
            raise ValueError('Video file is required.')

        video_file = files['video']
        if not video_file or not video_file.filename:
            raise ValueError('No video selected.')

        filename = secure_filename(video_file.filename)
        extension = os.path.splitext(filename)[1].lower()
        if extension not in BLINK_ALLOWED_EXTENSIONS:
            raise ValueError('Only MP4, MOV, AVI, MKV, or WEBM video files are allowed.')

        mime_type = (video_file.mimetype or '').lower()
        normalized_mime_type = mime_type.split(';', 1)[0].strip()
        if normalized_mime_type and (
            normalized_mime_type not in BLINK_ALLOWED_MIME_TYPES and
            not normalized_mime_type.startswith('video/')
        ):
            raise ValueError('Unsupported video MIME type.')

        session_duration = _session_duration(form)
        # Stream to a unique temporary file. Concurrent rechecks cannot overwrite
        # each other, and a 200MB upload does not become a 200MB Python buffer.
        size = 0
        with tempfile.NamedTemporaryFile(dir=current_app.config['UPLOAD_FOLDER'], suffix=extension, delete=False) as output_file:
            temp_video_path = output_file.name
            while True:
                chunk = video_file.stream.read(64 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > BLINK_MAX_UPLOAD_BYTES:
                    return {'error': 'Video too large (max 200MB).'}, 413
                output_file.write(chunk)
        if size == 0:
            raise ValueError('Uploaded video is empty.')

        _, analyze_blink_video = get_blink_counter_functions()
        result = analyze_blink_video(temp_video_path, session_duration=session_duration)
        log_info(
            'Blink counter video analysis completed successfully',
            filename=filename,
            session_duration_seconds=session_duration,
        )
        return {'status': 'ok', 'result': result}, 200
    finally:
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.remove(temp_video_path)
            except OSError:
                log_warning('Temporary blink counter file cleanup failed', filename=os.path.basename(temp_video_path))


def _session_duration(payload):
    try:
        session_duration = float(payload.get('session_duration_seconds', DEFAULT_SESSION_DURATION))
    except (TypeError, ValueError):
        raise ValueError('Session length must be a number between 1 and 120 seconds.')
    if not math.isfinite(session_duration) or not 1 <= session_duration <= 120:
        raise ValueError('Session length must be between 1 and 120 seconds.')
    return session_duration


def start_live_session(payload):
    session_duration = _session_duration(payload)

    cleanup_stale_blink_live_sessions()
    session_id = create_blink_live_session(session_duration)
    runtime.BLINK_LIVE_SESSIONS[session_id]['session_id'] = session_id

    log_info(
        'Live blink counter session started successfully',
        session_id=session_id,
        session_duration_seconds=session_duration,
    )
    return {
        'status': 'ok',
        'result': {
            'session_id': session_id,
            'session_duration_seconds': session_duration,
            'min_closed_frames': 1,
            'min_gap_seconds': 0.20,
        },
    }


def analyze_frame(payload):
    raw_use_server_camera = payload.get('use_server_camera')
    if isinstance(raw_use_server_camera, str):
        use_server_camera = raw_use_server_camera.strip().lower() in {'1', 'true', 'yes', 'on'}
    else:
        use_server_camera = bool(raw_use_server_camera)
    image_data = payload.get('image_data')

    if use_server_camera:
        camera_manager = ensure_camera_manager()
        if not camera_manager:
            raise RuntimeError('Camera manager is not available.')

        if not camera_manager.ensure_camera_ready():
            raise RuntimeError('Server camera is unavailable.')

        jpeg_bytes = camera_manager.get_frame()
        if not jpeg_bytes:
            raise RuntimeError('Unable to read frame from server camera.')

        frame_array = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        image_bgr = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
        if image_bgr is None or image_bgr.size == 0:
            raise RuntimeError('Unable to decode server camera frame.')
    else:
        if not image_data or not isinstance(image_data, str):
            raise ValueError('image_data is required.')
        if len(image_data) > 6_000_000:
            return {'error': 'Frame payload is too large.'}, 413
        image_bgr, _ = decode_request_image({'image_data': image_data}, current_app.config['UPLOAD_FOLDER'])

    analyze_blink_frame, _ = get_blink_counter_functions()
    result = analyze_blink_frame(image_bgr)

    session_id = str(payload.get('session_id') or '').strip()
    live_metrics = None
    if session_id:
        cleanup_stale_blink_live_sessions()
        session_state = runtime.BLINK_LIVE_SESSIONS.get(session_id)
        if session_state:
            live_metrics = update_blink_live_session(session_state, result, time.time())
        else:
            return {'error': 'Live blink session expired or was not found.'}, 404

    response_result = dict(result)
    if live_metrics is not None:
        response_result['live_metrics'] = live_metrics

    return {'status': 'ok', 'result': response_result}, 200
