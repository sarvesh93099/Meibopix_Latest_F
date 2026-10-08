"""Camera preview/capture business logic."""

import os
import uuid
from datetime import datetime

import cv2

from ..models import Capture, db
from ..services.runtime_services import ensure_camera_manager
from ..services.storage_service import build_storage_url, save_storage_bytes, save_storage_path
from ..utils.image_utils import apply_brightness_contrast, decode_request_image
from ..utils.logging_utils import log_info
from .patient_service import get_patient_for_current_user


def fetch_camera_settings():
    camera_manager = ensure_camera_manager()
    if not camera_manager:
        raise RuntimeError('Camera not initialized')

    camera_available = camera_manager.ensure_camera_ready()
    settings = camera_manager.get_settings()
    settings['camera_available'] = bool(camera_available)
    return settings, camera_available


def update_camera_settings(payload):
    camera_manager = ensure_camera_manager()
    if not camera_manager:
        raise RuntimeError('Camera not initialized')

    brightness = payload.get('brightness', 50)
    contrast = payload.get('contrast', 50)
    camera_manager.update_settings(brightness, contrast)
    log_info('Camera settings updated successfully', brightness=brightness, contrast=contrast)
    return camera_manager.get_settings()


def capture_image(payload, current_user, upload_folder, storage_backend_name):
    patient_id_raw = payload.get('patient_id')
    eye = payload.get('eye')
    lid = payload.get('lid')
    brightness = payload.get('brightness', 50)
    contrast = payload.get('contrast', 50)
    image_data = payload.get('image_data')

    if eye not in ['left', 'right']:
        raise ValueError('Eye must be left or right')
    if lid not in ['upper', 'lower']:
        raise ValueError('Lid must be upper or lower')

    patient_id = None
    if patient_id_raw not in [None, '']:
        try:
            patient_id = int(patient_id_raw)
        except (TypeError, ValueError) as error:
            raise ValueError('Patient ID must be a valid integer') from error

        patient = get_patient_for_current_user(patient_id, current_user)
        if not patient:
            raise LookupError('Patient not found')

    if image_data:
        image_bgr, _ = decode_request_image({'image_data': image_data}, upload_folder)
        image_bgr = apply_brightness_contrast(image_bgr, brightness, contrast)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        owner = patient_id if patient_id else 'guest'
        filename = f'capture_{owner}_{eye}_{lid}_{timestamp}_{uuid.uuid4().hex[:8]}.png'
        encoded_ok, encoded_image = cv2.imencode('.png', image_bgr)
        if not encoded_ok:
            raise RuntimeError('Failed to persist captured image')
        save_storage_bytes('upload', filename, encoded_image.tobytes(), content_type='image/png')
    else:
        camera_manager = ensure_camera_manager()
        if not camera_manager:
            raise RuntimeError('Camera not initialized')
        owner = patient_id if patient_id else 'guest'
        result = camera_manager.capture_frame(owner, eye, lid, brightness, contrast)
        if not result['success']:
            raise RuntimeError(result.get('error', 'Failed to capture'))
        filename = result['filename']
        temp_file_path = result.get('file_path')
        save_storage_path('upload', filename, temp_file_path, content_type='image/jpeg')
        image_bgr = cv2.imread(temp_file_path)
        if image_bgr is None:
            raise RuntimeError('Captured file could not be read')
        if storage_backend_name == 's3' and temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    capture = None
    if patient_id:
        capture = Capture(
            patient_id=patient_id,
            eye=eye,
            lid=lid,
            brightness=brightness,
            contrast=contrast,
            file_path=filename,
        )
        db.session.add(capture)
        db.session.commit()

    response_payload = {
        'status': 'uploaded',
        'upload_type': 'capture',
        'patient_id': patient_id,
        'capture_id': capture.id if capture else None,
        'eye': eye,
        'lid': lid,
        'file_path': filename,
        'image_url': build_storage_url('upload', filename),
        'created_at': capture.created_at.isoformat() if capture else datetime.utcnow().isoformat(),
        'message': 'Image uploaded successfully',
    }
    log_info(
        'Capture image operation completed successfully',
        patient_id=patient_id or 'guest',
        capture_id=capture.id if capture else None,
        eye=eye,
        lid=lid,
        used_uploaded_snapshot=bool(image_data),
    )
    return response_payload
