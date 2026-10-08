"""Patient, capture, and upload-related business logic."""

import json
import re
import uuid
from datetime import datetime

from flask import current_app, g, request
from sqlalchemy.orm import load_only, selectinload
from werkzeug.utils import secure_filename

from ..core.constants import (
    IMAGE_ALLOWED_EXTENSIONS,
    IMAGE_ALLOWED_MIME_TYPES,
    PATIENT_ALLOWED_AVATAR_STYLES,
    PATIENT_ALLOWED_GENDERS,
    PATIENT_MOBILE_REQUIRED_DIGITS,
    PATIENT_MOBILE_MAX_LENGTH,
    PATIENT_NAME_MAX_LENGTH,
)
from ..models import Capture, Doctor, Patient, PatientAssessment, Report, db
from ..services.storage_service import (
    build_storage_url,
    delete_storage_file,
    save_storage_filestorage,
)
from ..utils.logging_utils import log_error, log_info, log_warning
from ..utils.request_utils import parse_optional_int, validate_filestorage
from .auth_service import user_has_role


def scope_patient_query_for_user(query, current_user):
    if user_has_role(current_user, 'doctor'):
        return query.filter(Patient.doctor_id == int(current_user.id))
    return query


def get_patient_for_current_user(patient_id, current_user=None):
    try:
        normalized_patient_id = int(patient_id)
    except (TypeError, ValueError):
        return None

    user = current_user if current_user is not None else getattr(g, 'auth_user', None)
    query = scope_patient_query_for_user(
        Patient.query.options(selectinload(Patient.doctor)),
        user,
    )
    return query.filter(Patient.id == normalized_patient_id).first()


def scope_capture_query_for_user(query, current_user):
    if user_has_role(current_user, 'doctor'):
        return query.join(Patient, Capture.patient_id == Patient.id).filter(Patient.doctor_id == int(current_user.id))
    return query


def scope_report_query_for_user(query, current_user):
    if user_has_role(current_user, 'doctor'):
        return query.join(Patient, Report.patient_id == Patient.id).filter(Patient.doctor_id == int(current_user.id))
    return query


def scope_assessment_query_for_user(query, current_user):
    if user_has_role(current_user, 'doctor'):
        return query.join(Patient, PatientAssessment.patient_id == Patient.id).filter(Patient.doctor_id == int(current_user.id))
    return query


def serialize_report(report, assessment=None):
    completed_tests = []
    if assessment:
        try:
            completed_tests = json.loads(assessment.completed_tests or '[]')
        except (TypeError, ValueError, json.JSONDecodeError):
            completed_tests = []
        if not isinstance(completed_tests, list):
            completed_tests = []

    return {
        'id': report.id,
        'patient_id': report.patient_id,
        'file_path': report.file_path,
        'left_analysis': report.left_analysis or '',
        'right_analysis': report.right_analysis or '',
        'completed_tests': completed_tests,
        'created_at': report.created_at.isoformat() if report.created_at else None,
        'download_url': build_storage_url('report', report.file_path),
        'patient': report.patient.to_dict() if report.patient else None,
    }


def normalize_patient_name(value):
    normalized = ' '.join(str(value or '').strip().split())
    if not normalized:
        raise ValueError('Full name is required')
    if len(normalized) > PATIENT_NAME_MAX_LENGTH:
        raise ValueError(f'Full name must be at most {PATIENT_NAME_MAX_LENGTH} characters')
    return normalized


def normalize_patient_age(value):
    try:
        age = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError('Valid age is required') from error

    if age <= 0 or age > 120:
        raise ValueError('Age must be between 1 and 120')
    return age


def normalize_patient_mobile(value):
    normalized = str(value or '').strip()
    if not normalized:
        raise ValueError('Mobile number is required')
    if len(normalized) > PATIENT_MOBILE_MAX_LENGTH:
        raise ValueError(f'Mobile number must be at most {PATIENT_MOBILE_MAX_LENGTH} characters')

    digits_only = re.sub(r'\D', '', normalized)
    if digits_only != normalized or len(digits_only) != PATIENT_MOBILE_REQUIRED_DIGITS:
        raise ValueError('Mobile number should contain exactly 10 digits.')

    return digits_only


def normalize_patient_gender(value):
    normalized = str(value or '').strip().lower()
    if normalized not in PATIENT_ALLOWED_GENDERS:
        raise ValueError('Gender must be Male, Female, or Other')
    return PATIENT_ALLOWED_GENDERS[normalized]


def normalize_patient_avatar_style(value):
    normalized = str(value or '').strip().lower() or 'ocean'
    if normalized not in PATIENT_ALLOWED_AVATAR_STYLES:
        raise ValueError('Avatar style must be one of the supported preset profiles')
    return normalized


def validate_patient_payload(payload, partial=False):
    if not isinstance(payload, dict):
        raise ValueError('JSON body must be an object')

    normalized = {}
    if not partial or 'full_name' in payload:
        normalized['full_name'] = normalize_patient_name(payload.get('full_name'))
    if not partial or 'age' in payload:
        normalized['age'] = normalize_patient_age(payload.get('age'))
    if not partial or 'mobile' in payload:
        normalized['mobile'] = normalize_patient_mobile(payload.get('mobile'))
    if not partial or 'gender' in payload:
        normalized['gender'] = normalize_patient_gender(payload.get('gender'))
    if not partial or 'avatar_style' in payload:
        normalized['avatar_style'] = normalize_patient_avatar_style(payload.get('avatar_style'))
    return normalized


def resolve_patient_doctor_id(payload, current_user, partial=False):
    if user_has_role(current_user, 'doctor'):
        return int(current_user.id)

    if not isinstance(payload, dict):
        return None

    if partial and 'doctor_id' not in payload:
        return None

    raw_doctor_id = payload.get('doctor_id')
    if raw_doctor_id in (None, ''):
        return None

    doctor_id = parse_optional_int(raw_doctor_id, 'Doctor ID')
    if doctor_id is None:
        return None

    doctor = Doctor.query.get(doctor_id)
    if not doctor or not bool(doctor.is_active):
        raise ValueError('Doctor not found')

    return int(doctor.id)


def get_patients_for_user(current_user):
    return scope_patient_query_for_user(
        Patient.query.options(selectinload(Patient.doctor)).order_by(Patient.created_at.desc()),
        current_user,
    ).all()


def create_patient_from_payload(payload, current_user):
    doctor_id = resolve_patient_doctor_id(payload, current_user)
    normalized_payload = validate_patient_payload(payload)

    patient = Patient(
        full_name=normalized_payload['full_name'],
        age=normalized_payload['age'],
        mobile=normalized_payload['mobile'],
        gender=normalized_payload['gender'],
        avatar_style=normalized_payload['avatar_style'],
        doctor_id=doctor_id,
    )

    db.session.add(patient)
    db.session.commit()
    log_info('Patient created successfully', patient_id=patient.id, doctor_id=doctor_id)
    return patient


def update_patient_from_payload(patient_id, payload, current_user):
    patient = get_patient_for_current_user(patient_id, current_user)
    if not patient:
        raise LookupError('Patient not found')

    normalized_payload = validate_patient_payload(payload, partial=True)

    if 'full_name' in normalized_payload:
        patient.full_name = normalized_payload['full_name']
    if 'age' in normalized_payload:
        patient.age = normalized_payload['age']
    if 'mobile' in normalized_payload:
        patient.mobile = normalized_payload['mobile']
    if 'gender' in normalized_payload:
        patient.gender = normalized_payload['gender']
    if 'avatar_style' in normalized_payload:
        patient.avatar_style = normalized_payload['avatar_style']
    if 'doctor_id' in payload and not user_has_role(current_user, 'doctor'):
        patient.doctor_id = resolve_patient_doctor_id(payload, current_user, partial=True)

    db.session.commit()
    log_info('Patient updated successfully', patient_id=patient.id, doctor_id=patient.doctor_id)
    return patient


def delete_patient_and_related_files(patient_id, current_user):
    patient = get_patient_for_current_user(patient_id, current_user)
    if not patient:
        raise LookupError('Patient not found')

    for capture in list(patient.captures):
        capture_file_path = capture.file_path or ''
        if capture_file_path:
            delete_storage_file('upload', capture_file_path)
        db.session.delete(capture)

    for report in list(patient.reports):
        report_file_path = report.file_path or ''
        if report_file_path:
            delete_storage_file('report', report_file_path)
        db.session.delete(report)

    db.session.delete(patient)
    db.session.commit()
    log_info('Patient deleted successfully', patient_id=patient_id)


def get_captures_for_patient(patient_id, current_user):
    if not get_patient_for_current_user(patient_id, current_user):
        raise LookupError('Patient not found')

    captures = scope_capture_query_for_user(
        Capture.query.filter_by(patient_id=patient_id).order_by(Capture.created_at.desc()),
        current_user,
    ).all()
    log_info('Capture list fetched successfully', patient_id=patient_id, capture_count=len(captures))
    return captures


def get_reports_for_patient(current_user, patient_id=None):
    query = scope_report_query_for_user(
        Report.query.options(selectinload(Report.patient).selectinload(Patient.doctor)),
        current_user,
    )

    if patient_id:
        if not get_patient_for_current_user(patient_id, current_user):
            raise LookupError('Patient not found')
        query = query.filter(Report.patient_id == int(patient_id))

    reports = query.order_by(Report.created_at.desc()).all()
    report_ids = [report.id for report in reports]
    latest_assessment_by_report_id = {}
    if report_ids:
        assessments = scope_assessment_query_for_user(
            # Report cards need test labels, not every full-resolution exam image.
            PatientAssessment.query.options(load_only(
                PatientAssessment.id, PatientAssessment.report_id,
                PatientAssessment.completed_tests, PatientAssessment.updated_at,
            )),
            current_user,
        ).filter(PatientAssessment.report_id.in_(report_ids)) \
            .order_by(PatientAssessment.report_id.asc(), PatientAssessment.updated_at.desc()) \
            .all()
        for assessment in assessments:
            if assessment.report_id and assessment.report_id not in latest_assessment_by_report_id:
                latest_assessment_by_report_id[assessment.report_id] = assessment

    log_info('Reports fetched successfully', patient_id=patient_id or 'all', report_count=len(reports))
    return [
        serialize_report(report, latest_assessment_by_report_id.get(report.id))
        for report in reports
    ]


def get_assessments_for_patient(current_user, patient_id=None, latest_only=False, status=None):
    query = scope_assessment_query_for_user(
        PatientAssessment.query.options(
            selectinload(PatientAssessment.patient).selectinload(Patient.doctor),
        ),
        current_user,
    )

    if patient_id:
        if not get_patient_for_current_user(patient_id, current_user):
            raise LookupError('Patient not found')
        query = query.filter(PatientAssessment.patient_id == int(patient_id))

    if status:
        query = query.filter(PatientAssessment.status == status)

    query = query.order_by(PatientAssessment.updated_at.desc(), PatientAssessment.created_at.desc())

    if latest_only:
        assessment = query.first()
        log_info('Latest assessment fetched successfully', patient_id=patient_id, found=bool(assessment))
        return assessment.to_dict() if assessment else None

    assessments = query.all()
    report_ids = {assessment.report_id for assessment in assessments if assessment.report_id}
    reports_by_id = {}
    if report_ids:
        reports = scope_report_query_for_user(Report.query, current_user).filter(Report.id.in_(report_ids)).all()
        reports_by_id = {report.id: report for report in reports}
    log_info('Assessments fetched successfully', patient_id=patient_id or 'all', assessment_count=len(assessments))
    return [assessment.to_dict(report=reports_by_id.get(assessment.report_id)) for assessment in assessments]


def handle_uploaded_file_request(patient_id_override=None, current_user=None):
    try:
        patient_id = parse_optional_int(
            patient_id_override if patient_id_override is not None else request.form.get('patient_id'),
            'Patient ID',
        )
    except ValueError as validation_error:
        log_warning('Upload request rejected due to invalid patient identifier', reason=str(validation_error))
        raise

    user = current_user if current_user is not None else getattr(g, 'auth_user', None)
    if patient_id is not None:
        patient = get_patient_for_current_user(patient_id, user)
        if not patient:
            raise LookupError('Patient not found')

    if 'file' not in request.files:
        raise ValueError('No file provided')

    file = request.files['file']
    if file.filename == '':
        raise ValueError('No file selected')
    validate_filestorage(
        file,
        allowed_extensions=IMAGE_ALLOWED_EXTENSIONS,
        allowed_mime_types=IMAGE_ALLOWED_MIME_TYPES,
        max_bytes=current_app.config['MAX_IMAGE_UPLOAD_BYTES'],
        label='Image',
    )

    eye = str(request.form.get('eye') or '').strip().lower() or None
    lid = str(request.form.get('lid') or '').strip().lower() or None
    if eye and eye not in {'left', 'right'}:
        raise ValueError('Eye must be left or right when provided')
    if lid and lid not in {'upper', 'lower'}:
        raise ValueError('Lid must be upper or lower when provided')

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    owner = patient_id if patient_id is not None else 'guest'
    filename = secure_filename(f'upload_{owner}_{timestamp}_{uuid.uuid4().hex[:8]}_{file.filename}')
    save_storage_filestorage('upload', filename, file)
    log_info('Image upload completed successfully', patient_id=patient_id or 'guest', filename=filename, eye=eye, lid=lid)

    return {
        'status': 'uploaded',
        'upload_type': 'file',
        'patient_id': patient_id,
        'eye': eye,
        'lid': lid,
        'file_path': filename,
        'image_url': build_storage_url('upload', filename),
        'created_at': datetime.utcnow().isoformat(),
        'message': 'Image uploaded successfully',
    }
