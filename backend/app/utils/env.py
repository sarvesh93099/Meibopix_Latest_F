"""Typed environment helpers used across the backend."""

import os


def env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def env_int(name, default):
    raw_value = os.getenv(name)
    if raw_value in (None, ''):
        return default
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return default


def default_cors_origins():
    return [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3002',
        'http://127.0.0.1:3002',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ]


def env_origins(allow_wildcard=False):
    raw_origins = os.getenv('CORS_ORIGINS', '').strip()
    if not raw_origins:
        return default_cors_origins()
    if raw_origins == '*':
        return '*' if allow_wildcard else default_cors_origins()

    origins = [origin.strip() for origin in raw_origins.split(',') if origin.strip()]
    return origins or default_cors_origins()


def build_sqlalchemy_engine_options(database_url):
    options = {'pool_pre_ping': True}

    if database_url.startswith('sqlite:///'):
        options['connect_args'] = {'timeout': 30}
        return options

    pool_size = env_int('DB_POOL_SIZE', 3)
    max_overflow = env_int('DB_MAX_OVERFLOW', 2)
    pool_timeout = env_int('DB_POOL_TIMEOUT_SECONDS', 30)
    pool_recycle = env_int('DB_POOL_RECYCLE_SECONDS', 1800)

    if pool_size > 0:
        options['pool_size'] = pool_size
    if max_overflow >= 0:
        options['max_overflow'] = max_overflow
    if pool_timeout > 0:
        options['pool_timeout'] = pool_timeout
    if pool_recycle > 0:
        options['pool_recycle'] = pool_recycle

    return options
