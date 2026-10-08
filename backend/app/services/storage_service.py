"""High-level storage helpers used by routes and other services."""

import os

from flask import Response, jsonify, send_file

from ..core import runtime
from ..utils.logging_utils import log_error, log_info, log_warning
from .storage_backend import LocalStorageBackend, StorageError, create_storage_backend


def initialize_storage(app):
    storage_backend = create_storage_backend(app)
    runtime.set_storage_backend(storage_backend)
    return storage_backend


def get_storage_backend():
    storage_backend = runtime.get_storage_backend()
    if storage_backend is None:
        raise RuntimeError('Storage backend has not been initialized yet.')
    return storage_backend


def build_storage_url(category, filename):
    safe_name = os.path.basename(filename or '')
    if not safe_name:
        return ''
    route_name = 'uploads' if category == 'upload' else 'reports'
    return f'/{route_name}/{safe_name}'


def read_storage_bytes(category, filename):
    safe_name = os.path.basename(filename or '')
    if not safe_name:
        raise FileNotFoundError('A filename is required.')
    return get_storage_backend().read_bytes(category, safe_name)


def save_storage_filestorage(category, filename, filestorage):
    safe_name = os.path.basename(filename or '')
    return get_storage_backend().save_filestorage(category, safe_name, filestorage)


def save_storage_bytes(category, filename, payload, content_type=None):
    safe_name = os.path.basename(filename or '')
    return get_storage_backend().save_bytes(category, safe_name, payload, content_type=content_type)


def save_storage_path(category, filename, source_path, content_type=None):
    safe_name = os.path.basename(filename or '')
    return get_storage_backend().save_path(category, safe_name, source_path, content_type=content_type)


def delete_storage_file(category, filename):
    safe_name = os.path.basename(filename or '')
    if safe_name:
        get_storage_backend().delete(category, safe_name)


def storage_response(category, filename):
    safe_name = os.path.basename(filename or '')
    if not safe_name:
        log_warning('Storage request rejected because filename was missing', category=category)
        return jsonify({'error': 'File not found'}), 404

    try:
        backend = get_storage_backend()
        if isinstance(backend, LocalStorageBackend):
            return send_file(backend.local_file_path(category, safe_name), conditional=True, max_age=0)
        payload = read_storage_bytes(category, safe_name)
    except FileNotFoundError:
        log_warning('Requested storage file was not found', category=category, filename=safe_name)
        return jsonify({'error': 'File not found'}), 404
    except StorageError as error:
        log_error('Storage backend failed to read file', category=category, filename=safe_name, reason=str(error))
        return jsonify({'error': str(error)}), 500

    mimetype = get_storage_backend().resolve_content_type(safe_name)
    log_info('Storage file served successfully', category=category, filename=safe_name, mimetype=mimetype)
    return Response(payload, mimetype=mimetype)
