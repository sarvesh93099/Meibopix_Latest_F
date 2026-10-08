"""Clinical questionnaire/summary wrappers."""

from .clinical_tools import score_deq, score_osdi, summarize_contrast, summarize_posterior_segment


def analyze_deq(payload):
    return score_deq(payload)


def analyze_osdi(payload):
    return score_osdi(payload)


def analyze_contrast_sensitivity(payload):
    return summarize_contrast(payload)


def analyze_posterior_segment(payload):
    return summarize_posterior_segment(payload)
