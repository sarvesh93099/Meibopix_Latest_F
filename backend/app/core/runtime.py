"""Process-wide runtime state shared by services."""

BLINK_LIVE_SESSIONS = {}
BLINK_COUNTER_FUNCTIONS = None
MEIBOGRAPHY_SERVICE_HELPERS = None
TMH_ANALYZER = None
STORAGE_BACKEND = None


def get_storage_backend():
    return STORAGE_BACKEND


def set_storage_backend(storage_backend):
    global STORAGE_BACKEND
    STORAGE_BACKEND = storage_backend
