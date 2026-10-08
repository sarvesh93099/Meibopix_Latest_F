import os

from flask import Blueprint, current_app, jsonify
from sqlalchemy import text

from ..models import db
from ..services.storage_service import storage_response
from ..utils.logging_utils import log_error, log_info


system_bp = Blueprint('system', __name__)


@system_bp.route('/api/health', methods=['GET'])
def health_check():
    frontend_dist_dir = str(current_app.config.get('FRONTEND_DIST_DIR') or '').strip()
    health = {
        'status': 'ok',
        'database': 'ok',
        'storage_backend': current_app.config.get('STORAGE_BACKEND', 'unknown'),
        'frontend_built': bool(frontend_dist_dir and os.path.isdir(frontend_dist_dir)),
        'camera_enabled': bool(current_app.config.get('CAMERA_ENABLED')),
    }

    try:
        db.session.execute(text('SELECT 1'))
    except Exception:
        health['status'] = 'degraded'
        health['database'] = 'error'
        log_error('Health check detected database connectivity issues')
        return jsonify(health), 503

    log_info('Health check completed successfully', storage_backend=health['storage_backend'])
    return jsonify(health)


@system_bp.route('/uploads/<filename>')
def uploaded_file(filename):
    return storage_response('upload', filename)


@system_bp.route('/reports/<filename>')
def report_file(filename):
    return storage_response('report', filename)
