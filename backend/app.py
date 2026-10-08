"""Primary backend bootstrap, exports, and local development runner."""

import json
import logging
import os
import sys

from dotenv import load_dotenv
from flask import Flask, g, has_request_context, request
from flask_cors import CORS

current_module = sys.modules.get(__name__)
if current_module is not None:
    sys.modules['_backend_root_app'] = current_module

from app.core.constants import LOCAL_HOSTS, LOGGED_REQUEST_PATH_PREFIXES
from app.config import (
    build_app_config,
    build_cors_resources,
    ensure_runtime_directories,
    resolve_frontend_dist_dir,
)
from app.extensions import db
from app.middleware.error_handlers import register_error_handlers
from app.middleware.request_hooks import register_request_hooks
from app.models import init_db
from app.routes import register_blueprints
from app.services.auth_service import bootstrap_auth_users
from app.services.runtime_services import ensure_meibography_service as _ensure_meibography_service
from app.services.storage_service import initialize_storage
from app.utils.env import env_flag, env_int
from app.utils.image_utils import apply_brightness_contrast, auto_enhance_image


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True,
)

logger = logging.getLogger('meibography')
logger.setLevel(logging.INFO)


def get_logger():
    return logger


def get_client_ip():
    forwarded_for = str(request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
    return forwarded_for or request.remote_addr or 'unknown'


def request_host():
    return str(request.host or '').split(':')[0].lower()


def request_is_secure():
    forwarded_proto_values = []
    for header_name in ('X-Forwarded-Proto', 'CloudFront-Forwarded-Proto'):
        raw_value = str(request.headers.get(header_name) or '').strip().lower()
        if raw_value:
            forwarded_proto_values.extend(
                value.strip()
                for value in raw_value.split(',')
                if value and value.strip()
            )

    forwarded_ssl = str(request.headers.get('X-Forwarded-Ssl') or '').strip().lower()
    return (
        request.is_secure or
        ('https' in forwarded_proto_values) or
        forwarded_ssl == 'on'
    )


def build_log_details(**fields):
    details = {}
    if has_request_context():
        details['request_id'] = getattr(g, 'request_id', '-')
        details['method'] = getattr(request, 'method', '-')
        details['path'] = getattr(request, 'path', '-')
        details['ip'] = get_client_ip()
        auth_user = getattr(g, 'auth_user', None)
        if auth_user is not None:
            details['user_id'] = getattr(auth_user, 'id', None)
            details['role'] = str(getattr(auth_user, 'role', '') or '').strip().lower() or 'doctor'

    details.update(fields)
    return details


def format_log_details(**fields):
    parts = []
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, float):
            rendered_value = f'{value:.2f}'
        elif isinstance(value, (dict, list, tuple, set)):
            rendered_value = json.dumps(value, default=str, separators=(',', ':'))
        else:
            rendered_value = str(value)

        rendered_value = rendered_value.replace('\n', ' ').replace('\r', ' ').strip()
        if rendered_value:
            parts.append(f'{key}={rendered_value}')

    return ' '.join(parts)


def log_info(message, **fields):
    details = format_log_details(**build_log_details(**fields))
    if details:
        logger.info('%s | %s', message, details)
        return
    logger.info(message)


def log_warning(message, **fields):
    details = format_log_details(**build_log_details(**fields))
    if details:
        logger.warning('%s | %s', message, details)
        return
    logger.warning(message)


def log_error(message, include_traceback=True, **fields):
    details = format_log_details(**build_log_details(**fields))
    if details:
        logger.error('%s | %s', message, details, exc_info=include_traceback)
        return
    logger.error(message, exc_info=include_traceback)


def should_log_access(path):
    return bool(path) and path.startswith(LOGGED_REQUEST_PATH_PREFIXES) and env_flag('APP_LOG_ACCESS_LOGS', True)


def log_request_completion(response):
    path = request.path or ''
    if not should_log_access(path):
        return response

    started_at = getattr(g, 'request_started_at', None)
    duration_ms = -1.0
    if started_at:
        import time

        duration_ms = (time.perf_counter() - started_at) * 1000.0
    request_id = getattr(g, 'request_id', '-')
    auth_user = getattr(g, 'auth_user', None)
    user_id = getattr(auth_user, 'id', 'anonymous')
    status_code = int(response.status_code or 0)
    log_details = {
        'request_id': request_id,
        'method': request.method,
        'path': path,
        'status_code': status_code,
        'duration_ms': duration_ms,
        'user_id': user_id,
        'ip': get_client_ip(),
    }

    if status_code >= 500:
        log_error('API request completed with server error response', include_traceback=False, **log_details)
    elif status_code >= 400:
        log_warning('API request completed with client error response', **log_details)
    else:
        log_info('API request completed successfully', **log_details)

    return response


def should_set_hsts():
    return request_is_secure() and request_host() not in LOCAL_HOSTS


def create_app():
    basedir = os.path.abspath(os.path.dirname(__file__))
    project_root = os.path.abspath(os.path.join(basedir, os.pardir))
    load_dotenv(os.path.join(project_root, '.env'))
    frontend_dist_dir = resolve_frontend_dist_dir(project_root)
    logger.info('Starting Flask application bootstrap')

    flask_app = Flask(
        __name__,
        # All frontend files use the blueprint's caching/compression policy.
        static_folder=None,
    )
    flask_app.config.from_mapping(build_app_config(basedir, frontend_dist_dir))
    # Bound OpenCV's native pool so concurrent API requests do not each use
    # every CPU core on a small server. This runs before image processing.
    import cv2

    cv2.setNumThreads(flask_app.config['OPENCV_THREADS'])
    flask_app.logger.handlers = logger.handlers
    flask_app.logger.setLevel(logger.level)
    flask_app.logger.propagate = False

    CORS(flask_app, resources=build_cors_resources(), supports_credentials=True)

    ensure_runtime_directories(flask_app.config)
    initialize_storage(flask_app)
    logger.info(
        'Runtime directories and storage backend initialized | storage_backend=%s frontend_dist_present=%s',
        flask_app.config.get('STORAGE_BACKEND'),
        bool(frontend_dist_dir and os.path.isdir(frontend_dist_dir)),
    )

    init_db(flask_app)
    logger.info('Database layer initialized successfully')

    register_request_hooks(flask_app)
    register_blueprints(flask_app)
    register_error_handlers(flask_app)

    with flask_app.app_context():
        bootstrap_auth_users()

    logger.info('Application startup completed successfully')
    return flask_app


app = create_app()


def run_dev_server():
    host = os.getenv('HOST', '127.0.0.1')
    port = env_int('PORT', 5000)
    debug_enabled = bool(app.config.get('DEBUG'))
    logger.info('Starting Flask development server | host=%s port=%s debug=%s', host, port, debug_enabled)
    app.run(
        host=host,
        port=port,
        debug=debug_enabled,
        use_reloader=False,
    )


__all__ = [
    'app',
    'create_app',
    'db',
    'apply_brightness_contrast',
    'auto_enhance_image',
    '_ensure_meibography_service',
    'run_dev_server',
    'get_logger',
    'get_client_ip',
    'request_host',
    'request_is_secure',
    'build_log_details',
    'format_log_details',
    'log_info',
    'log_warning',
    'log_error',
    'should_log_access',
    'log_request_completion',
    'should_set_hsts',
]


if __name__ == '__main__':
    run_dev_server()
