"""Application configuration and path resolution helpers."""

import os
import warnings

from .utils.env import env_flag, env_int, env_origins, build_sqlalchemy_engine_options


PLACEHOLDER_SECRET_VALUES = {
    'replace-with-a-strong-secret',
    'replace-with-a-long-random-secret',
    'your_key',
}
PLACEHOLDER_USERNAME_VALUES = {
    'your-admin-user',
    'your-doctor-user',
}
PLACEHOLDER_PASSWORD_VALUES = {
    'change-this-password',
    'replace-with-a-strong-password',
}


def _read_env_value(*names):
    for name in names:
        raw_value = os.getenv(name)
        if raw_value is None:
            continue

        value = str(raw_value).strip()
        if value:
            return value

    return None


def _read_required_env(*names, invalid_values=None):
    value = _read_env_value(*names)
    if value is None:
        joined_names = ' or '.join(names)
        raise RuntimeError(f'Missing required environment variable: {joined_names}')

    if invalid_values and value in invalid_values:
        joined_names = ' or '.join(names)
        raise RuntimeError(
            f'Environment variable {joined_names} still contains a placeholder value.'
        )

    return value


def resolve_secret_key(app_env):
    secret_key = _read_env_value('SECRET_KEY', 'FLASK_SECRET_KEY')
    if secret_key is None:
        if app_env in {'production', 'prod'}:
            raise RuntimeError('Missing required environment variable: SECRET_KEY or FLASK_SECRET_KEY')

        # Development fallback to avoid hard failure in local setups.
        warnings.warn(
            'SECRET_KEY/FLASK_SECRET_KEY is not set. Using an insecure development default key.',
            RuntimeWarning,
            stacklevel=2,
        )
        return 'dev-insecure-secret-key-change-me'

    if secret_key in PLACEHOLDER_SECRET_VALUES:
        raise RuntimeError('Environment variable SECRET_KEY or FLASK_SECRET_KEY still contains a placeholder value.')

    return secret_key


def resolve_frontend_dist_dir(project_root):
    configured_path = str(
        os.getenv('FRONTEND_DIST_DIR', os.path.join(project_root, 'frontend', 'dist'))
    ).strip()

    if not os.path.isabs(configured_path):
        configured_path = os.path.join(project_root, configured_path)

    return os.path.realpath(configured_path)


def resolve_database_url(basedir):
    database_url = os.getenv('DATABASE_URL')
    if database_url:
        return database_url

    return 'sqlite:///' + os.path.join(
        basedir,
        os.getenv('DATABASE_FILENAME', 'meibography.db'),
    )


def resolve_model_folder(basedir):
    configured_path = _read_env_value('MEIBOGRAPHY_MODEL_FOLDER', 'MODEL_PATH')
    local_folder = os.path.realpath(os.path.join(basedir, 'meibography_models'))
    if configured_path:
        # Resolve relative model paths from the project, independent of launch cwd.
        absolute_path = os.path.realpath(os.path.join(os.path.dirname(basedir), configured_path))
        _, extension = os.path.splitext(absolute_path)
        configured_folder = os.path.dirname(absolute_path) if extension else absolute_path
        if configured_folder != local_folder:
            return configured_folder

    return local_folder


def resolve_debug_flag():
    if os.getenv('DEBUG') is not None:
        return env_flag('DEBUG', False)

    return env_flag('FLASK_DEBUG', False)


def resolve_session_cookie_secure(app_env, enforce_https):
    if os.getenv('SESSION_COOKIE_SECURE') is not None:
        return env_flag('SESSION_COOKIE_SECURE', False)

    # Keep development sessions working over localhost HTTP while defaulting to
    # secure cookies in production-style environments.
    return bool(enforce_https and app_env in {'production', 'prod'})


def build_app_config(basedir, frontend_dist_dir):
    database_url = resolve_database_url(basedir)
    enforce_https = env_flag('ENFORCE_HTTPS', True)
    model_folder = resolve_model_folder(basedir)
    debug_enabled = resolve_debug_flag()
    app_env = str(os.getenv('APP_ENV', 'development') or 'development').strip().lower()
    bootstrap_username = _read_env_value('AUTH_BOOTSTRAP_USERNAME')
    bootstrap_password = _read_env_value('AUTH_BOOTSTRAP_PASSWORD')
    admin_username = _read_env_value('AUTH_ADMIN_USERNAME', 'ADMIN_USERNAME')
    admin_password = _read_env_value('AUTH_ADMIN_PASSWORD', 'ADMIN_PASSWORD')

    if app_env in {'production', 'prod'} and debug_enabled:
        raise RuntimeError('DEBUG must be false when APP_ENV=production.')

    if bool(bootstrap_username) != bool(bootstrap_password):
        raise RuntimeError('AUTH_BOOTSTRAP_USERNAME and AUTH_BOOTSTRAP_PASSWORD must either both be set or both be empty.')

    if bool(admin_username) != bool(admin_password):
        raise RuntimeError('AUTH_ADMIN_USERNAME and AUTH_ADMIN_PASSWORD must either both be set or both be empty.')

    if bootstrap_username and bootstrap_username in PLACEHOLDER_USERNAME_VALUES:
        raise RuntimeError('AUTH_BOOTSTRAP_USERNAME still contains a placeholder value.')

    if bootstrap_password and bootstrap_password in PLACEHOLDER_PASSWORD_VALUES:
        raise RuntimeError('AUTH_BOOTSTRAP_PASSWORD still contains a placeholder value.')

    if admin_username and admin_username in PLACEHOLDER_USERNAME_VALUES:
        raise RuntimeError('AUTH_ADMIN_USERNAME still contains a placeholder value.')

    if admin_password and admin_password in PLACEHOLDER_PASSWORD_VALUES:
        raise RuntimeError('AUTH_ADMIN_PASSWORD still contains a placeholder value.')

    return {
        'APP_ENV': app_env,
        'SQLALCHEMY_DATABASE_URI': database_url,
        'SQLALCHEMY_TRACK_MODIFICATIONS': False,
        'SQLALCHEMY_ENGINE_OPTIONS': build_sqlalchemy_engine_options(database_url),
        'JSON_SORT_KEYS': False,
        'UPLOAD_FOLDER': os.path.abspath(os.getenv('UPLOAD_FOLDER', os.path.join(basedir, 'uploads'))),
        'REPORT_FOLDER': os.path.abspath(os.getenv('REPORT_FOLDER', os.path.join(basedir, 'reports'))),
        'MEIBOGRAPHY_MODEL_FOLDER': model_folder,
        'MODEL_PATH': model_folder,
        'MEIBOGRAPHY_INFERENCE_BACKEND': os.getenv('MEIBOGRAPHY_INFERENCE_BACKEND', 'torch').strip().lower(),
        'ONNX_RELEASE_AFTER_REQUEST': env_flag('ONNX_RELEASE_AFTER_REQUEST', True),
        'SERVER_BLINK_ENABLED': env_flag('ENABLE_SERVER_BLINK', True),
        'MAX_CONTENT_LENGTH': max(1, env_int('MAX_CONTENT_LENGTH_MB', 220)) * 1024 * 1024,
        'MAX_IMAGE_UPLOAD_BYTES': max(1, env_int('MAX_IMAGE_UPLOAD_MB', 15)) * 1024 * 1024,
        'MAX_REPORT_UPLOAD_BYTES': max(1, env_int('MAX_REPORT_UPLOAD_MB', 20)) * 1024 * 1024,
        'MAX_VIDEO_UPLOAD_BYTES': max(1, env_int('MAX_VIDEO_UPLOAD_MB', 200)) * 1024 * 1024,
        'MAX_IMAGE_PIXELS': max(1, env_int('MAX_IMAGE_PIXELS', 12000000)),
        'IMAGE_PROCESSING_MAX_DIMENSION': max(256, env_int('IMAGE_PROCESSING_MAX_DIMENSION', 1600)),
        'OPENCV_THREADS': max(1, env_int('OPENCV_THREADS', 1)),
        # EC2 and other headless servers usually have no attached camera.
        # Keep the server camera opt-in; browser clients use their own camera.
        'CAMERA_ENABLED': env_flag('ENABLE_CAMERA', app_env not in {'production', 'prod'}),
        'DEBUG': debug_enabled,
        'FRONTEND_DIST_DIR': frontend_dist_dir,
        'SECRET_KEY': resolve_secret_key(app_env),
        'AUTH_USERNAME': bootstrap_username or '',
        'AUTH_PASSWORD': bootstrap_password or '',
        'AUTH_ADMIN_USERNAME': admin_username or '',
        'AUTH_ADMIN_PASSWORD': admin_password or '',
        'AUTH_ENABLE_2FA': env_flag('AUTH_ENABLE_2FA', False),
        'AUTH_2FA_SECRET': os.getenv('AUTH_2FA_SECRET', '').strip().replace(' ', ''),
        'ENFORCE_HTTPS': enforce_https,
        'SESSION_COOKIE_SAMESITE': os.getenv('AUTH_COOKIE_SAMESITE', 'Lax'),
        'SESSION_COOKIE_HTTPONLY': True,
        'SESSION_COOKIE_SECURE': resolve_session_cookie_secure(app_env, enforce_https),
        'PREFERRED_URL_SCHEME': 'https' if enforce_https else 'http',
    }


def build_cors_resources():
    allowed_origins = env_origins(allow_wildcard=True)
    return {
        r'/api/*': {'origins': allowed_origins},
        r'/uploads/*': {'origins': allowed_origins},
        r'/reports/*': {'origins': allowed_origins},
    }


def ensure_runtime_directories(app_config):
    for config_key in ('UPLOAD_FOLDER', 'REPORT_FOLDER', 'MEIBOGRAPHY_MODEL_FOLDER'):
        os.makedirs(app_config[config_key], exist_ok=True)
