"""Authentication, account normalization, and bootstrap business logic."""

import re
import uuid
from hmac import compare_digest

from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from flask import current_app, session
from werkzeug.security import check_password_hash, generate_password_hash

from ..core.constants import (
    AUTH_SESSION_KIND_KEY,
    AUTH_SESSION_USER_KEY,
    PASSWORD_HASHER,
)
from ..models import AppUser, Doctor, DoctorRequest, Patient, db
from ..utils.logging_utils import get_client_ip, get_logger, log_info

try:
    import pyotp
except ImportError:
    pyotp = None


logger = get_logger()


def utcnow():
    from datetime import datetime

    return datetime.utcnow()


def get_primary_doctor_user():
    return Doctor.query.order_by(Doctor.created_at.asc(), Doctor.id.asc()).first()


def normalize_username(value):
    return str(value or '').strip()


def normalize_email(value):
    return str(value or '').strip().lower()


def is_valid_email_address(value):
    normalized_email = normalize_email(value)
    if not normalized_email or len(normalized_email) > 255:
        return False
    return bool(re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', normalized_email))


def find_doctor_by_username(username):
    normalized_username = normalize_username(username)
    if not normalized_username:
        return None
    return Doctor.query.filter_by(username=normalized_username).first()


def find_doctor_by_email(email):
    normalized_email = normalize_email(email)
    if not normalized_email:
        return None
    return Doctor.query.filter_by(email=normalized_email).first()


def find_admin_user_by_username(username):
    normalized_username = normalize_username(username)
    if not normalized_username:
        return None
    return AppUser.query.filter_by(username=normalized_username).first()


def user_role(user):
    if isinstance(user, Doctor):
        return 'doctor'
    return str(getattr(user, 'role', 'doctor') or 'doctor').strip().lower()


def user_has_role(user, role_name):
    return user_role(user) == str(role_name or '').strip().lower()


def get_legacy_doctor_for_app_user(app_user):
    if not app_user or str(getattr(app_user, 'role', '') or '').strip().lower() != 'doctor':
        return None

    doctor = Doctor.query.filter_by(legacy_app_user_id=app_user.id).first()
    if doctor:
        return doctor

    return Doctor.query.filter_by(username=app_user.username).first()


def get_user_by_session_identity(session_user_id, session_user_kind=None):
    try:
        normalized_id = int(session_user_id)
    except (TypeError, ValueError):
        return None, None

    normalized_kind = str(session_user_kind or '').strip().lower()
    if normalized_kind == 'doctor':
        doctor = Doctor.query.get(normalized_id)
        if doctor:
            return doctor, 'doctor'
        return None, None

    if normalized_kind == 'admin':
        admin_user = AppUser.query.get(normalized_id)
        if admin_user and user_has_role(admin_user, 'admin'):
            return admin_user, 'admin'
        return None, None

    legacy_user = AppUser.query.get(normalized_id)
    if legacy_user and user_has_role(legacy_user, 'admin'):
        return legacy_user, 'admin'

    legacy_doctor = get_legacy_doctor_for_app_user(legacy_user)
    if legacy_doctor:
        return legacy_doctor, 'doctor'

    doctor = Doctor.query.get(normalized_id)
    if doctor:
        return doctor, 'doctor'

    return None, None


def set_authenticated_session(user, session_kind=None):
    session[AUTH_SESSION_USER_KEY] = int(user.id)
    session[AUTH_SESSION_KIND_KEY] = str(session_kind or user_role(user) or '').strip().lower()


def clear_authenticated_session():
    session.pop(AUTH_SESSION_USER_KEY, None)
    session.pop(AUTH_SESSION_KIND_KEY, None)


def find_user_by_username(username):
    normalized_username = normalize_username(username)
    if not normalized_username:
        return None

    doctor = find_doctor_by_username(normalized_username)
    if doctor:
        return doctor

    admin_user = find_admin_user_by_username(normalized_username)
    if admin_user and user_has_role(admin_user, 'admin'):
        return admin_user

    legacy_doctor_user = AppUser.query.filter_by(username=normalized_username, role='doctor').first()
    if legacy_doctor_user:
        return legacy_doctor_user

    return admin_user


def safe_user_payload(user):
    return {
        'id': user.id,
        'username': user.username,
        'name': user.username,
        'role': user_role(user),
        'login_count': int(getattr(user, 'login_count', 0) or 0),
        'auth_provider': 'local',
        'email': getattr(user, 'email', '') or '',
        'is_active': bool(getattr(user, 'is_active', True)),
        'two_factor_enabled': bool(getattr(user, 'is_totp_enabled', False)),
        'last_login_at': user.last_login_at.isoformat() if getattr(user, 'last_login_at', None) else None,
    }


def auth_status():
    two_factor_user = AppUser.query.filter_by(is_totp_enabled=True).order_by(AppUser.id.asc()).first()
    primary_doctor = get_primary_doctor_user()
    configured = bool(
        AppUser.query.filter_by(role='admin').first() or
        Doctor.query.first() or
        normalize_username(current_app.config.get('AUTH_ADMIN_USERNAME')) or
        normalize_username(current_app.config.get('AUTH_USERNAME'))
    )
    any_two_factor_user = AppUser.query.filter_by(is_totp_enabled=True).first()
    two_factor_enabled = bool(any_two_factor_user) or bool(current_app.config.get('AUTH_ENABLE_2FA'))
    two_factor_ready = not two_factor_enabled or (
        pyotp is not None and bool((two_factor_user.totp_secret if two_factor_user else current_app.config.get('AUTH_2FA_SECRET')) or '')
    )
    return {
        'configured': configured,
        'username_hint': (
            normalize_username(current_app.config.get('AUTH_ADMIN_USERNAME')) or
            getattr(primary_doctor, 'username', '') or
            normalize_username(current_app.config.get('AUTH_USERNAME')) or
            ''
        ),
        'two_factor_enabled': two_factor_enabled,
        'two_factor_ready': two_factor_ready,
    }


def verify_password(user, raw_password):
    stored_hash = str(getattr(user, 'password_hash', '') or '')
    if not stored_hash:
        return False

    try:
        if check_password_hash(stored_hash, raw_password):
            return True
    except (TypeError, ValueError):
        pass

    try:
        password_valid = PASSWORD_HASHER.verify(stored_hash, raw_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False

    if password_valid:
        user.password_hash = generate_password_hash(raw_password)
    return password_valid


def reset_failed_login_state(user, client_ip=None):
    if hasattr(user, 'failed_login_attempts'):
        user.failed_login_attempts = 0
    if hasattr(user, 'locked_until'):
        user.locked_until = None
    user.last_login_at = utcnow()
    user.last_login_ip = client_ip or get_client_ip()
    user.login_count = int(getattr(user, 'login_count', 0) or 0) + 1


def totp_is_valid(user, otp_code):
    if not bool(getattr(user, 'is_totp_enabled', False)):
        return True
    if pyotp is None or not getattr(user, 'totp_secret', None):
        return False
    return bool(pyotp.TOTP(user.totp_secret).verify(str(otp_code or '').strip(), valid_window=1))


def make_reserved_doctor_email(username, suffix='legacy'):
    local_part = re.sub(r'[^a-z0-9]+', '.', normalize_username(username).lower()).strip('.')
    local_part = local_part or 'doctor'
    return f'{local_part}@{suffix}.local'


def build_unique_legacy_doctor_email(username, legacy_app_user_id=None):
    base_email = make_reserved_doctor_email(username)
    candidate_email = base_email
    index = 0

    while True:
        existing_doctor = find_doctor_by_email(candidate_email)
        if not existing_doctor or existing_doctor.legacy_app_user_id == legacy_app_user_id:
            return candidate_email

        index += 1
        local_part = base_email.split('@', 1)[0]
        candidate_email = f'{local_part}.{legacy_app_user_id or index}@legacy.local'


def backfill_legacy_doctor_accounts():
    legacy_doctors = AppUser.query.filter_by(role='doctor').order_by(AppUser.id.asc()).all()
    if not legacy_doctors:
        return

    doctor_id_map = {}
    for legacy_doctor in legacy_doctors:
        doctor = Doctor.query.filter(
            (Doctor.legacy_app_user_id == legacy_doctor.id) |
            (Doctor.username == legacy_doctor.username)
        ).order_by(Doctor.id.asc()).first()

        if doctor is None:
            doctor = Doctor(
                username=legacy_doctor.username,
                password_hash=legacy_doctor.password_hash or generate_password_hash(uuid.uuid4().hex),
                email=build_unique_legacy_doctor_email(legacy_doctor.username, legacy_doctor.id),
                is_active=True,
                login_count=int(getattr(legacy_doctor, 'login_count', 0) or 0),
                last_login_at=getattr(legacy_doctor, 'last_login_at', None),
                last_login_ip=getattr(legacy_doctor, 'last_login_ip', None),
                approved_at=getattr(legacy_doctor, 'created_at', None) or utcnow(),
                legacy_app_user_id=legacy_doctor.id,
                created_at=getattr(legacy_doctor, 'created_at', None) or utcnow(),
                updated_at=getattr(legacy_doctor, 'updated_at', None) or getattr(legacy_doctor, 'created_at', None) or utcnow(),
            )
            db.session.add(doctor)
            db.session.flush()
        else:
            if not doctor.password_hash:
                doctor.password_hash = legacy_doctor.password_hash or generate_password_hash(uuid.uuid4().hex)
            if not doctor.email:
                doctor.email = build_unique_legacy_doctor_email(legacy_doctor.username, legacy_doctor.id)
            if doctor.legacy_app_user_id is None:
                doctor.legacy_app_user_id = legacy_doctor.id
            if not doctor.approved_at:
                doctor.approved_at = getattr(legacy_doctor, 'created_at', None) or doctor.created_at or utcnow()
            if int(getattr(doctor, 'login_count', 0) or 0) < int(getattr(legacy_doctor, 'login_count', 0) or 0):
                doctor.login_count = int(getattr(legacy_doctor, 'login_count', 0) or 0)
            if not doctor.last_login_at and getattr(legacy_doctor, 'last_login_at', None):
                doctor.last_login_at = legacy_doctor.last_login_at
            if not doctor.last_login_ip and getattr(legacy_doctor, 'last_login_ip', None):
                doctor.last_login_ip = legacy_doctor.last_login_ip

        doctor_id_map[legacy_doctor.id] = doctor.id

    if doctor_id_map:
        patients = Patient.query.filter(Patient.doctor_id.in_(doctor_id_map.keys())).all()
        for patient in patients:
            patient.doctor_id = doctor_id_map.get(patient.doctor_id, patient.doctor_id)

    db.session.flush()


def backfill_legacy_patient_ownership():
    doctors = Doctor.query.filter_by(is_active=True).order_by(Doctor.id.asc()).all()
    if len(doctors) != 1:
        return

    assigned_doctor_id = doctors[0].id
    unassigned_patients = Patient.query.filter(Patient.doctor_id.is_(None)).all()
    if not unassigned_patients:
        return

    for patient in unassigned_patients:
        patient.doctor_id = assigned_doctor_id

    logger.info(
        'Backfilled legacy patient ownership records | assigned_doctor_id=%s patients_updated=%s',
        assigned_doctor_id,
        len(unassigned_patients),
    )


def seed_bootstrap_doctor_if_needed():
    bootstrap_username = normalize_username(current_app.config.get('AUTH_USERNAME'))
    bootstrap_password = str(current_app.config.get('AUTH_PASSWORD') or '')
    if not bootstrap_username or not bootstrap_password:
        return

    if Doctor.query.first():
        return

    if normalize_username(current_app.config.get('AUTH_ADMIN_USERNAME')).lower() == bootstrap_username.lower():
        raise RuntimeError('Bootstrap doctor username cannot match the bootstrap admin username.')

    doctor = Doctor(
        username=bootstrap_username,
        password_hash=generate_password_hash(bootstrap_password),
        email=make_reserved_doctor_email(bootstrap_username, suffix='bootstrap'),
        is_active=True,
        approved_at=utcnow(),
    )
    db.session.add(doctor)
    db.session.flush()
    log_info('Bootstrap doctor account seeded', username=bootstrap_username, doctor_id=doctor.id)


def bootstrap_auth_users():
    try:
        with current_app.app_context():
            admin_username = normalize_username(current_app.config.get('AUTH_ADMIN_USERNAME'))
            admin_password = str(current_app.config.get('AUTH_ADMIN_PASSWORD') or '')
            bootstrap_doctor_username = normalize_username(current_app.config.get('AUTH_USERNAME'))
            bootstrap_doctor_password = str(current_app.config.get('AUTH_PASSWORD') or '')

            if admin_username and bootstrap_doctor_username and admin_username.lower() == bootstrap_doctor_username.lower():
                raise RuntimeError('Bootstrap doctor and admin usernames must be unique.')

            admin_user = AppUser.query.filter_by(singleton_key='admin').first()
            has_changes = False

            if admin_username and admin_password:
                if admin_user is None:
                    admin_user = AppUser(
                        singleton_key='admin',
                        username=admin_username,
                        password_hash=generate_password_hash(admin_password),
                        role='admin',
                        is_totp_enabled=False,
                        totp_secret=None,
                    )
                    db.session.add(admin_user)
                    has_changes = True
                else:
                    if admin_user.username != admin_username:
                        admin_user.username = admin_username
                        has_changes = True
                    if user_role(admin_user) != 'admin':
                        admin_user.role = 'admin'
                        has_changes = True
                    if not verify_password(admin_user, admin_password):
                        admin_user.password_hash = generate_password_hash(admin_password)
                        has_changes = True
                    if int(getattr(admin_user, 'failed_login_attempts', 0) or 0) != 0:
                        admin_user.failed_login_attempts = 0
                        has_changes = True
                    if getattr(admin_user, 'locked_until', None) is not None:
                        admin_user.locked_until = None
                        has_changes = True

            backfill_legacy_doctor_accounts()
            seed_bootstrap_doctor_if_needed()
            backfill_legacy_patient_ownership()

            if has_changes:
                log_info(
                    'Bootstrap auth users synchronized',
                    admin_enabled=bool(admin_username and admin_password),
                    doctor_seed_enabled=bool(bootstrap_doctor_username and bootstrap_doctor_password),
                )

            db.session.commit()
    except Exception:
        logger.error('Failed to bootstrap auth users', exc_info=True)
        db.session.rollback()
        raise


def validate_doctor_username(value):
    normalized_username = normalize_username(value)
    if len(normalized_username) < 3 or len(normalized_username) > 80:
        raise ValueError('Username must be between 3 and 80 characters.')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', normalized_username):
        raise ValueError('Username may contain only letters, numbers, dots, underscores, and hyphens.')
    return normalized_username


def validate_doctor_password(value):
    normalized_password = str(value or '')
    if len(normalized_password) < 8 or len(normalized_password) > 128:
        raise ValueError('Password must be between 8 and 128 characters.')
    return normalized_password


def validate_doctor_email(value):
    normalized_email = normalize_email(value)
    if not is_valid_email_address(normalized_email):
        raise ValueError('A valid email address is required.')
    return normalized_email


def serialize_doctor_request(request_record):
    payload = request_record.to_dict()
    payload['doctor'] = request_record.doctor.to_safe_dict() if request_record.doctor else None
    return payload


def authenticate_credentials(username, password, otp_code=''):
    submitted_username = normalize_username(username)
    user = find_user_by_username(submitted_username)
    if isinstance(user, AppUser) and user_has_role(user, 'doctor'):
        user = get_legacy_doctor_for_app_user(user) or user
    if not user:
        return None

    username_valid = compare_digest(submitted_username, user.username)
    password_valid = username_valid and verify_password(user, str(password or ''))
    otp_valid = password_valid and totp_is_valid(user, otp_code)
    if not (username_valid and password_valid and otp_valid):
        return None
    return user
