"""Request/response middleware registration."""

import time
import uuid

from flask import g, jsonify, redirect, request, session

from ..core.constants import AUTH_SESSION_KIND_KEY, AUTH_SESSION_USER_KEY, LOCAL_HOSTS, PUBLIC_API_PATHS
from ..services.auth_service import (
    clear_authenticated_session,
    get_user_by_session_identity,
    user_has_role,
    user_role,
)
from ..utils.logging_utils import (
    log_info,
    log_request_completion,
    log_warning,
    request_host,
    request_is_secure,
    should_log_access,
    should_set_hsts,
)


def register_request_hooks(app):
    @app.before_request
    def prepare_request_logging_context():
        g.request_started_at = time.perf_counter()

        request_id = str(request.headers.get('X-Request-Id') or '').strip()
        if not request_id:
            request_id = uuid.uuid4().hex[:16]
        g.request_id = request_id[:64]

        if should_log_access(request.path or ''):
            log_info('API request started')
        return None

    @app.before_request
    def enforce_https():
        if not app.config.get('ENFORCE_HTTPS'):
            return None
        if request.path == '/api/health':
            return None
        if request_host() in LOCAL_HOSTS or request_is_secure():
            return None

        if request.path.startswith('/api/'):
            log_warning('Rejected insecure API request', host=request_host())
            return jsonify({'error': 'HTTPS is required.'}), 403

        secure_url = request.url.replace('http://', 'https://', 1)
        log_warning('Redirecting insecure request to HTTPS', host=request_host())
        return redirect(secure_url, code=301)

    @app.before_request
    def require_authenticated_session():
        if request.method == 'OPTIONS':
            return None

        path = request.path or ''
        if not path.startswith(('/api/', '/uploads/', '/reports/')):
            return None

        if path in PUBLIC_API_PATHS:
            return None

        session_user_id = session.get(AUTH_SESSION_USER_KEY)
        if not session_user_id:
            log_warning('Rejected unauthenticated request')
            return jsonify({'error': 'Authentication required.'}), 401

        session_user_kind = session.get(AUTH_SESSION_KIND_KEY)
        user, resolved_kind = get_user_by_session_identity(session_user_id, session_user_kind)
        if not user:
            clear_authenticated_session()
            log_warning('Rejected request with invalid session')
            return jsonify({'error': 'Session is no longer valid.'}), 401

        if user_has_role(user, 'doctor') and not bool(getattr(user, 'is_active', True)):
            clear_authenticated_session()
            log_warning('Rejected request for disabled doctor account', user_id=getattr(user, 'id', None))
            return jsonify({'error': 'Doctor account is disabled.'}), 403

        g.auth_user = user
        g.auth_user_kind = resolved_kind or user_role(user)
        return None

    @app.after_request
    def add_security_headers(response):
        request_id = getattr(g, 'request_id', '')
        if request_id:
            response.headers['X-Request-Id'] = request_id

        if should_set_hsts():
            response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        return log_request_completion(response)
