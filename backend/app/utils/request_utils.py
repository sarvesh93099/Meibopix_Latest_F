"""Request parsing and upload validation helpers."""

import os

from flask import request
from werkzeug.exceptions import RequestEntityTooLarge


def parse_optional_int(value, field_label):
    if value in (None, ''):
        return None

    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f'{field_label} must be a valid integer') from error


def resolve_results_kind(default_kind='report'):
    raw_kind = request.args.get('kind')

    if raw_kind in (None, '') and request.form:
        raw_kind = request.form.get('kind') or request.form.get('resource')

    if raw_kind in (None, '') and request.is_json:
        payload = request.get_json(silent=True) or {}
        if isinstance(payload, dict):
            raw_kind = payload.get('kind') or payload.get('resource')
            if raw_kind in (None, '') and (
                'assessment_id' in payload or
                'completed_tests' in payload or
                'session_data' in payload
            ):
                raw_kind = 'assessment'

    if raw_kind in (None, ''):
        return default_kind

    return str(raw_kind).strip().lower()


def normalize_mime_type(value):
    return str(value or '').split(';', 1)[0].strip().lower()


def limit_to_mb(limit_bytes):
    if not limit_bytes:
        return '0'
    return f'{(int(limit_bytes) / (1024 * 1024)):.0f}'


def resolve_filestorage_size(file_storage):
    stream = getattr(file_storage, 'stream', None)
    if stream is None or not hasattr(stream, 'seek') or not hasattr(stream, 'tell'):
        return None

    try:
        current_position = stream.tell()
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        stream.seek(current_position)
        return max(0, int(size))
    except Exception:
        return None


def validate_filestorage(file_storage, *, allowed_extensions, allowed_mime_types, max_bytes, label):
    filename = str(getattr(file_storage, 'filename', '') or '').strip()
    if not filename:
        raise ValueError(f'{label} file is required.')

    extension = os.path.splitext(filename)[1].lower()
    if allowed_extensions and extension not in allowed_extensions:
        allowed = ', '.join(sorted(item.lstrip('.') for item in allowed_extensions))
        raise ValueError(f'{label} must be one of: {allowed}.')

    mime_type = normalize_mime_type(getattr(file_storage, 'mimetype', ''))
    if allowed_mime_types and mime_type and mime_type not in allowed_mime_types:
        raise ValueError(f'{label} has an unsupported content type.')

    file_size = resolve_filestorage_size(file_storage)
    if max_bytes and file_size is not None and file_size > int(max_bytes):
        raise RequestEntityTooLarge(
            description=f'{label} exceeds the maximum allowed size of {limit_to_mb(max_bytes)} MB.'
        )


def validate_request_content_length(max_bytes, label):
    request_size = request.content_length
    if max_bytes and request_size and int(request_size) > int(max_bytes):
        raise RequestEntityTooLarge(
            description=f'{label} exceeds the maximum allowed size of {limit_to_mb(max_bytes)} MB.'
        )
