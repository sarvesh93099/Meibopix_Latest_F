from flask import Blueprint, g, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from ..models import db
from ..services.patient_service import (
    create_patient_from_payload,
    delete_patient_and_related_files,
    get_captures_for_patient,
    get_patient_for_current_user,
    get_patients_for_user,
    handle_uploaded_file_request,
    update_patient_from_payload,
)
from ..utils.logging_utils import log_error, log_warning


patient_bp = Blueprint('patient', __name__)


@patient_bp.route('/api/patients', methods=['GET'])
def get_patients():
    patients = get_patients_for_user(getattr(g, 'auth_user', None))
    return jsonify([patient.to_dict() for patient in patients])


@patient_bp.route('/api/patients/<int:patient_id>', methods=['GET'])
def get_patient(patient_id):
    patient = get_patient_for_current_user(patient_id, getattr(g, 'auth_user', None))
    if not patient:
        return jsonify({'error': 'Patient not found'}), 404
    return jsonify(patient.to_dict())


@patient_bp.route('/api/patients', methods=['POST'])
def create_patient():
    try:
        patient = create_patient_from_payload(request.get_json() or {}, getattr(g, 'auth_user', None))
        return jsonify(patient.to_dict()), 201
    except ValueError as validation_error:
        db.session.rollback()
        log_warning('Patient creation rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception:
        db.session.rollback()
        log_error('Failed to create patient')
        return jsonify({'error': 'Failed to create patient'}), 500


@patient_bp.route('/api/patients/<int:patient_id>', methods=['PUT'])
def update_patient(patient_id):
    try:
        patient = update_patient_from_payload(patient_id, request.get_json() or {}, getattr(g, 'auth_user', None))
        return jsonify(patient.to_dict())
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except ValueError as validation_error:
        db.session.rollback()
        log_warning('Patient update rejected', patient_id=patient_id, reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception:
        db.session.rollback()
        log_error('Failed to update patient', patient_id=patient_id)
        return jsonify({'error': 'Failed to update patient'}), 500


@patient_bp.route('/api/patients/<int:patient_id>', methods=['DELETE'])
def delete_patient(patient_id):
    try:
        delete_patient_and_related_files(patient_id, getattr(g, 'auth_user', None))
        return jsonify({'message': 'Patient deleted successfully'})
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except Exception:
        db.session.rollback()
        log_error('Failed to delete patient', patient_id=patient_id)
        return jsonify({'error': 'Failed to delete patient'}), 500


@patient_bp.route('/api/patients/<int:patient_id>/upload', methods=['POST'])
def upload_patient_image(patient_id):
    try:
        return jsonify(handle_uploaded_file_request(patient_id_override=patient_id, current_user=getattr(g, 'auth_user', None)))
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except ValueError as validation_error:
        return jsonify({'error': str(validation_error)}), 400
    except RequestEntityTooLarge:
        raise
    except Exception:
        log_error('Failed to handle patient upload request', patient_id=patient_id)
        return jsonify({'error': 'Failed to upload image'}), 500


@patient_bp.route('/api/captures', methods=['GET'])
def get_captures():
    patient_id = request.args.get('patient_id')
    if not patient_id:
        return jsonify({'error': 'Patient ID is required'}), 400

    try:
        captures = get_captures_for_patient(patient_id, getattr(g, 'auth_user', None))
        return jsonify([capture.to_dict() for capture in captures])
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except Exception:
        log_error('Failed to fetch captures', patient_id=patient_id)
        return jsonify({'error': 'Failed to get captures'}), 500
