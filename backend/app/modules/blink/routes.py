from flask import Blueprint, current_app, jsonify, request

from ...utils.logging_utils import log_error, log_warning
from ...utils.resource_limits import limit_image_processing
from .service import analyze_blink_video_form, analyze_frame, start_live_session


blink_bp = Blueprint('blink', __name__)


@blink_bp.route('/api/blink-counter/analyze', methods=['POST'])
@limit_image_processing
def analyze_blink_counter():
    if not current_app.config.get('SERVER_BLINK_ENABLED', True):
        return jsonify({'error': 'Use the browser blink test. Server recording recheck is disabled on this host.'}), 503
    try:
        payload, status_code = analyze_blink_video_form(request.files, request.form)
        return jsonify(payload), status_code
    except ValueError as validation_error:
        log_warning('Blink counter video analysis rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('Blink counter video analysis failed')
        return jsonify({'error': f'Blink counter analysis failed: {server_error}'}), 500


@blink_bp.route('/api/blink-counter/live/start', methods=['POST'])
def start_live_blink_counter_session():
    if not current_app.config.get('SERVER_BLINK_ENABLED', True):
        return jsonify({'error': 'Use the browser blink test. Server blink analysis is disabled on this host.'}), 503
    try:
        return jsonify(start_live_session(request.get_json(silent=True) or {}))
    except ValueError as validation_error:
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('Unable to start live blink session')
        return jsonify({'error': f'Unable to start live blink session: {server_error}'}), 500


@blink_bp.route('/api/blink-counter/frame', methods=['POST'])
@limit_image_processing
def analyze_blink_counter_frame():
    if not current_app.config.get('SERVER_BLINK_ENABLED', True):
        return jsonify({'error': 'Use the browser blink test. Server blink analysis is disabled on this host.'}), 503
    try:
        payload, status_code = analyze_frame(request.get_json(silent=True) or {})
        return jsonify(payload), status_code
    except ValueError as validation_error:
        log_warning('Live blink frame analysis rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('Live blink frame analysis failed')
        return jsonify({'error': f'Live blink frame analysis failed: {server_error}'}), 500
