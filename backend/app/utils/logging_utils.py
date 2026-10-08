"""Compatibility wrappers for the logger helpers now owned by backend/app.py."""

import json
import logging
import sys

from flask import g, has_request_context, request

from ..core.constants import LOCAL_HOSTS, LOGGED_REQUEST_PATH_PREFIXES
from .env import env_flag


_ROOT_APP_MODULE_NAME = '_backend_root_app'
_LOGGER_NAME = 'meibography'


def _get_root_app_attr(name):
    # Logging must not create an application, open a database or read .env.
    # During bootstrap (or when importing a standalone service), use the local
    # fallback until the root app has registered its helpers.
    return getattr(sys.modules.get(_ROOT_APP_MODULE_NAME), name, None)


def get_logger():
    root_get_logger = _get_root_app_attr('get_logger')
    if callable(root_get_logger):
        return root_get_logger()
    return logging.getLogger(_LOGGER_NAME)


def get_client_ip():
    root_get_client_ip = _get_root_app_attr('get_client_ip')
    if callable(root_get_client_ip):
        return root_get_client_ip()
    forwarded_for = str(request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
    return forwarded_for or request.remote_addr or 'unknown'


def request_host():
    root_request_host = _get_root_app_attr('request_host')
    if callable(root_request_host):
        return root_request_host()
    return str(request.host or '').split(':')[0].lower()


def request_is_secure():
    root_request_is_secure = _get_root_app_attr('request_is_secure')
    if callable(root_request_is_secure):
        return root_request_is_secure()

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
    root_build_log_details = _get_root_app_attr('build_log_details')
    if callable(root_build_log_details):
        return root_build_log_details(**fields)

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
    root_format_log_details = _get_root_app_attr('format_log_details')
    if callable(root_format_log_details):
        return root_format_log_details(**fields)

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
    root_log_info = _get_root_app_attr('log_info')
    if callable(root_log_info):
        return root_log_info(message, **fields)

    logger = get_logger()
    details = format_log_details(**build_log_details(**fields))
    if details:
        logger.info('%s | %s', message, details)
        return None
    logger.info(message)
    return None


def log_warning(message, **fields):
    root_log_warning = _get_root_app_attr('log_warning')
    if callable(root_log_warning):
        return root_log_warning(message, **fields)

    logger = get_logger()
    details = format_log_details(**build_log_details(**fields))
    if details:
        logger.warning('%s | %s', message, details)
        return None
    logger.warning(message)
    return None


def log_error(message, include_traceback=True, **fields):
    root_log_error = _get_root_app_attr('log_error')
    if callable(root_log_error):
        return root_log_error(message, include_traceback=include_traceback, **fields)

    logger = get_logger()
    details = format_log_details(**build_log_details(**fields))
    if details:
        logger.error('%s | %s', message, details, exc_info=include_traceback)
        return None
    logger.error(message, exc_info=include_traceback)
    return None


def should_log_access(path):
    root_should_log_access = _get_root_app_attr('should_log_access')
    if callable(root_should_log_access):
        return root_should_log_access(path)
    return bool(path) and path.startswith(LOGGED_REQUEST_PATH_PREFIXES) and env_flag('APP_LOG_ACCESS_LOGS', True)


def log_request_completion(response):
    root_log_request_completion = _get_root_app_attr('log_request_completion')
    if callable(root_log_request_completion):
        return root_log_request_completion(response)

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
    root_should_set_hsts = _get_root_app_attr('should_set_hsts')
    if callable(root_should_set_hsts):
        return root_should_set_hsts()
    return request_is_secure() and request_host() not in LOCAL_HOSTS
