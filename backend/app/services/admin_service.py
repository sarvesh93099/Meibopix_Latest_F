"""Admin-facing account management business logic."""

from sqlalchemy import func
from werkzeug.security import generate_password_hash

from ..core.constants import (
    DOCTOR_REQUEST_STATUS_APPROVED,
    DOCTOR_REQUEST_STATUS_PENDING,
    DOCTOR_REQUEST_STATUS_REJECTED,
)
from ..models import Doctor, DoctorRequest, Patient, db
from .auth_service import (
    find_doctor_by_email,
    find_doctor_by_username,
    serialize_doctor_request,
    user_role,
    utcnow,
    validate_doctor_email,
    validate_doctor_password,
    validate_doctor_username,
)


def create_signup_request(payload):
    email = validate_doctor_email(payload.get('email'))

    if find_doctor_by_email(email):
        raise FileExistsError('A doctor account already exists for this email address.')

    existing_request = DoctorRequest.query.filter_by(
        email=email,
        status=DOCTOR_REQUEST_STATUS_PENDING,
    ).order_by(DoctorRequest.created_at.desc()).first()
    if existing_request:
        raise FileExistsError('A signup request for this email is already pending review.')

    request_record = DoctorRequest(
        email=email,
        status=DOCTOR_REQUEST_STATUS_PENDING,
    )
    db.session.add(request_record)
    db.session.commit()
    return request_record


def get_admin_dashboard_data():
    patient_counts = dict(
        db.session.query(Patient.doctor_id, func.count(Patient.id))
        .group_by(Patient.doctor_id)
        .all()
    )
    doctors = Doctor.query.order_by(Doctor.username.asc()).all()
    requests = DoctorRequest.query.order_by(DoctorRequest.created_at.desc(), DoctorRequest.id.desc()).all()

    doctor_rows = []
    total_logins = 0
    total_patients = 0
    for doctor in doctors:
        patient_count = int(patient_counts.get(doctor.id, 0) or 0)
        login_count = int(getattr(doctor, 'login_count', 0) or 0)
        total_logins += login_count
        total_patients += patient_count
        doctor_rows.append({
            'id': doctor.id,
            'username': doctor.username,
            'name': doctor.username,
            'email': doctor.email,
            'role': user_role(doctor),
            'is_active': bool(doctor.is_active),
            'login_count': login_count,
            'patient_count': patient_count,
            'last_login_at': doctor.last_login_at.isoformat() if doctor.last_login_at else None,
            'created_at': doctor.created_at.isoformat() if doctor.created_at else None,
        })

    unassigned_patient_count = int(
        db.session.query(func.count(Patient.id))
        .filter(Patient.doctor_id.is_(None))
        .scalar()
        or 0
    )

    return {
        'summary': {
            'total_doctors': len(doctor_rows),
            'active_doctors': sum(1 for doctor in doctor_rows if doctor['is_active']),
            'disabled_doctors': sum(1 for doctor in doctor_rows if not doctor['is_active']),
            'pending_requests': sum(1 for request_record in requests if request_record.status == DOCTOR_REQUEST_STATUS_PENDING),
            'approved_requests': sum(1 for request_record in requests if request_record.status == DOCTOR_REQUEST_STATUS_APPROVED),
            'rejected_requests': sum(1 for request_record in requests if request_record.status == DOCTOR_REQUEST_STATUS_REJECTED),
            'total_logins': total_logins,
            'total_patients': total_patients,
            'unassigned_patients': unassigned_patient_count,
        },
        'doctors': doctor_rows,
        'requests': [serialize_doctor_request(request_record) for request_record in requests],
    }


def approve_signup_request(request_id, payload):
    request_record = DoctorRequest.query.get(request_id)
    if not request_record:
        raise LookupError('Signup request not found.')

    username = validate_doctor_username(payload.get('username'))
    password = validate_doctor_password(payload.get('password'))
    email = validate_doctor_email(payload.get('email') or request_record.email)

    existing_doctor = find_doctor_by_username(username)
    if existing_doctor and existing_doctor.id != request_record.doctor_id:
        raise FileExistsError('That username is already in use.')

    existing_email_doctor = find_doctor_by_email(email)
    if existing_email_doctor and existing_email_doctor.id != request_record.doctor_id:
        raise FileExistsError('That email is already attached to another doctor account.')

    doctor = Doctor.query.get(request_record.doctor_id) if request_record.doctor_id else None
    if doctor is None:
        doctor = Doctor(
            username=username,
            password_hash=generate_password_hash(password),
            email=email,
            is_active=True,
            approved_at=utcnow(),
        )
        db.session.add(doctor)
        db.session.flush()
    else:
        doctor.username = username
        doctor.password_hash = generate_password_hash(password)
        doctor.email = email
        doctor.is_active = True
        doctor.approved_at = doctor.approved_at or utcnow()

    request_record.email = email
    request_record.status = DOCTOR_REQUEST_STATUS_APPROVED
    request_record.doctor_id = doctor.id
    request_record.approved_username = username
    request_record.reviewed_at = utcnow()

    db.session.commit()
    return doctor, request_record


def reject_signup_request(request_id):
    request_record = DoctorRequest.query.get(request_id)
    if not request_record:
        raise LookupError('Signup request not found.')
    if request_record.status == DOCTOR_REQUEST_STATUS_APPROVED and request_record.doctor_id:
        raise RuntimeError('Approved requests cannot be rejected without removing the doctor account first.')

    request_record.status = DOCTOR_REQUEST_STATUS_REJECTED
    request_record.reviewed_at = utcnow()
    db.session.commit()
    return request_record


def update_doctor_password(doctor_id, payload):
    doctor = Doctor.query.get(doctor_id)
    if not doctor:
        raise LookupError('Doctor account not found.')

    password = validate_doctor_password(payload.get('password'))
    doctor.password_hash = generate_password_hash(password)
    doctor.updated_at = utcnow()
    db.session.commit()
    return doctor


def update_doctor_disabled_state(doctor_id, payload):
    doctor = Doctor.query.get(doctor_id)
    if not doctor:
        raise LookupError('Doctor account not found.')

    disabled = payload.get('disabled', True)
    if isinstance(disabled, str):
        disabled = disabled.strip().lower() in {'1', 'true', 'yes', 'on'}
    else:
        disabled = bool(disabled)

    doctor.is_active = not disabled
    doctor.updated_at = utcnow()
    db.session.commit()
    return doctor


def delete_doctor_account(doctor_id):
    doctor = Doctor.query.get(doctor_id)
    if not doctor:
        raise LookupError('Doctor account not found.')

    reassigned_patients = Patient.query.filter_by(doctor_id=doctor.id).all()
    for patient in reassigned_patients:
        patient.doctor_id = None

    linked_requests = DoctorRequest.query.filter_by(doctor_id=doctor.id).all()
    for request_record in linked_requests:
        request_record.doctor_id = None
        if request_record.status == DOCTOR_REQUEST_STATUS_APPROVED:
            request_record.status = DOCTOR_REQUEST_STATUS_REJECTED
        request_record.reviewed_at = utcnow()

    db.session.delete(doctor)
    db.session.commit()
    return len(reassigned_patients)
