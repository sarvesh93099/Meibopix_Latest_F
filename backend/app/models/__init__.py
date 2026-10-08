"""Database models and initialization helpers."""

from sqlalchemy import inspect, text

from ..extensions import db
from .auth import AppUser, Doctor, DoctorRequest
from .patient import Capture, Patient, PatientAssessment, Report

__all__ = [
    'db',
    'AppUser',
    'Doctor',
    'DoctorRequest',
    'Patient',
    'Capture',
    'Report',
    'PatientAssessment',
    'init_db',
]


def _table_exists(table_name):
    inspector = inspect(db.engine)
    return table_name in inspector.get_table_names()


def _add_missing_column(table_name, column_name, ddl_sql):
    if not _table_exists(table_name):
        return False

    inspector = inspect(db.engine)
    existing_columns = {column['name'] for column in inspector.get_columns(table_name)}
    if column_name in existing_columns:
        return False

    db.session.execute(text(ddl_sql))
    db.session.commit()
    return True


def _ensure_index(table_name, index_name, columns):
    if not _table_exists(table_name):
        return False

    inspector = inspect(db.engine)
    existing_indexes = {index['name'] for index in inspector.get_indexes(table_name)}
    if index_name in existing_indexes:
        return False

    db.session.execute(
        text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({', '.join(columns)})")
    )
    return True


def _migrate_legacy_schema():
    _add_missing_column(
        'app_user',
        'role',
        "ALTER TABLE app_user ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'doctor'",
    )
    _add_missing_column(
        'app_user',
        'login_count',
        "ALTER TABLE app_user ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0",
    )
    _add_missing_column(
        'app_user',
        'session_version',
        "ALTER TABLE app_user ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0",
    )
    _add_missing_column(
        'app_user',
        'current_refresh_jti',
        "ALTER TABLE app_user ADD COLUMN current_refresh_jti VARCHAR(64)",
    )
    _add_missing_column(
        'app_user',
        'failed_login_attempts',
        "ALTER TABLE app_user ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0",
    )
    _add_missing_column(
        'app_user',
        'locked_until',
        "ALTER TABLE app_user ADD COLUMN locked_until DATETIME",
    )
    _add_missing_column(
        'app_user',
        'last_login_at',
        "ALTER TABLE app_user ADD COLUMN last_login_at DATETIME",
    )
    _add_missing_column(
        'app_user',
        'last_login_ip',
        "ALTER TABLE app_user ADD COLUMN last_login_ip VARCHAR(64)",
    )
    _add_missing_column(
        'app_user',
        'is_totp_enabled',
        "ALTER TABLE app_user ADD COLUMN is_totp_enabled BOOLEAN NOT NULL DEFAULT 0",
    )
    _add_missing_column(
        'app_user',
        'totp_secret',
        "ALTER TABLE app_user ADD COLUMN totp_secret VARCHAR(64)",
    )
    _add_missing_column(
        'app_user',
        'updated_at',
        "ALTER TABLE app_user ADD COLUMN updated_at DATETIME",
    )
    _add_missing_column(
        'patient',
        'doctor_id',
        "ALTER TABLE patient ADD COLUMN doctor_id INTEGER",
    )
    _add_missing_column(
        'patient',
        'avatar_style',
        "ALTER TABLE patient ADD COLUMN avatar_style VARCHAR(30) DEFAULT 'ocean'",
    )
    _add_missing_column(
        'doctors',
        'is_active',
        "ALTER TABLE doctors ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
    )
    _add_missing_column(
        'doctors',
        'login_count',
        "ALTER TABLE doctors ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0",
    )
    _add_missing_column(
        'doctors',
        'last_login_at',
        "ALTER TABLE doctors ADD COLUMN last_login_at DATETIME",
    )
    _add_missing_column(
        'doctors',
        'last_login_ip',
        "ALTER TABLE doctors ADD COLUMN last_login_ip VARCHAR(64)",
    )
    _add_missing_column(
        'doctors',
        'approved_at',
        "ALTER TABLE doctors ADD COLUMN approved_at DATETIME",
    )
    _add_missing_column(
        'doctors',
        'legacy_app_user_id',
        "ALTER TABLE doctors ADD COLUMN legacy_app_user_id INTEGER",
    )
    _add_missing_column(
        'doctors',
        'updated_at',
        "ALTER TABLE doctors ADD COLUMN updated_at DATETIME",
    )
    _add_missing_column(
        'doctor_requests',
        'doctor_id',
        "ALTER TABLE doctor_requests ADD COLUMN doctor_id INTEGER",
    )
    _add_missing_column(
        'doctor_requests',
        'approved_username',
        "ALTER TABLE doctor_requests ADD COLUMN approved_username VARCHAR(80)",
    )
    _add_missing_column(
        'doctor_requests',
        'reviewed_at',
        "ALTER TABLE doctor_requests ADD COLUMN reviewed_at DATETIME",
    )

    if _table_exists('app_user'):
        db.session.execute(text("UPDATE app_user SET role = 'doctor' WHERE role IS NULL OR role = ''"))
        db.session.execute(text("UPDATE app_user SET login_count = 0 WHERE login_count IS NULL"))
        db.session.execute(text("UPDATE app_user SET session_version = 0 WHERE session_version IS NULL"))
        db.session.execute(text("UPDATE app_user SET failed_login_attempts = 0 WHERE failed_login_attempts IS NULL"))
        db.session.execute(text("UPDATE app_user SET is_totp_enabled = 0 WHERE is_totp_enabled IS NULL"))

    if _table_exists('doctors'):
        db.session.execute(text("UPDATE doctors SET is_active = 1 WHERE is_active IS NULL"))
        db.session.execute(text("UPDATE doctors SET login_count = 0 WHERE login_count IS NULL"))
        db.session.execute(text("UPDATE doctors SET approved_at = created_at WHERE approved_at IS NULL"))

    if _table_exists('patient'):
        db.session.execute(text("UPDATE patient SET avatar_style = 'ocean' WHERE avatar_style IS NULL OR avatar_style = ''"))

    if _table_exists('doctor_requests'):
        db.session.execute(text("UPDATE doctor_requests SET status = 'pending' WHERE status IS NULL OR status = ''"))

    db.session.commit()


def _ensure_performance_indexes():
    indexes_created = False
    indexes_created = _ensure_index('patient', 'ix_patient_doctor_created', ['doctor_id', 'created_at']) or indexes_created
    indexes_created = _ensure_index('capture', 'ix_capture_patient_created', ['patient_id', 'created_at']) or indexes_created
    indexes_created = _ensure_index('report', 'ix_report_patient_created', ['patient_id', 'created_at']) or indexes_created
    indexes_created = _ensure_index('patient_assessment', 'ix_assessment_patient_status_updated', ['patient_id', 'status', 'updated_at']) or indexes_created
    indexes_created = _ensure_index('patient_assessment', 'ix_assessment_report_id', ['report_id']) or indexes_created
    indexes_created = _ensure_index('doctor_requests', 'ix_doctor_requests_status_created', ['status', 'created_at']) or indexes_created

    if indexes_created:
        db.session.commit()


def init_db(app):
    db.init_app(app)
    with app.app_context():
        db.create_all()
        _migrate_legacy_schema()
        _ensure_performance_indexes()
