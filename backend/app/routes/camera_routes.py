from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.exceptions import RequestEntityTooLarge

from ..models import db
from ..services.camera_service import capture_image, fetch_camera_settings, update_camera_settings
from ..services.patient_service import handle_uploaded_file_request
from ..services.runtime_services import ensure_camera_manager
from ..utils.logging_utils import log_error, log_info, log_warning


camera_bp = Blueprint('camera', __name__)


@camera_bp.route('/api/camera/stream', methods=['GET'])
def camera_stream():
    camera_manager = ensure_camera_manager()
    if not camera_manager:
        log_warning('Camera stream requested while camera manager was unavailable')
        return jsonify({'error': 'Camera not initialized'}), 500

    if not camera_manager.ensure_camera_ready():
        log_warning('Camera stream requested while camera device was unavailable')
        return jsonify({'error': 'Camera is unavailable.'}), 503

    camera_manager.running = True
    log_info('Camera stream opened successfully')
    from flask import Response

    return Response(camera_manager.generate_stream(), mimetype='multipart/x-mixed-replace; boundary=frame')


@camera_bp.route('/api/camera/settings', methods=['GET'])
def get_camera_settings():
    try:
        settings, camera_available = fetch_camera_settings()
        if not camera_available:
            log_warning('Camera settings returned with unavailable camera state')
            return jsonify(settings), 503
        log_info('Camera settings fetched successfully', camera_available=True)
        return jsonify(settings)
    except Exception:
        log_error('Failed to fetch camera settings')
        return jsonify({'error': 'Camera not initialized'}), 500


@camera_bp.route('/api/camera/settings', methods=['POST'])
def set_camera_settings():
    try:
        return jsonify(update_camera_settings(request.get_json(silent=True) or {}))
    except Exception:
        log_error('Failed to update camera settings')
        return jsonify({'error': 'Failed to update settings'}), 500


@camera_bp.route('/api/capture', methods=['POST'])
def capture_snapshot():
    try:
        payload = capture_image(
            request.get_json() or {},
            getattr(g, 'auth_user', None),
            current_app.config['UPLOAD_FOLDER'],
            current_app.config.get('STORAGE_BACKEND'),
        )
        return jsonify(payload)
    except LookupError as not_found_error:
        return jsonify({'error': str(not_found_error)}), 404
    except ValueError as validation_error:
        return jsonify({'error': str(validation_error)}), 400
    except Exception:
        db.session.rollback()
        log_error('Failed to capture image')
        return jsonify({'error': 'Failed to capture image'}), 500


@camera_bp.route('/api/upload', methods=['POST'])
def upload_image():
    content_type = str(request.content_type or '').lower()
    if 'file' in request.files or content_type.startswith('multipart/form-data'):
        try:
            return jsonify(handle_uploaded_file_request(current_user=getattr(g, 'auth_user', None)))
        except LookupError as not_found_error:
            return jsonify({'error': str(not_found_error)}), 404
        except ValueError as validation_error:
            return jsonify({'error': str(validation_error)}), 400
        except RequestEntityTooLarge:
            raise
        except Exception:
            log_error('Failed to upload image')
            return jsonify({'error': 'Failed to upload image'}), 500

    return capture_snapshot()
