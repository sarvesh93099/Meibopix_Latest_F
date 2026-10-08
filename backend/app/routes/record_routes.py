from flask import Blueprint, g, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from ..models import db
from ..services.record_service import get_assessments, get_reports, save_assessment, save_report_from_request
from ..utils.logging_utils import log_error
from ..utils.request_utils import resolve_results_kind


record_bp = Blueprint('records', __name__)


@record_bp.route('/api/reports', methods=['POST'])
def save_report():
    try:
        report = save_report_from_request(getattr(g, 'auth_user', None))
        return jsonify(report.to_dict()), 201
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except ValueError as validation_error:
        return jsonify({'error': str(validation_error)}), 400
    except RequestEntityTooLarge:
        raise
    except Exception:
        db.session.rollback()
        log_error('Failed to save report')
        return jsonify({'error': 'Failed to save report'}), 500


@record_bp.route('/api/reports', methods=['GET'])
def fetch_reports():
    try:
        return jsonify(get_reports(getattr(g, 'auth_user', None), patient_id=request.args.get('patient_id')))
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except Exception:
        log_error('Failed to fetch reports')
        return jsonify({'error': 'Failed to fetch reports'}), 500


@record_bp.route('/api/assessments', methods=['GET'])
def fetch_assessments():
    try:
        latest_only = str(request.args.get('latest', '')).lower() in {'1', 'true', 'yes'}
        return jsonify(
            get_assessments(
                getattr(g, 'auth_user', None),
                patient_id=request.args.get('patient_id'),
                latest_only=latest_only,
                status=request.args.get('status'),
            )
        )
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except Exception:
        log_error('Failed to fetch assessments')
        return jsonify({'error': 'Failed to fetch assessments'}), 500


@record_bp.route('/api/assessments', methods=['POST'])
def persist_assessment():
    try:
        assessment = save_assessment(request.get_json() or {}, getattr(g, 'auth_user', None))
        return jsonify(assessment.to_dict()), 200
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except ValueError as validation_error:
        return jsonify({'error': str(validation_error)}), 400
    except Exception:
        db.session.rollback()
        log_error('Failed to save assessment')
        return jsonify({'error': 'Failed to save assessment'}), 500


@record_bp.route('/api/results', methods=['GET'])
def get_results():
    result_kind = resolve_results_kind(default_kind='report')
    if result_kind == 'assessment':
        return fetch_assessments()
    if result_kind != 'report':
        return jsonify({'error': 'kind must be report or assessment'}), 400
    return fetch_reports()


@record_bp.route('/api/results', methods=['POST'])
def save_results():
    result_kind = resolve_results_kind(default_kind='report')
    if result_kind == 'assessment':
        return persist_assessment()
    if result_kind != 'report':
        return jsonify({'error': 'kind must be report or assessment'}), 400
    return save_report()
