"""Lazy-loading and process-wide runtime services."""

import time
import uuid
import threading

from flask import current_app

from ..core import runtime
from ..core.constants import BLINK_LIVE_SESSION_TTL_SECONDS, DEFAULT_SESSION_DURATION
from ..utils.logging_utils import get_logger
from .camera_manager import get_camera_manager, init_camera_manager


logger = get_logger()
_meibography_init_lock = threading.Lock()
_warmup_lock = threading.Lock()
_warmup_thread = None


def get_blink_counter_functions():
    try:
        if runtime.BLINK_COUNTER_FUNCTIONS is None:
            from ..modules.blink.detector import analyze_blink_frame, analyze_blink_video

            runtime.BLINK_COUNTER_FUNCTIONS = (analyze_blink_frame, analyze_blink_video)
            logger.info('Blink counter service helpers loaded')
        return runtime.BLINK_COUNTER_FUNCTIONS
    except Exception:
        logger.error('Failed to load blink counter service helpers', exc_info=True)
        raise


def ensure_meibography_service():
    # Image preparation may preload in a background thread while analysis starts.
    # Both callers must receive the same singleton and the same load lock.
    with _meibography_init_lock:
        return _initialize_meibography_service()


def _initialize_meibography_service():
    try:
        if runtime.MEIBOGRAPHY_SERVICE_HELPERS is None:
            from ..modules.meibography.model_service import init_meibography_model_service, get_meibography_model_service

            runtime.MEIBOGRAPHY_SERVICE_HELPERS = {
                'init': init_meibography_model_service,
                'get': get_meibography_model_service,
            }
            logger.info('Meibography service helpers loaded')

        service = runtime.MEIBOGRAPHY_SERVICE_HELPERS['get']()
        if service is None:
            logger.info('Initializing meibography model service')
            runtime.MEIBOGRAPHY_SERVICE_HELPERS['init'](
                current_app.config['MEIBOGRAPHY_MODEL_FOLDER'],
                backend=current_app.config.get('MEIBOGRAPHY_INFERENCE_BACKEND', 'torch'),
            )
            service = runtime.MEIBOGRAPHY_SERVICE_HELPERS['get']()
        return service
    except Exception:
        logger.error('Failed to initialize meibography model service', exc_info=True)
        raise


def is_meibography_warming():
    return bool(_warmup_thread and _warmup_thread.is_alive())


def start_meibography_warmup():
    """Load checkpoints after image-selection intent, without holding the response."""
    global _warmup_thread
    with _warmup_lock:
        helpers = runtime.MEIBOGRAPHY_SERVICE_HELPERS
        service = helpers['get']() if helpers else None
        if service is not None and service.loaded:
            return False
        if is_meibography_warming():
            return True
        app = current_app._get_current_object()

        def prepare():
            try:
                with app.app_context():
                    ensure_meibography_service().ensure_loaded()
            except Exception:
                logger.error('Meibography background initialization failed', exc_info=True)

        _warmup_thread = threading.Thread(target=prepare, name='meibography-warmup', daemon=True)
        _warmup_thread.start()
        return True


def get_tmh_analyzer():
    try:
        if runtime.TMH_ANALYZER is None:
            from ..modules.meibography.tear_meniscus import analyze_tmh_measurement

            runtime.TMH_ANALYZER = analyze_tmh_measurement
            logger.info('Tear meniscus analyzer loaded')
        return runtime.TMH_ANALYZER
    except Exception:
        logger.error('Failed to load tear meniscus analyzer', exc_info=True)
        raise


def ensure_camera_manager():
    try:
        camera_manager = get_camera_manager()
        if camera_manager:
            return camera_manager

        init_camera_manager(current_app.config['UPLOAD_FOLDER'], camera_enabled=current_app.config['CAMERA_ENABLED'])
        logger.info('Camera manager initialized | camera_enabled=%s', bool(current_app.config['CAMERA_ENABLED']))
        return get_camera_manager()
    except Exception:
        logger.error('Failed to initialize camera manager', exc_info=True)
        raise


def cleanup_stale_blink_live_sessions(now_ts=None):
    now_ts = float(now_ts if now_ts is not None else time.time())
    expired_ids = [
        session_id
        for session_id, state in list(runtime.BLINK_LIVE_SESSIONS.items())
        if (now_ts - float(state.get('last_seen_at', now_ts))) > BLINK_LIVE_SESSION_TTL_SECONDS
    ]
    for session_id in expired_ids:
        runtime.BLINK_LIVE_SESSIONS.pop(session_id, None)


def create_blink_live_session(duration_seconds):
    from ..modules.blink.tracker import BlinkTracker

    cleanup_stale_blink_live_sessions()
    if len(runtime.BLINK_LIVE_SESSIONS) >= 128:
        raise RuntimeError('Blink analysis is busy. Try again shortly.')
    session_id = uuid.uuid4().hex
    now_ts = time.time()
    runtime.BLINK_LIVE_SESSIONS[session_id] = {
        'session_id': session_id,
        'started_at': now_ts, 'last_seen_at': now_ts,
        'duration_seconds': float(duration_seconds),
        'tracker': BlinkTracker(), 'session_complete': False,
    }
    return session_id


def update_blink_live_session(session_state, frame_result, now_ts):
    from ..modules.blink.tracker import BlinkTracker

    now_ts = float(now_ts)
    session_state['last_seen_at'] = now_ts
    started_at = float(session_state.get('started_at', now_ts))
    duration = max(1.0, float(session_state.get('duration_seconds', DEFAULT_SESSION_DURATION)))
    elapsed_raw = max(0.0, now_ts - started_at)
    elapsed = min(duration, elapsed_raw)
    tracker = session_state.setdefault('tracker', BlinkTracker())
    # Freeze completed sessions; repeated requests cannot change the result.
    if not session_state.get('session_complete'):
        if elapsed_raw <= duration:
            tracker.update(frame_result, elapsed)
        session_state['session_complete'] = elapsed_raw >= duration
    result = tracker.result(max(0.001, elapsed))
    result.update({
        'session_id': session_state.get('session_id', ''),
        'elapsed_seconds': round(elapsed, 2),
        'remaining_seconds': round(max(0.0, duration - elapsed), 2),
        'session_duration_seconds': duration,
        'session_complete': bool(session_state.get('session_complete')),
        'face_found_frames': tracker.processed_frames,
        'closed_frames': tracker.closed_frames,
    })
    return result
