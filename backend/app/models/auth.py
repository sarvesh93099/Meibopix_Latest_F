from datetime import datetime

from ..extensions import db


class AppUser(db.Model):
    __tablename__ = 'app_user'

    id = db.Column(db.Integer, primary_key=True)
    singleton_key = db.Column(db.String(32), nullable=False, unique=True, default='primary')
    username = db.Column(db.String(80), nullable=False, unique=True)
    password_hash = db.Column(db.String(512), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='doctor')
    login_count = db.Column(db.Integer, nullable=False, default=0)
    session_version = db.Column(db.Integer, nullable=False, default=0)
    current_refresh_jti = db.Column(db.String(64), nullable=True)
    failed_login_attempts = db.Column(db.Integer, nullable=False, default=0)
    locked_until = db.Column(db.DateTime, nullable=True)
    last_login_at = db.Column(db.DateTime, nullable=True)
    last_login_ip = db.Column(db.String(64), nullable=True)
    is_totp_enabled = db.Column(db.Boolean, nullable=False, default=False)
    totp_secret = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_safe_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role or 'doctor',
            'login_count': int(self.login_count or 0),
            'session_version': self.session_version,
            'failed_login_attempts': self.failed_login_attempts,
            'locked_until': self.locked_until.isoformat() if self.locked_until else None,
            'last_login_at': self.last_login_at.isoformat() if self.last_login_at else None,
            'is_totp_enabled': bool(self.is_totp_enabled),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Doctor(db.Model):
    __tablename__ = 'doctors'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False, unique=True)
    password_hash = db.Column(db.String(512), nullable=False)
    email = db.Column(db.String(255), nullable=False, unique=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    login_count = db.Column(db.Integer, nullable=False, default=0)
    last_login_at = db.Column(db.DateTime, nullable=True)
    last_login_ip = db.Column(db.String(64), nullable=True)
    approved_at = db.Column(db.DateTime, nullable=True)
    legacy_app_user_id = db.Column(db.Integer, nullable=True, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def role(self):
        return 'doctor'

    def to_safe_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'role': self.role,
            'is_active': bool(self.is_active),
            'login_count': int(self.login_count or 0),
            'last_login_at': self.last_login_at.isoformat() if self.last_login_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class DoctorRequest(db.Model):
    __tablename__ = 'doctor_requests'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending')
    doctor_id = db.Column(db.Integer, db.ForeignKey('doctors.id'), nullable=True)
    approved_username = db.Column(db.String(80), nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    doctor = db.relationship('Doctor', backref=db.backref('signup_requests', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'status': self.status,
            'doctor_id': self.doctor_id,
            'approved_username': self.approved_username,
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
