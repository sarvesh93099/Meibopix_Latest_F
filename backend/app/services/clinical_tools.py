# Centralize questionnaire prompts and clinical scoring helpers shared by the API layer.
import math


DEQ_QUESTIONS = [
    "During a typical day in the past month, how often did your eyes feel discomfort?",
    "When your eyes feel discomfort, how intense was this feeling of discomfort at the end of the day, within two hours of going to bed?",
    "During a typical day in the past month, how often did your eyes feel dry?",
    "When your eyes felt dry, how intense was this feeling of dryness at the end of the day, within two hours of going to bed?",
    "During a typical day in the past month, how often did your eyes look or feel excessively watery?"
]

DEQ_RESPONSE_LABELS = {
    0: "None / Never",
    1: "Rarely / Slight",
    2: "Sometimes / Moderate",
    3: "Frequently / Marked",
    4: "Constantly / Severe"
}

OSDI_QUESTIONS = [
    "Eyes that are sensitive to light?",
    "Eyes that feel gritty?",
    "Painful or sore eyes?",
    "Blurred vision?",
    "Poor vision?",
    "Reading?",
    "Driving at night?",
    "Working with a computer or bank machine (ATM)?",
    "Watching TV?",
    "Windy conditions?",
    "Places or areas with low humidity (very dry)?",
    "Areas that are air conditioned?"
]

OSDI_RESPONSE_LABELS = {
    0: "None of the time",
    1: "Some of the time",
    2: "Half of the time",
    3: "Most of the time",
    4: "All of the time",
    None: "NA"
}

CONTRAST_ROW_LABELS = {
    'od_pre': 'OD PRE-OP',
    'od_post': 'OD POST-OP',
    'os_pre': 'OS PRE-OP',
    'os_post': 'OS POST-OP'
}

CONTRAST_COLUMN_LABELS = ['A', 'B', 'C', 'D']
CONTRAST_SPATIAL_FREQUENCIES = [3, 6, 12, 18]


def _strip_text(value, fallback=''):
    if value is None:
        return fallback
    text = str(value).strip()
    return text or fallback


def _parse_score(value, *, allow_na=False):
    if allow_na and value is not None:
        if isinstance(value, str) and value.strip().upper() == 'NA':
            return None

    if value is None:
        raise ValueError('A response is missing.')

    try:
        score = int(value)
    except (TypeError, ValueError):
        raise ValueError('Responses must be whole numbers between 0 and 4.')

    if score < 0 or score > 4:
        raise ValueError('Responses must be between 0 and 4.')

    return score


def _parse_optional_float(value):
    if value in (None, ''):
        return None

    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise ValueError('Contrast values must be numeric.')

    if not math.isfinite(parsed) or parsed < 0:
        raise ValueError('Contrast values must be zero or greater.')

    return round(parsed, 3)


def score_deq(payload):
    responses = payload.get('responses', [])
    if not isinstance(responses, list) or len(responses) != len(DEQ_QUESTIONS):
        raise ValueError('DEQ requires exactly 5 responses.')

    parsed_responses = [_parse_score(value) for value in responses]
    total_score = sum(parsed_responses)
    average_score = round(total_score / len(parsed_responses), 1)

    if total_score <= 5:
        interpretation = 'Normal'
    elif total_score <= 11:
        interpretation = 'Mild Dry Eye'
    elif total_score <= 16:
        interpretation = 'Moderate Dry Eye'
    else:
        interpretation = 'Severe Dry Eye'

    return {
        'question_count': len(parsed_responses),
        'total_score': total_score,
        'average_score': average_score,
        'interpretation': interpretation,
        'suggests_dry_eye': total_score >= 6,
        'questions': [
            {
                'index': index + 1,
                'prompt': prompt,
                'score': score,
                'label': DEQ_RESPONSE_LABELS.get(score, str(score))
            }
            for index, (prompt, score) in enumerate(zip(DEQ_QUESTIONS, parsed_responses))
        ]
    }


def score_osdi(payload):
    responses = payload.get('responses', [])
    if not isinstance(responses, list) or len(responses) != len(OSDI_QUESTIONS):
        raise ValueError('OSDI requires exactly 12 responses.')

    parsed_responses = []
    for index, value in enumerate(responses):
        parsed_responses.append(_parse_score(value, allow_na=index >= 5))

    subtotal_a = sum(score for score in parsed_responses[:5] if score is not None)
    subtotal_b = sum(score for score in parsed_responses[5:9] if score is not None)
    subtotal_c = sum(score for score in parsed_responses[9:] if score is not None)
    score_d = subtotal_a + subtotal_b + subtotal_c
    score_e = sum(1 for score in parsed_responses if score is not None)
    osdi_score = round((score_d * 25) / score_e, 1) if score_e else 0.0

    if osdi_score <= 12:
        interpretation = 'Normal'
    elif osdi_score <= 22:
        interpretation = 'Mild Dry Eye'
    elif osdi_score <= 32:
        interpretation = 'Moderate Dry Eye'
    else:
        interpretation = 'Severe Dry Eye'

    return {
        'duration': _strip_text(payload.get('duration'), '—'),
        'comments': _strip_text(payload.get('comments'), '—'),
        'subtotal_a': subtotal_a,
        'subtotal_b': subtotal_b,
        'subtotal_c': subtotal_c,
        'score_d': score_d,
        'score_e': score_e,
        'osdi_score': osdi_score,
        'interpretation': interpretation,
        'questions': [
            {
                'index': index + 1,
                'prompt': prompt,
                'score': score,
                'label': OSDI_RESPONSE_LABELS.get(score, str(score))
            }
            for index, (prompt, score) in enumerate(zip(OSDI_QUESTIONS, parsed_responses))
        ]
    }


def calc_aulcsf(values):
    if any(value is None for value in values):
        return None

    log_sf = [math.log10(value) for value in CONTRAST_SPATIAL_FREQUENCIES]
    log_values = [math.log10(max(value, 0.01)) for value in values]
    area = 0.0
    for index in range(len(log_sf) - 1):
        area += (log_sf[index + 1] - log_sf[index]) * (log_values[index] + log_values[index + 1]) / 2
    return round(area, 3)


def summarize_contrast(payload):
    rows = payload.get('rows', {})
    if not isinstance(rows, dict):
        raise ValueError('Contrast rows must be an object.')

    normalized_rows = {}
    for row_key, row_label in CONTRAST_ROW_LABELS.items():
        row_values = rows.get(row_key, {})
        if not isinstance(row_values, dict):
            row_values = {}

        parsed_values = {
            column_label: _parse_optional_float(row_values.get(column_label))
            for column_label in CONTRAST_COLUMN_LABELS
        }
        numeric_values = [parsed_values[column_label] for column_label in CONTRAST_COLUMN_LABELS]
        normalized_rows[row_key] = {
            'label': row_label,
            'values': parsed_values,
            'aulcsf': calc_aulcsf(numeric_values)
        }

    od_pre = normalized_rows['od_pre']['aulcsf']
    od_post = normalized_rows['od_post']['aulcsf']
    os_pre = normalized_rows['os_pre']['aulcsf']
    os_post = normalized_rows['os_post']['aulcsf']

    return {
        'test_name': _strip_text(payload.get('test_name') or payload.get('testName'), 'Glaucoma'),
        'rows': normalized_rows,
        'comparisons': {
            'od_delta_aulcsf': round(od_post - od_pre, 3) if od_pre is not None and od_post is not None else None,
            'os_delta_aulcsf': round(os_post - os_pre, 3) if os_pre is not None and os_post is not None else None
        },
        'spatial_frequencies': CONTRAST_SPATIAL_FREQUENCIES,
        'columns': CONTRAST_COLUMN_LABELS
    }


def summarize_posterior_segment(payload):
    result = {}
    for eye_key in ('left', 'right'):
        eye_payload = payload.get(eye_key, {})
        if not isinstance(eye_payload, dict):
            eye_payload = {}

        impression = _strip_text(eye_payload.get('impression') or eye_payload.get('diagnosis'), 'Normal')
        report = _strip_text(eye_payload.get('report') or eye_payload.get('findings'))
        recommendation = _strip_text(eye_payload.get('recommendation'))

        summary_parts = [impression]
        if report:
            summary_parts.append(report)
        if recommendation:
            summary_parts.append(recommendation)

        result[eye_key] = {
            'impression': impression,
            'report': report,
            'recommendation': recommendation,
            'summary': ' · '.join(summary_parts)
        }

    return result
