"""Shared OpenCV camera lifecycle management."""

import os
import threading
import time
from datetime import datetime

import cv2
from werkzeug.utils import secure_filename


class CameraManager:
    def __init__(self, upload_folder, camera_enabled=True):
        self.upload_folder = upload_folder
        self.camera_enabled = bool(camera_enabled)
        self.camera = None
        self.brightness = 50
        self.contrast = 50
        self.lock = threading.Lock()
        self.running = False

    @staticmethod
    def _map_ui_to_cv(brightness_value, contrast_value):
        try:
            brightness_int = int(brightness_value)
        except (TypeError, ValueError):
            brightness_int = 50
        try:
            contrast_int = int(contrast_value)
        except (TypeError, ValueError):
            contrast_int = 50

        brightness_int = max(0, min(100, brightness_int))
        contrast_int = max(0, min(100, contrast_int))

        beta = int(round((brightness_int - 50) * 2.0))
        alpha = 1.0 + ((contrast_int - 50) / 50.0) * 0.5
        return alpha, beta

    def initialize_camera(self):
        if not self.camera_enabled:
            return False

        try:
            if self.camera and self.camera.isOpened():
                return True
            self.camera = cv2.VideoCapture(0)
            if not self.camera.isOpened():
                raise RuntimeError('Could not open camera')
            return True
        except Exception:
            return False

    def release_camera(self):
        if self.camera:
            self.camera.release()
            self.camera = None

    def ensure_camera_ready(self):
        with self.lock:
            if not self.camera_enabled:
                return False

            if self.camera and self.camera.isOpened():
                return True

            if self.camera:
                try:
                    self.camera.release()
                except Exception:
                    pass
                self.camera = None

            return self.initialize_camera()

    def apply_settings(self, frame):
        alpha, beta = self._map_ui_to_cv(self.brightness, self.contrast)
        return cv2.convertScaleAbs(frame, alpha=alpha, beta=beta)

    def get_frame(self):
        if not self.ensure_camera_ready():
            return None

        success, frame = self.camera.read()
        if success:
            frame = self.apply_settings(frame)
            encoded, jpeg = cv2.imencode('.jpg', frame)
            if encoded:
                return jpeg.tobytes()
        return None

    def capture_frame(self, patient_id, eye, lid, brightness, contrast):
        if not self.ensure_camera_ready():
            return {'success': False, 'error': 'Camera is unavailable'}

        success, frame = self.camera.read()
        if success:
            alpha, beta = self._map_ui_to_cv(brightness, contrast)
            frame = cv2.convertScaleAbs(frame, alpha=alpha, beta=beta)

            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = secure_filename(f'capture_{patient_id}_{eye}_{lid}_{timestamp}.jpg')
            file_path = os.path.join(self.upload_folder, filename)
            cv2.imwrite(file_path, frame)
            return {
                'success': True,
                'filename': filename,
                'file_path': file_path,
            }

        return {'success': False, 'error': 'Failed to capture frame'}

    def update_settings(self, brightness, contrast):
        try:
            brightness_value = int(brightness)
        except (TypeError, ValueError):
            brightness_value = 50

        try:
            contrast_value = int(contrast)
        except (TypeError, ValueError):
            contrast_value = 50

        with self.lock:
            self.brightness = max(0, min(100, brightness_value))
            self.contrast = max(0, min(100, contrast_value))

    def get_settings(self):
        with self.lock:
            return {
                'brightness': self.brightness,
                'contrast': self.contrast,
                'camera_available': bool(self.camera and self.camera.isOpened()),
            }

    def generate_stream(self):
        while self.running:
            frame = self.get_frame()
            if frame:
                yield (
                    b'--frame\r\n'
                    b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n\r\n'
                )
            else:
                time.sleep(0.1)


camera_manager = None


def init_camera_manager(upload_folder, camera_enabled=True):
    global camera_manager
    camera_manager = CameraManager(upload_folder, camera_enabled=camera_enabled)
    if camera_enabled:
        camera_manager.initialize_camera()


def get_camera_manager():
    return camera_manager
