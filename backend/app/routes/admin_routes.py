from flask import Blueprint, g, jsonify, request

from ..models import db
from ..services.admin_service import (
    approve_signup_request,
    delete_doctor_account,
    get_admin_dashboard_data,
    reject_signup_request,
    update_doctor_disabled_state,
    update_doctor_password,
)
from ..services.auth_service import serialize_doctor_request, user_has_role
from ..utils.logging_utils import log_error, log_info, log_warning


admin_bp = Blueprint('admin', __name__)


def _require_admin():
    if not user_has_role(getattr(g, 'auth_user', None), 'admin'):
        log_warning('Rejected non-admin request')
        return jsonify({'error': 'Admin access is required.'}), 403
    return None


@admin_bp.route('/api/admin/dashboard', methods=['GET'])
def get_admin_dashboard():
    admin_guard = _require_admin()
    if admin_guard is not None:
        return admin_guard

    try:
        payload = get_admin_dashboard_data()
        log_info(
            'Admin dashboard metrics generated successfully',
            doctor_count=payload['summary']['total_doctors'],
            total_patients=payload['summary']['total_patients'],
            total_logins=payload['summary']['total_logins'],
        )
        return jsonify(payload)
    except Exception:
        log_error('Failed to generate admin dashboard metrics')
        return jsonify({'error': 'Failed to load admin dashboard metrics.'}), 500


@admin_bp.route('/api/admin/requests/<int:request_id>/approve', methods=['POST'])
def approve_request(request_id):
    admin_guard = _require_admin()
    if admin_guard is not None:
        return admin_guard

    try:
        doctor, request_record = approve_signup_request(request_id, request.get_json(silent=True) or {})
        log_info('Doctor signup request approved', request_id=request_record.id, doctor_id=doctor.id, username=doctor.username)
        return jsonify({
            'success': True,
            'doctor': doctor.to_safe_dict(),
            'request': serialize_doctor_request(request_record),
        })
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except FileExistsError as conflict_error:
        return jsonify({'error': str(conflict_error)}), 409
    except ValueError as validation_error:
        db.session.rollback()
        log_warning('Doctor signup approval rejected', request_id=request_id, reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception:
        db.session.rollback()
        log_error('Failed to approve doctor signup request', request_id=request_id)
        return jsonify({'error': 'Failed to approve signup request.'}), 500


@admin_bp.route('/api/admin/requests/<int:request_id>/reject', methods=['POST'])
def reject_request(request_id):
    admin_guard = _require_admin()
    if admin_guard is not None:
        return admin_guard

    try:
        request_record = reject_signup_request(request_id)
        log_info('Doctor signup request rejected', request_id=request_record.id, email=request_record.email)
        return jsonify({
            'success': True,
            'request': serialize_doctor_request(request_record),
        })
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except RuntimeError as conflict_error:
        return jsonify({'error': str(conflict_error)}), 409
    except Exception:
        db.session.rollback()
        log_error('Failed to reject doctor signup request', request_id=request_id)
        return jsonify({'error': 'Failed to reject signup request.'}), 500


@admin_bp.route('/api/admin/doctors/<int:doctor_id>/password', methods=['POST'])
def change_doctor_password(doctor_id):
    admin_guard = _require_admin()
    if admin_guard is not None:
        return admin_guard

    try:
        doctor = update_doctor_password(doctor_id, request.get_json(silent=True) or {})
        log_info('Doctor password updated by admin', doctor_id=doctor.id)
        return jsonify({'success': True, 'doctor': doctor.to_safe_dict()})
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except ValueError as validation_error:
        db.session.rollback()
        log_warning('Doctor password update rejected', doctor_id=doctor_id, reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception:
        db.session.rollback()
        log_error('Failed to update doctor password', doctor_id=doctor_id)
        return jsonify({'error': 'Failed to update doctor password.'}), 500


@admin_bp.route('/api/admin/doctors/<int:doctor_id>/disable', methods=['POST'])
def disable_doctor(doctor_id):
    admin_guard = _require_admin()
    if admin_guard is not None:
        return admin_guard

    try:
        doctor = update_doctor_disabled_state(doctor_id, request.get_json(silent=True) or {})
        log_info('Doctor active status updated by admin', doctor_id=doctor.id, is_active=doctor.is_active)
        return jsonify({'success': True, 'doctor': doctor.to_safe_dict()})
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except Exception:
        db.session.rollback()
        log_error('Failed to update doctor active status', doctor_id=doctor_id)
        return jsonify({'error': 'Failed to update doctor status.'}), 500


@admin_bp.route('/api/admin/doctors/<int:doctor_id>', methods=['DELETE'])
def remove_doctor(doctor_id):
    admin_guard = _require_admin()
    if admin_guard is not None:
        return admin_guard

    try:
        patients_unassigned = delete_doctor_account(doctor_id)
        log_info('Doctor account deleted by admin', doctor_id=doctor_id, patients_unassigned=patients_unassigned)
        return jsonify({'success': True, 'patients_unassigned': patients_unassigned})
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except Exception:
        db.session.rollback()
        log_error('Failed to delete doctor account', doctor_id=doctor_id)
        return jsonify({'error': 'Failed to delete doctor account.'}), 500
