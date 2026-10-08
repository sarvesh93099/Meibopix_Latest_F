import json
import os
from datetime import datetime

from ..extensions import db

_REPORT_NOT_LOADED = object()


class Patient(db.Model):
    __tablename__ = 'patient'

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100), nullable=False)
    age = db.Column(db.Integer, nullable=False)
    mobile = db.Column(db.String(20), nullable=False)
    gender = db.Column(db.String(10), nullable=False)
    avatar_style = db.Column(db.String(30), nullable=False, default='ocean')
    doctor_id = db.Column(db.Integer, db.ForeignKey('doctors.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    doctor = db.relationship('Doctor', backref=db.backref('assigned_patients', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'full_name': self.full_name,
            'age': self.age,
            'mobile': self.mobile,
            'gender': self.gender,
            'avatar_style': self.avatar_style or 'ocean',
            'doctor_id': self.doctor_id,
            'doctor_name': self.doctor.username if self.doctor else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Capture(db.Model):
    __tablename__ = 'capture'

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patient.id'), nullable=False)
    eye = db.Column(db.String(10), nullable=False)
    lid = db.Column(db.String(10), nullable=False)
    brightness = db.Column(db.Integer, default=50)
    contrast = db.Column(db.Integer, default=50)
    file_path = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    patient = db.relationship('Patient', backref=db.backref('captures', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'patient_id': self.patient_id,
            'eye': self.eye,
            'lid': self.lid,
            'brightness': self.brightness,
            'contrast': self.contrast,
            'file_path': self.file_path,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Report(db.Model):
    __tablename__ = 'report'

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patient.id'), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    left_analysis = db.Column(db.Text, default='')
    right_analysis = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    patient = db.relationship('Patient', backref=db.backref('reports', lazy=True))

    def to_dict(self):
        assessment = PatientAssessment.query.filter_by(report_id=self.id) \
            .order_by(PatientAssessment.updated_at.desc()) \
            .first()
        completed_tests = []
        if assessment:
            try:
                completed_tests = json.loads(assessment.completed_tests or '[]')
            except (TypeError, ValueError, json.JSONDecodeError):
                completed_tests = []
            if not isinstance(completed_tests, list):
                completed_tests = []

        return {
            'id': self.id,
            'patient_id': self.patient_id,
            'file_path': self.file_path,
            'left_analysis': self.left_analysis or '',
            'right_analysis': self.right_analysis or '',
            'completed_tests': completed_tests,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'download_url': f"/reports/{os.path.basename(self.file_path)}" if self.file_path else None,
            'patient': self.patient.to_dict() if self.patient else None,
        }


class PatientAssessment(db.Model):
    __tablename__ = 'patient_assessment'

    id = db.Column(db.Integer, primary_key=True)
    patient_id = db.Column(db.Integer, db.ForeignKey('patient.id'), nullable=False)
    report_id = db.Column(db.Integer, nullable=True)
    status = db.Column(db.String(20), default='draft')
    completed_tests = db.Column(db.Text, default='[]')
    session_data = db.Column(db.Text, default='{}')
    left_analysis = db.Column(db.Text, default='')
    right_analysis = db.Column(db.Text, default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    patient = db.relationship('Patient', backref=db.backref('assessments', lazy=True))

    def _parse_json_text(self, raw_value, fallback):
        try:
            return json.loads(raw_value or '')
        except (TypeError, ValueError, json.JSONDecodeError):
            return fallback

    def to_dict(self, *, report=_REPORT_NOT_LOADED):
        if report is _REPORT_NOT_LOADED:
            report = db.session.get(Report, self.report_id) if self.report_id else None
        completed_tests = self._parse_json_text(self.completed_tests, [])
        if not isinstance(completed_tests, list):
            completed_tests = []

        session_data = self._parse_json_text(self.session_data, {})
        if not isinstance(session_data, dict):
            session_data = {}

        return {
            'id': self.id,
            'patient_id': self.patient_id,
            'report_id': self.report_id,
            'status': self.status or 'draft',
            'completed_tests': completed_tests,
            'session_data': session_data,
            'left_analysis': self.left_analysis or '',
            'right_analysis': self.right_analysis or '',
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'report_download_url': f"/reports/{os.path.basename(report.file_path)}" if report and report.file_path else None,
            'report_file_path': report.file_path if report else None,
            'patient': self.patient.to_dict() if self.patient else None,
        }
