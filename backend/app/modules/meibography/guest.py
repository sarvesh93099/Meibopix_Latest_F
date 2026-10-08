"""Stateless guest inference. Never accept references to patient/server files."""

import json
import math

from flask import current_app, jsonify, request

from ...utils.image_utils import decode_request_image
from ...utils.logging_utils import log_error
from ...utils.resource_limits import IMAGE_PROCESSING_SLOT as GUEST_ANALYSIS_SLOT
from .service import (
    analyze_meibography_request, enhance_snapshot_request, get_model_status,
    measure_tear_meniscus_request,
    warm_meibography_request,
)

MAX_GUEST_IMAGE_BYTES = 8 * 1024 * 1024
MAX_GUEST_REQUEST_BYTES = 12 * 1024 * 1024
MAX_GUEST_PIXELS = 6000000
ALLOWED_FIELDS = {'image_data', 'eye', 'lid', 'source_lid', 'brightness', 'contrast',
                  'manual_eyelid_points', 'manual_eyelid_closed', 'include_gland_progression',
                  'compact_response'}
TEAR_FIELDS = {'image_data', 'eye', 'brightness', 'contrast', 'points', 'cornea_width_pixels'}


def validate_guest_payload(payload, *, action='analyze'):
    if not isinstance(payload, dict):
        raise ValueError('Choose an image to analyze.')
    allowed = TEAR_FIELDS if action == 'tear-meniscus' else {'image_data'} if action == 'enhance' else ALLOWED_FIELDS
    if set(payload) - allowed:
        raise ValueError('Guest analysis accepts your image and test settings only.')
    image_data = payload.get('image_data')
    if not isinstance(image_data, str) or not image_data.startswith('data:image/') or ';base64,' not in image_data[:100]:
        raise ValueError('Upload an image or load a sample first.')
    if len(image_data) > ((MAX_GUEST_IMAGE_BYTES + 2) // 3) * 4 + 100:
        raise ValueError('Choose an image smaller than 8 MB.')
    if payload.get('lid', 'lower') not in ('lower', 'upper'):
        raise ValueError('Choose the upper or lower lid.')
    if payload.get('eye', 'unknown') not in ('left', 'right', 'unknown', 'os', 'od'):
        raise ValueError('Choose the left or right eye.')
    source_lid = payload.get('source_lid')
    if source_lid not in (None, '', 'lower', 'upper'):
        raise ValueError('Choose the upper or lower source lid.')
    if source_lid and source_lid != payload.get('lid', 'lower'):
        raise ValueError(f'This image is for the {source_lid} lid. Select the {source_lid} lid to continue.')
    for setting in ('brightness', 'contrast'):
        value = payload.get(setting, 50)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
            raise ValueError('Brightness and contrast must be between 0 and 100.')
    points = payload.get('points', []) if action == 'tear-meniscus' else payload.get('manual_eyelid_points', [])
    if action == 'tear-meniscus' and (not isinstance(points, list) or len(points) != 2):
        raise ValueError('Select the top and bottom edge of the tear meniscus.')
    if not isinstance(points, list) or len(points) > 500:
        raise ValueError('Use at most 500 outline points.')
    for point in points:
        if not isinstance(point, dict):
            raise ValueError('Each outline point needs x and y coordinates.')
        for coordinate in ('x', 'y'):
            value = point.get(coordinate)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('Outline points must stay inside the image.')
    if not isinstance(payload.get('manual_eyelid_closed', False), bool):
        raise ValueError('The outline closed setting must be true or false.')
    if not isinstance(payload.get('include_gland_progression', False), bool):
        raise ValueError('include_gland_progression must be true or false.')
    if not isinstance(payload.get('compact_response', False), bool):
        raise ValueError('compact_response must be true or false.')
    if 'cornea_width_pixels' in payload:
        span = payload['cornea_width_pixels']
        if isinstance(span, bool) or not isinstance(span, (int, float)) or not math.isfinite(span) or span <= 0:
            raise ValueError('The corneal calibration span must be greater than zero.')
    return payload


def guest_model_status():
    status = get_model_status()
    response = jsonify({key: status.get(key) for key in (
        'available', 'loaded', 'lower_models_available', 'upper_models_available',
        'load_on_first_analysis', 'loading', 'error',
    )})
    response.headers['Cache-Control'] = 'no-store'
    return response


def guest_model_warmup():
    # No image, patient, storage reference, or credentials are needed to preload.
    payload, status = warm_meibography_request()
    response = jsonify(payload)
    response.headers['Cache-Control'] = 'no-store'
    return response, status


def _guest_image_action(action):
    # A bounded read also handles chunked requests without allocating the normal
    # clinical/video upload limit. Share one image slot with clinician processing.
    if not GUEST_ANALYSIS_SLOT.acquire(blocking=False):
        response = jsonify({'error': 'Another guest test is running. Try again shortly.'})
        response.headers['Retry-After'] = '5'
        return response, 429
    try:
        if not request.is_json:
            return jsonify({'error': 'Send an image as JSON.'}), 400
        body = request.stream.read(MAX_GUEST_REQUEST_BYTES + 1)
        if len(body) > MAX_GUEST_REQUEST_BYTES:
            return jsonify({'error': 'Choose an image smaller than 8 MB.'}), 413
        try:
            payload = validate_guest_payload(json.loads(body), action=action)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({'error': 'The image request could not be read.'}), 400
        # Validate/decode before loading ML. image_url/path keys were rejected above.
        decoded = decode_request_image(
            payload,
            max_bytes=min(MAX_GUEST_IMAGE_BYTES, current_app.config['MAX_IMAGE_UPLOAD_BYTES']),
            max_pixels=min(MAX_GUEST_PIXELS, current_app.config['MAX_IMAGE_PIXELS']),
        )
        if action == 'enhance':
            response_payload, status = enhance_snapshot_request(payload, decoded_image=decoded), 200
        elif action == 'tear-meniscus':
            response_payload, status = measure_tear_meniscus_request(payload, decoded_image=decoded), 200
        else:
            response_payload, status = analyze_meibography_request(payload, decoded_image=decoded)
        response_payload['guest_preview'] = True
        response = jsonify(response_payload)
        response.headers['Cache-Control'] = 'no-store'
        return response, status
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    except FileNotFoundError:
        return jsonify({'error': 'Image analysis models are unavailable on this server.'}), 503
    except Exception:
        log_error('Guest image test failed', action=action)
        return jsonify({'error': 'Image analysis could not finish. Please try again.'}), 503
    finally:
        GUEST_ANALYSIS_SLOT.release()


def guest_analyze():
    return _guest_image_action('analyze')


def guest_enhance():
    return _guest_image_action('enhance')


def guest_tear_meniscus():
    return _guest_image_action('tear-meniscus')
