# Start the production Waitress server with environment-driven tuning values.
import importlib.util
import os
import sys
from pathlib import Path

from waitress import serve


def _load_backend_app_module():
    module_name = '_backend_root_app'
    cached_module = sys.modules.get(module_name)
    if cached_module is not None:
        return cached_module

    module_path = Path(__file__).resolve().with_name('app.py')
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Unable to load backend app module from {module_path}')

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


app = _load_backend_app_module().app


def _env_int(name, default):
    raw_value = os.getenv(name)
    if raw_value in (None, ''):
        return default
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return default


def _waitress_kwargs():
    max_request_body_size = max(1, _env_int('MAX_CONTENT_LENGTH_MB', 220)) * 1024 * 1024
    return {
        'host': os.getenv('HOST', '0.0.0.0'),
        'port': _env_int('PORT', 5000),
        'threads': max(1, _env_int('WAITRESS_THREADS', 4)),
        'connection_limit': max(1, _env_int('WAITRESS_CONNECTION_LIMIT', 50)),
        'cleanup_interval': _env_int('WAITRESS_CLEANUP_INTERVAL', 30),
        'channel_timeout': _env_int('WAITRESS_CHANNEL_TIMEOUT', 120),
        'max_request_body_size': max_request_body_size,
        # Spool large transfers to disk instead of buffering each connection in RAM.
        'inbuf_overflow': max(16384, _env_int('WAITRESS_INBUF_OVERFLOW', 65536)),
        'outbuf_overflow': max(16384, _env_int('WAITRESS_OUTBUF_OVERFLOW', 262144)),
        'outbuf_high_watermark': max(262144, _env_int('WAITRESS_OUTBUF_HIGH_WATERMARK', 1048576)),
        'ident': os.getenv('WAITRESS_IDENT', 'meibography'),
    }


if __name__ == '__main__':
    serve(app, **_waitress_kwargs())
