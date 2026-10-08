"""Blueprint registration for the modular Flask API."""

from ..modules.blink import blink_bp
from ..modules.meibography import meibography_bp
from .admin_routes import admin_bp
from .auth_routes import auth_bp
from .camera_routes import camera_bp
from .clinical_routes import clinical_bp
from .frontend_routes import frontend_bp
from .patient_routes import patient_bp
from .record_routes import record_bp
from .system_routes import system_bp


def register_blueprints(app):
    for blueprint in (
        system_bp,
        auth_bp,
        admin_bp,
        patient_bp,
        camera_bp,
        record_bp,
        clinical_bp,
        meibography_bp,
        blink_bp,
        frontend_bp,
    ):
        app.register_blueprint(blueprint)
