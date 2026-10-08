"""Global error handlers and SPA fallback behavior."""

import os

from flask import current_app, jsonify, request, send_from_directory
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from ..utils.logging_utils import log_error, log_info, log_warning


def register_error_handlers(app):
    @app.errorhandler(404)
    def handle_not_found(error):
        dist_dir = current_app.config.get('FRONTEND_DIST_DIR')
        if request.path.startswith(('/api/', '/uploads/', '/reports/')):
            log_warning('Route not found', requested_path=request.path)
            return jsonify({'error': 'Not found'}), 404

        if dist_dir and os.path.isdir(dist_dir):
            log_info('Serving frontend SPA fallback', requested_path=request.path)
            return send_from_directory(dist_dir, 'index.html')

        log_warning('Route not found and frontend build is unavailable', requested_path=request.path)
        return jsonify({'error': 'Not found'}), 404

    @app.errorhandler(BadRequest)
    def handle_bad_request(error):
        log_warning('Bad request handled globally', reason=str(getattr(error, 'description', error)))
        return jsonify({'error': 'Bad request.'}), 400

    @app.errorhandler(RequestEntityTooLarge)
    def handle_request_entity_too_large(error):
        log_warning('Request entity too large', max_content_length=current_app.config.get('MAX_CONTENT_LENGTH'))
        return jsonify({'error': 'Request payload is too large.'}), 413

    @app.errorhandler(Exception)
    def handle_unexpected_exception(error):
        log_error('Unhandled application exception')
        return jsonify({'error': 'Internal server error'}), 500
