from flask import Blueprint, jsonify, request
from .guest import guest_analyze, guest_enhance, guest_model_status, guest_model_warmup, guest_tear_meniscus

from ...utils.logging_utils import log_error, log_warning
from ...utils.resource_limits import limit_image_processing
from .service import (
    analyze_meibography_request,
    enhance_snapshot_request,
    get_model_status,
    measure_tear_meniscus_request,
    warm_meibography_request,
)


meibography_bp = Blueprint('meibography', __name__)
meibography_bp.add_url_rule('/api/guest/meibography/status', view_func=guest_model_status, methods=['GET'])
meibography_bp.add_url_rule('/api/guest/meibography/warmup', view_func=guest_model_warmup, methods=['POST'])
meibography_bp.add_url_rule('/api/guest/meibography/analyze', view_func=guest_analyze, methods=['POST'])
meibography_bp.add_url_rule('/api/guest/meibography/enhance', view_func=guest_enhance, methods=['POST'])
meibography_bp.add_url_rule('/api/guest/meibography/tear-meniscus', view_func=guest_tear_meniscus, methods=['POST'])


@meibography_bp.route('/api/model/status', methods=['GET'])
def get_meibography_model_status():
    try:
        return jsonify(get_model_status())
    except Exception:
        log_error('Failed to load meibography model service for status request')
        return jsonify({'loaded': False, 'error': 'Meibography model service unavailable.'}), 200


@meibography_bp.route('/api/model/analyze', methods=['POST'])
@limit_image_processing
def analyze_meibography():
    try:
        response_payload, status_code = analyze_meibography_request(request.get_json(silent=True) or {})
        return jsonify(response_payload), status_code
    except ValueError as validation_error:
        log_warning('Meibography analysis rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except FileNotFoundError as missing_model_error:
        log_warning('Meibography analysis unavailable', reason=str(missing_model_error))
        return jsonify({'error': str(missing_model_error), 'status': 'unavailable'}), 503
    except Exception as server_error:
        log_error('Meibography analysis failed')
        return jsonify({'error': f'Meibography analysis failed: {server_error}'}), 500


@meibography_bp.route('/api/model/warmup', methods=['POST'])
def warm_meibography_models():
    payload, status = warm_meibography_request()
    return jsonify(payload), status


@meibography_bp.route('/api/predict', methods=['POST'])
def predict_meibography():
    return analyze_meibography()


@meibography_bp.route('/api/enhance', methods=['POST'])
@limit_image_processing
def enhance_snapshot():
    try:
        return jsonify(enhance_snapshot_request(request.get_json(silent=True) or {}))
    except ValueError as validation_error:
        log_warning('Image enhancement rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('Image enhancement failed')
        return jsonify({'error': f'Image enhancement failed: {server_error}'}), 500


@meibography_bp.route('/api/tear-meniscus/measure', methods=['POST'])
@limit_image_processing
def measure_tear_meniscus():
    try:
        return jsonify(measure_tear_meniscus_request(request.get_json() or {}))
    except ValueError as validation_error:
        log_warning('Tear meniscus measurement rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('Tear meniscus measurement failed')
        return jsonify({'error': f'Tear meniscus measurement failed: {server_error}'}), 500
