from flask import Blueprint, jsonify, request

from ..services.clinical_service import (
    analyze_contrast_sensitivity,
    analyze_deq,
    analyze_osdi,
    analyze_posterior_segment,
)
from ..utils.logging_utils import log_error, log_info, log_warning


clinical_bp = Blueprint('clinical', __name__)


@clinical_bp.route('/api/clinical/deq', methods=['POST'])
def deq():
    try:
        result = analyze_deq(request.get_json(silent=True) or {})
        log_info('DEQ analysis completed successfully')
        return jsonify({'status': 'ok', 'result': result})
    except ValueError as validation_error:
        log_warning('DEQ analysis rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('DEQ analysis failed')
        return jsonify({'error': f'DEQ analysis failed: {server_error}'}), 500


@clinical_bp.route('/api/clinical/osdi', methods=['POST'])
def osdi():
    try:
        result = analyze_osdi(request.get_json(silent=True) or {})
        log_info('OSDI analysis completed successfully')
        return jsonify({'status': 'ok', 'result': result})
    except ValueError as validation_error:
        log_warning('OSDI analysis rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('OSDI analysis failed')
        return jsonify({'error': f'OSDI analysis failed: {server_error}'}), 500


@clinical_bp.route('/api/clinical/contrast-sensitivity', methods=['POST'])
def contrast_sensitivity():
    try:
        result = analyze_contrast_sensitivity(request.get_json(silent=True) or {})
        log_info('Contrast sensitivity analysis completed successfully')
        return jsonify({'status': 'ok', 'result': result})
    except ValueError as validation_error:
        log_warning('Contrast sensitivity analysis rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('Contrast sensitivity analysis failed')
        return jsonify({'error': f'Contrast sensitivity analysis failed: {server_error}'}), 500


@clinical_bp.route('/api/clinical/posterior-segment', methods=['POST'])
def posterior_segment():
    try:
        result = analyze_posterior_segment(request.get_json(silent=True) or {})
        log_info('Posterior segment analysis completed successfully')
        return jsonify({'status': 'ok', 'result': result})
    except ValueError as validation_error:
        log_warning('Posterior segment analysis rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception as server_error:
        log_error('Posterior segment analysis failed')
        return jsonify({'error': f'Posterior segment analysis failed: {server_error}'}), 500
