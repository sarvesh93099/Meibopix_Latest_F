"""Bound large image allocations across clinician and guest requests."""

from functools import wraps
import threading

from flask import jsonify


IMAGE_PROCESSING_SLOT = threading.BoundedSemaphore(1)


def limit_image_processing(handler):
    @wraps(handler)
    def bounded_handler(*args, **kwargs):
        if not IMAGE_PROCESSING_SLOT.acquire(blocking=False):
            response = jsonify({'error': 'Image processing is busy. Please try again shortly.'})
            response.headers['Retry-After'] = '5'
            return response, 429
        try:
            return handler(*args, **kwargs)
        finally:
            IMAGE_PROCESSING_SLOT.release()
    return bounded_handler
