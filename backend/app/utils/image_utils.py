"""Image processing and request-image decoding helpers."""

import base64
import os
from io import BytesIO
from urllib.parse import unquote_to_bytes, urlparse

import cv2
import numpy as np
from flask import current_app, has_app_context

from ..services.storage_service import read_storage_bytes

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None
    ImageOps = None


def apply_brightness_contrast(image_bgr, brightness_value=50, contrast_value=50):
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
    return cv2.convertScaleAbs(image_bgr, alpha=alpha, beta=beta)


def auto_enhance_image(image_bgr):
    if image_bgr is None or image_bgr.size == 0:
        raise ValueError('A valid image is required for enhancement.')
    # Preserve image geometry for measurement tools. Contrast and sharpening run
    # on a bounded luminance plane instead of upscaling and iterative deconvolution.
    source_bgr = (
        cv2.cvtColor(image_bgr, cv2.COLOR_GRAY2BGR)
        if image_bgr.ndim == 2 or image_bgr.shape[2] == 1
        else image_bgr
    )
    height, width = source_bgr.shape[:2]
    limit = current_app.config.get('IMAGE_PROCESSING_MAX_DIMENSION', 1600) if has_app_context() else 1600
    gray = cv2.cvtColor(source_bgr, cv2.COLOR_BGR2GRAY)
    working_gray = gray
    if max(height, width) > limit:
        scale = limit / max(height, width)
        working_gray = cv2.resize(gray, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
    local_contrast = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(working_gray)
    softened = cv2.GaussianBlur(local_contrast, (0, 0), sigmaX=1.0)
    sharpened = cv2.addWeighted(local_contrast, 1.25, softened, -0.25, 0)
    # A modest blend improves visibility without replacing the underlying capture.
    improved = cv2.addWeighted(working_gray, 0.35, sharpened, 0.65, 0)
    delta = improved.astype(np.int16) - working_gray.astype(np.int16)
    if working_gray.shape != gray.shape:
        delta = cv2.resize(delta, (width, height), interpolation=cv2.INTER_LINEAR)
    return np.clip(source_bgr.astype(np.int16) + delta[:, :, np.newaxis], 0, 255).astype(np.uint8)


def build_manual_eyelid_mask(image_bgr, manual_points, manual_closed):
    if image_bgr is None or not manual_closed:
        return None
    if not isinstance(manual_points, list) or len(manual_points) < 3:
        return None

    height, width = image_bgr.shape[:2]
    if height <= 0 or width <= 0:
        return None

    polygon_points = []
    for point in manual_points:
        if not isinstance(point, dict):
            continue
        try:
            x_norm = float(point.get('x'))
            y_norm = float(point.get('y'))
        except (TypeError, ValueError):
            continue

        x_norm = max(0.0, min(1.0, x_norm))
        y_norm = max(0.0, min(1.0, y_norm))
        x_px = int(round(x_norm * (width - 1)))
        y_px = int(round(y_norm * (height - 1)))
        polygon_points.append([x_px, y_px])

    if len(polygon_points) < 3:
        return None

    polygon_array = np.array(polygon_points, dtype=np.int32)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [polygon_array], 255)
    return mask


def parse_normalized_overlay_point(point, width, height):
    if not isinstance(point, dict):
        raise ValueError('Each point must be an object with x and y values.')

    try:
        x_norm = float(point.get('x'))
        y_norm = float(point.get('y'))
    except (TypeError, ValueError) as error:
        raise ValueError('Point coordinates must be numeric.') from error

    x_norm = max(0.0, min(1.0, x_norm))
    y_norm = max(0.0, min(1.0, y_norm))
    x_px = int(round(x_norm * max(width - 1, 0)))
    y_px = int(round(y_norm * max(height - 1, 0)))

    return {
        'x': x_norm,
        'y': y_norm,
        'x_px': x_px,
        'y_px': y_px,
    }


def draw_tmh_marker(image_bgr, x_px, y_px, label_text, color_bgr):
    radius = max(1, image_bgr.shape[1] // 380)
    outline_radius = radius + 1
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.24, min(0.42, image_bgr.shape[1] / 2500.0))
    font_thickness = max(1, image_bgr.shape[1] // 1100)
    label_x = min(image_bgr.shape[1] - 12, x_px + outline_radius + 2)
    label_y = max(12, min(image_bgr.shape[0] - 6, y_px + 2))

    cv2.circle(image_bgr, (x_px, y_px), outline_radius, (255, 255, 255), -1, cv2.LINE_AA)
    cv2.circle(image_bgr, (x_px, y_px), radius, color_bgr, -1, cv2.LINE_AA)
    cv2.putText(
        image_bgr,
        label_text,
        (label_x + 1, label_y + 1),
        font,
        font_scale,
        (0, 0, 0),
        font_thickness + 1,
        cv2.LINE_AA,
    )
    cv2.putText(
        image_bgr,
        label_text,
        (label_x, label_y),
        font,
        font_scale,
        color_bgr,
        font_thickness,
        cv2.LINE_AA,
    )


def annotate_tmh_measurement(image_bgr, top_point, bottom_point, label_text):
    annotated = image_bgr.copy()
    top_color_bgr = (0, 140, 255)
    bottom_color_bgr = (80, 255, 120)
    shadow_bgr = (0, 0, 0)

    x1_px, y1_px = top_point['x_px'], top_point['y_px']
    x2_px, y2_px = bottom_point['x_px'], bottom_point['y_px']
    mid_x = int(round((x1_px + x2_px) / 2))
    mid_y = int(round((y1_px + y2_px) / 2))

    cv2.line(annotated, (x1_px, y1_px), (x2_px, y2_px), (0, 0, 0), 2, cv2.LINE_AA)
    cv2.line(annotated, (x1_px, y1_px), (x2_px, y2_px), (255, 255, 255), 1, cv2.LINE_AA)
    draw_tmh_marker(annotated, x1_px, y1_px, 'D', top_color_bgr)
    draw_tmh_marker(annotated, x2_px, y2_px, 'C', bottom_color_bgr)

    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.55, min(0.9, image_bgr.shape[1] / 1400.0))
    thickness = 1
    text = f'Pixel Distance: {label_text}'
    (text_width, text_height), _ = cv2.getTextSize(text, font, font_scale, thickness)

    label_x = min(image_bgr.shape[1] - text_width - 12, max(8, mid_x + 14))
    label_y = min(image_bgr.shape[0] - 8, max(text_height + 12, mid_y + text_height // 2))
    cv2.rectangle(
        annotated,
        (label_x - 5, label_y - text_height - 5),
        (label_x + text_width + 5, label_y + 5),
        shadow_bgr,
        -1,
    )
    cv2.putText(annotated, text, (label_x, label_y), font, font_scale, bottom_color_bgr, thickness, cv2.LINE_AA)
    return annotated


def encode_image_to_data_url(image_bgr, mime_type='image/png'):
    extension = '.png' if mime_type == 'image/png' else '.jpg'
    encoded_ok, encoded = cv2.imencode(extension, image_bgr)
    if not encoded_ok:
        raise RuntimeError('Failed to encode output image.')
    payload = base64.b64encode(encoded.tobytes()).decode('ascii')
    return f'data:{mime_type};base64,{payload}'


def decode_request_image(payload, upload_folder=None, *, max_bytes=None, max_pixels=None):
    if not isinstance(payload, dict):
        raise ValueError('JSON body must be an object.')
    if max_bytes is None:
        max_bytes = current_app.config.get('MAX_IMAGE_UPLOAD_BYTES', 15 * 1024 * 1024) if has_app_context() else 15 * 1024 * 1024
    if max_pixels is None:
        max_pixels = current_app.config.get('MAX_IMAGE_PIXELS', 12000000) if has_app_context() else 12000000

    def _decode_bytes_with_orientation(image_bytes):
        if len(image_bytes) > max_bytes:
            raise ValueError('Image file is too large. Choose a smaller image.')
        if Image is not None and ImageOps is not None:
            try:
                with Image.open(BytesIO(image_bytes)) as pil_image:
                    if pil_image.width * pil_image.height > max_pixels:
                        raise ValueError('Image resolution is too large. Choose a smaller image.')
                    pil_image = ImageOps.exif_transpose(pil_image)
                    pil_rgb = pil_image.convert('RGB')
                    rgb_array = np.array(pil_rgb)
                    return cv2.cvtColor(rgb_array, cv2.COLOR_RGB2BGR)
            except (ValueError, Image.DecompressionBombError):
                raise ValueError('Image resolution or image data exceeds the supported limits.') from None
            except (OSError, SyntaxError):
                pass

        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        image_bgr = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image_bgr is None:
            raise ValueError('Unable to decode image bytes.')
        if image_bgr.shape[0] * image_bgr.shape[1] > max_pixels:
            raise ValueError('Image resolution is too large. Choose a smaller image.')
        return image_bgr

    image_data = payload.get('image_data')
    if image_data and isinstance(image_data, str):
        header_part, data_part = image_data.split(',', 1) if ',' in image_data else ('', image_data)
        data_part = ''.join(data_part.strip().split())
        if not data_part:
            raise ValueError('Empty image_data payload.')
        if len(data_part) > ((max_bytes + 2) // 3) * 4:
            raise ValueError('Image file is too large. Choose a smaller image.')

        try:
            if ';base64' in header_part:
                padding = (-len(data_part)) % 4
                image_bytes = base64.b64decode(f'{data_part}{"=" * padding}', validate=False)
            else:
                image_bytes = unquote_to_bytes(data_part)
        except Exception as decode_error:
            raise ValueError(f'Unable to decode image_data payload: {decode_error}') from decode_error

        image_bgr = _decode_bytes_with_orientation(image_bytes)
        if image_bgr is None:
            raise ValueError('Unable to decode image_data payload.')
        return image_bgr, 'base64'

    image_url = payload.get('image_url')
    if image_url and isinstance(image_url, str):
        parsed_url = urlparse(image_url)
        filename = os.path.basename(parsed_url.path)
        if not filename:
            raise ValueError('image_url file was not found on server.')
        image_bytes = read_storage_bytes('upload', filename)
        image_bgr = _decode_bytes_with_orientation(image_bytes)
        if image_bgr is None:
            raise ValueError('Unable to read image from image_url.')
        return image_bgr, filename

    raise ValueError('Provide `image_data` (base64) or `image_url` in request body.')
