import os
import mimetypes

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from werkzeug.security import safe_join


frontend_bp = Blueprint('frontend', __name__)


IMMUTABLE_STATIC_ASSET_MAX_AGE = 31536000


def _is_immutable_frontend_asset(path):
    if not path:
        return False

    normalized_path = str(path).replace('\\', '/')
    if not normalized_path.startswith('assets/'):
        return False

    filename = os.path.basename(normalized_path)
    stem, _ = os.path.splitext(filename)
    return '-' in stem


def _frontend_file_response(dist_dir, relative_path):
    served_path = relative_path
    compressed_path = safe_join(dist_dir, f'{relative_path}.gz')
    has_compressed_version = bool(compressed_path and os.path.isfile(compressed_path))
    use_gzip = (
        has_compressed_version and request.accept_encodings['gzip'] > 0
        and not request.headers.get('Range')
    )
    if use_gzip:
        served_path += '.gz'
    response = send_from_directory(
        dist_dir,
        served_path,
        conditional=True,
        max_age=IMMUTABLE_STATIC_ASSET_MAX_AGE if _is_immutable_frontend_asset(relative_path) else 0,
    )
    if has_compressed_version:
        response.vary.add('Accept-Encoding')
    if use_gzip:
        response.headers['Content-Encoding'] = 'gzip'
        response.mimetype = mimetypes.guess_type(relative_path)[0] or 'application/octet-stream'

    if _is_immutable_frontend_asset(relative_path):
        response.headers['Cache-Control'] = f'public, max-age={IMMUTABLE_STATIC_ASSET_MAX_AGE}, immutable'
    else:
        response.headers['Cache-Control'] = 'no-cache'

    return response


@frontend_bp.route('/', defaults={'path': ''})
@frontend_bp.route('/<path:path>')
def frontend_app(path):
    dist_dir = current_app.config.get('FRONTEND_DIST_DIR')

    if not dist_dir or not os.path.isdir(dist_dir):
        return jsonify({'status': 'backend-only', 'frontend_built': False}), 404

    if path in {'api', 'uploads', 'reports'} or path.startswith(('api/', 'uploads/', 'reports/')):
        return jsonify({'error': 'Not found'}), 404

    requested_file = safe_join(dist_dir, path) if path else None
    if requested_file and os.path.isfile(requested_file):
        return _frontend_file_response(dist_dir, path)

    if path and '.' in path:
        return jsonify({'error': 'File not found'}), 404

    return _frontend_file_response(dist_dir, 'index.html')
