from flask import Blueprint, g, jsonify, request, session

from ..core.constants import AUTH_SESSION_KIND_KEY, AUTH_SESSION_USER_KEY
from ..models import AppUser, db
from ..services.admin_service import create_signup_request
from ..services.auth_service import (
    auth_status,
    authenticate_credentials,
    clear_authenticated_session,
    find_user_by_username,
    get_legacy_doctor_for_app_user,
    get_user_by_session_identity,
    pyotp,
    reset_failed_login_state,
    safe_user_payload,
    serialize_doctor_request,
    set_authenticated_session,
    user_has_role,
)
from ..utils.logging_utils import get_client_ip, log_error, log_info, log_warning


auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/api/auth/config', methods=['GET'])
def get_auth_config():
    try:
        status = auth_status()
        log_info(
            'Auth configuration served',
            configured=status['configured'],
            two_factor_enabled=status['two_factor_enabled'],
        )
        return jsonify({
            'configured': status['configured'],
            'username_hint': status['username_hint'],
            'two_factor_enabled': status['two_factor_enabled'],
            'two_factor_ready': status['two_factor_ready'],
        })
    except Exception:
        log_error('Failed to serve auth configuration')
        return jsonify({'error': 'Failed to load authentication configuration.'}), 500


@auth_bp.route('/api/auth/login', methods=['POST'])
def login_single_user():
    try:
        payload = request.get_json(silent=True) or {}
        submitted_username = str(payload.get('username') or '').strip()
        submitted_password = str(payload.get('password') or '')
        submitted_otp = str(payload.get('otp') or '').strip()
        client_ip = get_client_ip()

        user = find_user_by_username(submitted_username)
        if isinstance(user, AppUser) and user_has_role(user, 'doctor'):
            user = get_legacy_doctor_for_app_user(user) or user
        if not user:
            log_warning('Login failed due to invalid credentials', principal=submitted_username or 'blank')
            return jsonify({'error': 'Invalid credentials.'}), 401

        if bool(getattr(user, 'is_totp_enabled', False)) and (pyotp is None or not getattr(user, 'totp_secret', None)):
            log_warning('Login blocked because TOTP is not configured correctly', principal=submitted_username)
            return jsonify({'error': 'Two-factor authentication is enabled but not configured correctly.'}), 503

        user = authenticate_credentials(submitted_username, submitted_password, submitted_otp)
        if not user:
            log_warning('Login failed due to invalid credentials', principal=submitted_username or 'blank')
            return jsonify({'error': 'Invalid credentials.'}), 401

        if user_has_role(user, 'doctor') and not bool(getattr(user, 'is_active', True)):
            log_warning('Login blocked for disabled doctor account', principal=submitted_username, user_id=user.id)
            return jsonify({'error': 'Doctor account is disabled. Please contact the admin.'}), 403

        reset_failed_login_state(user, client_ip)
        set_authenticated_session(user)
        db.session.commit()
        log_info('User authenticated successfully', user_id=user.id, role=getattr(user, 'role', 'doctor'), principal=user.username)

        return jsonify({
            'authenticated': True,
            'user': safe_user_payload(user),
        })
    except Exception:
        db.session.rollback()
        log_error('Failed to authenticate user')
        return jsonify({'error': 'Authentication failed due to a server error.'}), 500


@auth_bp.route('/api/auth/refresh', methods=['POST'])
def refresh_auth_session():
    return jsonify({'error': 'JWT refresh tokens are disabled for simple session auth.'}), 410


@auth_bp.route('/api/auth/me', methods=['GET'])
def get_authenticated_user():
    session_user_id = session.get(AUTH_SESSION_USER_KEY)
    session_user_kind = session.get(AUTH_SESSION_KIND_KEY)

    if not session_user_id:
        return jsonify({'authenticated': False, 'user': None})

    user, resolved_kind = get_user_by_session_identity(session_user_id, session_user_kind)
    if not user or (user_has_role(user, 'doctor') and not bool(getattr(user, 'is_active', True))):
        clear_authenticated_session()
        return jsonify({'authenticated': False, 'user': None})

    if resolved_kind and resolved_kind != session_user_kind:
        session[AUTH_SESSION_KIND_KEY] = resolved_kind

    return jsonify({'authenticated': True, 'user': safe_user_payload(user)})


@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout_authenticated_user():
    auth_user = getattr(g, 'auth_user', None)
    clear_authenticated_session()
    log_info('User logged out successfully', user_id=getattr(auth_user, 'id', 'anonymous'))
    return jsonify({'success': True})


@auth_bp.route('/api/signup-request', methods=['POST'])
def create_doctor_signup_request():
    try:
        request_record = create_signup_request(request.get_json(silent=True) or {})
        log_info('Doctor signup request created', request_id=request_record.id, email=request_record.email)
        return jsonify({
            'success': True,
            'message': 'Signup request submitted for admin review.',
            'request': serialize_doctor_request(request_record),
        }), 201
    except FileExistsError as conflict_error:
        return jsonify({'error': str(conflict_error)}), 409
    except ValueError as validation_error:
        db.session.rollback()
        log_warning('Doctor signup request rejected', reason=str(validation_error))
        return jsonify({'error': str(validation_error)}), 400
    except Exception:
        db.session.rollback()
        log_error('Failed to create doctor signup request')
        return jsonify({'error': 'Failed to submit signup request.'}), 500
