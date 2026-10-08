from argon2 import PasswordHasher


BLINK_ALLOWED_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm'}
BLINK_ALLOWED_MIME_TYPES = {
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm',
}
IMAGE_ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.bmp', '.webp'}
IMAGE_ALLOWED_MIME_TYPES = {
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/bmp',
    'image/webp',
}
REPORT_ALLOWED_EXTENSIONS = {'.pdf'}
REPORT_ALLOWED_MIME_TYPES = {'application/pdf'}
BLINK_MAX_UPLOAD_BYTES = 200 * 1024 * 1024
BLINK_LIVE_SESSION_TTL_SECONDS = 10 * 60
BLINK_LIVE_MIN_CLOSED_FRAMES = 1
BLINK_LIVE_MIN_GAP_SECONDS = 0.06
BLINK_LIVE_SCORE_THRESHOLD = 0.26
BLINK_LIVE_EAR_SCALE = 0.72
BLINK_LIVE_MIN_EYE_MOVEMENT = 0.015
DEFAULT_SESSION_DURATION = 30
AUTH_SESSION_USER_KEY = 'auth_user_id'
AUTH_SESSION_KIND_KEY = 'auth_user_kind'
LOCAL_HOSTS = {'localhost', '127.0.0.1'}
PUBLIC_API_PATHS = {
    '/api/health',
    '/api/auth/config',
    '/api/auth/login',
    '/api/auth/me',
    '/api/auth/logout',
    '/api/signup-request',
    '/api/guest/meibography/status',
    '/api/guest/meibography/warmup',
    '/api/guest/meibography/analyze',
    '/api/guest/meibography/enhance',
    '/api/guest/meibography/tear-meniscus',
}
LOGGED_REQUEST_PATH_PREFIXES = ('/api/', '/uploads/', '/reports/')
DOCTOR_REQUEST_STATUS_PENDING = 'pending'
DOCTOR_REQUEST_STATUS_APPROVED = 'approved'
DOCTOR_REQUEST_STATUS_REJECTED = 'rejected'
PATIENT_ALLOWED_GENDERS = {
    'male': 'Male',
    'female': 'Female',
    'other': 'Other',
}
PATIENT_ALLOWED_AVATAR_STYLES = {
    'ocean',
    'rose',
    'mint',
    'violet',
    'sunset',
}
PATIENT_MOBILE_REQUIRED_DIGITS = 10
PATIENT_NAME_MAX_LENGTH = 100
PATIENT_MOBILE_MAX_LENGTH = 20
PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
