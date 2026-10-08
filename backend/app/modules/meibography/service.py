"""Business logic for meibography and tear meniscus analysis."""

import importlib.util
import os
import time
from datetime import datetime

from flask import current_app

from ...core import runtime
from ...services.runtime_services import (
    ensure_meibography_service, get_tmh_analyzer,
    is_meibography_warming, start_meibography_warmup,
)
from ...utils.image_utils import (
    annotate_tmh_measurement,
    apply_brightness_contrast,
    auto_enhance_image,
    build_manual_eyelid_mask,
    decode_request_image,
    encode_image_to_data_url,
    parse_normalized_overlay_point,
)
from ...utils.logging_utils import log_info
from .utils import normalize_analysis_request
from .inference_backends import configured_backend, MODEL_FILES


def get_model_status():
    # A readiness probe must stay cheap: opening a page should never import
    # PyTorch or materialize four segmentation networks in memory.
    helpers = runtime.MEIBOGRAPHY_SERVICE_HELPERS
    service = helpers['get']() if helpers else None
    model_dir = current_app.config['MEIBOGRAPHY_MODEL_FOLDER']
    backend = configured_backend()
    extension = '.onnx' if backend == 'onnx' else '.pth'
    lower_available = all(os.path.isfile(os.path.join(model_dir, name + extension)) for name in MODEL_FILES[:2])
    upper_available = all(os.path.isfile(os.path.join(model_dir, name + extension)) for name in MODEL_FILES[2:])
    modules = ('onnxruntime',) if backend == 'onnx' else ('torch', 'segmentation_models_pytorch')
    dependencies_available = all(importlib.util.find_spec(module) is not None for module in modules)
    status = service.get_status() if service else {
        'loaded': False,
        'device': 'not initialized',
        'lower_models_ready': False,
        'upper_models_ready': False,
        'error': '',
    }
    status.update({
        'available': bool(lower_available and dependencies_available),
        'lower_models_available': bool(lower_available and dependencies_available),
        'upper_models_available': bool(upper_available and dependencies_available),
        'dependencies_available': dependencies_available,
        'load_on_first_analysis': True,
        'loading': is_meibography_warming(),
        'inference_backend': backend,
    })
    if not dependencies_available:
        status['error'] = 'Install backend/requirements.txt to enable image analysis.'
    elif not lower_available:
        status['error'] = 'Meibography model weights are not installed. Other tools remain available.'
    log_info('Meibography model status fetched successfully', loaded=status.get('loaded'))
    return status


def warm_meibography_request():
    status = get_model_status()
    if not status['available']:
        return {'status': 'unavailable', 'available': False, 'error': status['error']}, 503
    loading = start_meibography_warmup()
    return {
        'status': 'warming' if loading else 'ready', 'available': True,
        'loaded': not loading, 'loading': loading,
    }, 202 if loading else 200


def analyze_meibography_request(payload, *, decoded_image=None):
    """Release ONNX weights on success, rejected images, and failed inference alike."""
    try:
        response, status = _analyze_meibography_request(payload, decoded_image=decoded_image)
    finally:
        helpers = runtime.MEIBOGRAPHY_SERVICE_HELPERS
        service = helpers['get']() if helpers else None
        if (service is not None and service.backend.name == 'onnx'
                and current_app.config.get('ONNX_RELEASE_AFTER_REQUEST', True)):
            service.backend.release()
    if 'model' in response and service is not None:
        response['model'] = service.get_status()
    return response, status


def _analyze_meibography_request(payload, *, decoded_image=None):
    started_at = time.perf_counter()
    status = get_model_status()
    if not status['available']:
        return {'status': 'unavailable', 'error': status['error']}, 503
    service = ensure_meibography_service()
    if not service:
        raise RuntimeError('Meibography model service unavailable.')

    options = normalize_analysis_request(payload)
    lid = options['lid']
    eye = options['eye']
    source_lid = options['source_lid']
    raw_manual_points = options['manual_points']
    manual_point_count = len(raw_manual_points) if isinstance(raw_manual_points, list) else 0

    if lid not in ['upper', 'lower']:
        raise ValueError('Lid must be upper or lower.')

    if source_lid not in (None, ''):
        if source_lid not in ['upper', 'lower']:
            raise ValueError('source_lid must be upper or lower when provided.')
        if source_lid != lid:
            raise ValueError(f'This image is for the {source_lid} lid. Select the {source_lid} lid to continue.')

    image_bgr, image_source = decoded_image if decoded_image is not None else decode_request_image(payload, current_app.config['UPLOAD_FOLDER'])
    image_bgr = apply_brightness_contrast(
        image_bgr,
        options['brightness'],
        options['contrast'],
    )
    eyelid_probabilities = {}
    lid_detection = service.detect_lid_side(image_bgr, probability_maps=eyelid_probabilities)
    predicted_lid = lid_detection.get('predicted_lid')
    if lid == 'upper' and lid_detection.get('confident') and predicted_lid == 'lower':
        return {
            'error': f'This image is for the {predicted_lid} lid. Select the {predicted_lid} lid to continue.',
            'detected_lid': predicted_lid,
            'lid_detection': lid_detection,
        }, 400

    manual_eyelid_mask = build_manual_eyelid_mask(
        image_bgr,
        raw_manual_points,
        options['manual_closed'],
    )

    analysis = service.analyze(
        image_bgr, lid=lid, manual_eyelid_mask=manual_eyelid_mask,
        eyelid_probability=eyelid_probabilities.get(lid),
        include_progress_frames=options['include_progress_frames'],
    )
    stats = analysis['stats']
    # Include image encoding in the timing: it is part of the user's wait.
    meibo_image_data = encode_image_to_data_url(analysis['meibo_frame'])
    source_image_data = encode_image_to_data_url(analysis['source_frame'])
    eyelid_image_data = encode_image_to_data_url(analysis['eyelid_frame'])
    progression_image_data = [
        encode_image_to_data_url(frame, mime_type='image/jpeg')
        for frame in analysis.get('gland_progress_frames', [])
    ]
    duration_ms = (time.perf_counter() - started_at) * 1000.0
    log_info(
        'Meibography analysis completed successfully',
        lid=lid,
        eye=eye,
        source=image_source,
        manual_point_count=manual_point_count,
        duration_ms=duration_ms,
        grade=stats.get('grade', 'N/A'),
    )
    response_payload = {
        'status': 'ok',
        'result': {
            'summary': analysis['summary'],
            'source': image_source,
            'eye': eye,
            'lid': lid,
            'detected_lid': predicted_lid,
            'coverage_pct': stats.get('coverage_pct', 0),
            'dropout_pct': stats.get('dropout_pct', 0),
            'grade': stats.get('grade', 'N/A'),
            'gland_count': stats.get('gland_count', 0),
            'probability_mean': stats.get('prob_mean', 0),
            'probability_max': stats.get('prob_max', 0),
            'eyelid_side': stats.get('eyelid_side', lid),
            'analysis_duration_ms': round(duration_ms, 1),
            'source_image_data': source_image_data,
            'eyelid_boundary_image_data': eyelid_image_data,
            'meibomian_evaluation_image_data': meibo_image_data,
            'gland_progression_image_data': progression_image_data,
            'annotated_image_data': meibo_image_data,
        },
        'lid_detection': lid_detection,
        'model': service.get_status(),
    }
    if options['compact_response']:
        # Keep the canonical gland overlay once; older clients retain both names.
        response_payload['result'].pop('annotated_image_data', None)
    return response_payload, 200


def enhance_snapshot_request(payload, *, decoded_image=None):
    image_bgr, image_source = decoded_image if decoded_image is not None else decode_request_image(payload, current_app.config['UPLOAD_FOLDER'])
    enhanced_image = auto_enhance_image(image_bgr)
    log_info('Image enhancement completed successfully', source=image_source)
    return {
        'status': 'ok',
        'result': {
            'source': image_source,
            'enhanced_image_data': encode_image_to_data_url(enhanced_image),
            'method': 'Bounded luminance contrast and sharpening',
        },
    }


def measure_tear_meniscus_request(payload, *, decoded_image=None):
    analyze_tmh_measurement = get_tmh_analyzer()
    image_bgr, image_source = decoded_image if decoded_image is not None else decode_request_image(payload, current_app.config['UPLOAD_FOLDER'])
    image_bgr = apply_brightness_contrast(
        image_bgr,
        payload.get('brightness', 50),
        payload.get('contrast', 50),
    )

    points = payload.get('points', [])
    if not isinstance(points, list) or len(points) != 2:
        raise ValueError('Exactly two points are required for tear meniscus measurement.')

    height, width = image_bgr.shape[:2]
    if height <= 0 or width <= 0:
        raise ValueError('Invalid image dimensions.')

    parsed_points = [parse_normalized_overlay_point(point, width, height) for point in points]
    top_point, bottom_point = sorted(parsed_points, key=lambda point: point['y_px'])
    tear_result = analyze_tmh_measurement(
        image_bgr,
        top_point,
        bottom_point,
        payload.get('cornea_width_pixels'),
    )

    annotated_image = annotate_tmh_measurement(image_bgr, top_point, bottom_point, tear_result['tmh_label'])
    annotated_image_data = encode_image_to_data_url(annotated_image)
    diagram_image_data = encode_image_to_data_url(tear_result['diagram_image'])

    log_info(
        'Tear meniscus measurement completed successfully',
        source=image_source,
        distance_pixels=tear_result['distance_pixels'],
        tmh_label=tear_result['tmh_label'],
    )
    return {
        'status': 'ok',
        'result': {
            'distance_pixels': tear_result['distance_pixels'],
            'label': tear_result['tmh_label'],
            'distance_label': tear_result['distance_label'],
            'tmh_mm': tear_result['tmh_mm'],
            'tmh_label': tear_result['tmh_label'],
            'status_label': tear_result['status_label'],
            'status_color': tear_result['status_color'],
            'cornea_width_pixels': tear_result['cornea_width_pixels'],
            'summary': tear_result['summary'],
            'top_point': {'x': top_point['x'], 'y': top_point['y']},
            'bottom_point': {'x': bottom_point['x'], 'y': bottom_point['y']},
            'annotated_image_data': annotated_image_data,
            'diagram_image_data': diagram_image_data,
            'source': image_source,
            'measured_at': datetime.utcnow().isoformat() + 'Z',
        },
    }
