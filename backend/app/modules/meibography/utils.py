"""Helpers for normalizing meibography request payloads."""


def normalize_analysis_request(payload):
    include_progress_frames = payload.get('include_gland_progression', False)
    if not isinstance(include_progress_frames, bool):
        raise ValueError('include_gland_progression must be true or false.')
    compact_response = payload.get('compact_response', False)
    if not isinstance(compact_response, bool):
        raise ValueError('compact_response must be true or false.')
    lid = str(payload.get('lid') or 'lower').lower()
    eye = str(payload.get('eye') or 'unknown').lower()
    source_lid = payload.get('source_lid')
    if source_lid not in (None, ''):
        source_lid = str(source_lid).lower()
    return {
        'lid': lid,
        'eye': eye,
        'source_lid': source_lid,
        'manual_points': payload.get('manual_eyelid_points', []),
        'manual_closed': bool(payload.get('manual_eyelid_closed', False)),
        'brightness': payload.get('brightness', 50),
        'contrast': payload.get('contrast', 50),
        'include_progress_frames': include_progress_frames,
        'compact_response': compact_response,
    }
