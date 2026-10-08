"""Report and assessment persistence logic."""

import json
import uuid
from datetime import datetime

from flask import current_app, request
from werkzeug.utils import secure_filename

from ..models import PatientAssessment, Report, db
from ..core.constants import REPORT_ALLOWED_EXTENSIONS, REPORT_ALLOWED_MIME_TYPES
from ..services.storage_service import save_storage_filestorage
from ..utils.logging_utils import log_info
from ..utils.request_utils import validate_filestorage
from .patient_service import (
    get_assessments_for_patient,
    get_patient_for_current_user,
    get_reports_for_patient,
    scope_assessment_query_for_user,
)


def save_report_from_request(current_user):
    patient_id = request.form.get('patient_id')
    if not patient_id:
        raise ValueError('Patient ID is required')

    patient = get_patient_for_current_user(patient_id, current_user)
    if not patient:
        raise LookupError('Patient not found')

    if 'file' not in request.files:
        raise ValueError('PDF file is required')

    pdf_file = request.files['file']
    if pdf_file.filename == '':
        raise ValueError('No file selected')
    validate_filestorage(
        pdf_file,
        allowed_extensions=REPORT_ALLOWED_EXTENSIONS,
        allowed_mime_types=REPORT_ALLOWED_MIME_TYPES,
        max_bytes=current_app.config['MAX_REPORT_UPLOAD_BYTES'],
        label='Report',
    )

    filename = secure_filename(
        f"report_{patient_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.pdf"
    )
    save_storage_filestorage('report', filename, pdf_file)

    report = Report(
        patient_id=patient_id,
        file_path=filename,
        left_analysis=request.form.get('left_analysis', ''),
        right_analysis=request.form.get('right_analysis', ''),
    )

    db.session.add(report)
    db.session.flush()

    assessment_id = request.form.get('assessment_id')
    if assessment_id:
        assessment = scope_assessment_query_for_user(
            PatientAssessment.query,
            current_user,
        ).filter(PatientAssessment.id == assessment_id).first()
        if assessment and int(assessment.patient_id) == int(patient_id):
            assessment.report_id = report.id
            assessment.status = 'reported'
            assessment.left_analysis = request.form.get('left_analysis', assessment.left_analysis or '')
            assessment.right_analysis = request.form.get('right_analysis', assessment.right_analysis or '')
    else:
        raw_session_data = request.form.get('session_data')
        raw_completed_tests = request.form.get('completed_tests')
        if raw_session_data or raw_completed_tests:
            try:
                session_data = json.loads(raw_session_data or '{}')
            except (TypeError, ValueError, json.JSONDecodeError):
                session_data = {}

            try:
                completed_tests = json.loads(raw_completed_tests or '[]')
            except (TypeError, ValueError, json.JSONDecodeError):
                completed_tests = []

            assessment = PatientAssessment(
                patient_id=patient_id,
                report_id=report.id,
                status='reported',
                completed_tests=json.dumps(completed_tests if isinstance(completed_tests, list) else []),
                session_data=json.dumps(session_data if isinstance(session_data, dict) else {}),
                left_analysis=request.form.get('left_analysis', ''),
                right_analysis=request.form.get('right_analysis', ''),
            )
            db.session.add(assessment)

    db.session.commit()
    log_info('Report saved successfully', patient_id=patient_id, report_id=report.id, filename=filename)
    return report


def get_reports(current_user, patient_id=None):
    return get_reports_for_patient(current_user, patient_id=patient_id)


def get_assessments(current_user, patient_id=None, latest_only=False, status=None):
    return get_assessments_for_patient(current_user, patient_id=patient_id, latest_only=latest_only, status=status)


def save_assessment(payload, current_user):
    patient_id = payload.get('patient_id')
    if not patient_id:
        raise ValueError('Patient ID is required')

    patient = get_patient_for_current_user(patient_id, current_user)
    if not patient:
        raise LookupError('Patient not found')

    raw_assessment_id = payload.get('assessment_id')
    assessment = None
    if raw_assessment_id not in (None, ''):
        assessment = scope_assessment_query_for_user(
            PatientAssessment.query,
            current_user,
        ).filter(PatientAssessment.id == raw_assessment_id).first()
        if not assessment:
            raise LookupError('Assessment not found')
        if int(assessment.patient_id) != int(patient_id):
            raise ValueError('Assessment does not belong to this patient')

    if assessment is None:
        assessment = scope_assessment_query_for_user(
            PatientAssessment.query,
            current_user,
        ).filter(
            PatientAssessment.patient_id == int(patient_id),
            PatientAssessment.status == 'draft',
        ).order_by(PatientAssessment.updated_at.desc(), PatientAssessment.created_at.desc()).first()

    if assessment is None:
        assessment = PatientAssessment(patient_id=patient_id)
        db.session.add(assessment)

    session_data = payload.get('session_data') or {}
    completed_tests = payload.get('completed_tests') or []
    if not isinstance(session_data, dict):
        raise ValueError('session_data must be an object')
    if not isinstance(completed_tests, list):
        raise ValueError('completed_tests must be a list')

    status = str(payload.get('status') or assessment.status or 'draft').strip().lower()
    if status not in {'draft', 'reported'}:
        status = 'draft'

    assessment.status = status
    assessment.session_data = json.dumps(session_data)
    assessment.completed_tests = json.dumps(completed_tests)
    assessment.left_analysis = payload.get('left_analysis', assessment.left_analysis or '')
    assessment.right_analysis = payload.get('right_analysis', assessment.right_analysis or '')

    raw_report_id = payload.get('report_id')
    if raw_report_id not in (None, ''):
        assessment.report_id = raw_report_id

    db.session.commit()
    log_info(
        'Assessment saved successfully',
        patient_id=patient_id,
        assessment_id=assessment.id,
        status=assessment.status,
    )
    return assessment
