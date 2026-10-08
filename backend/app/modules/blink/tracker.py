"""Dependency-free blink state machine shared by live and recorded analysis."""

import math


def _finite_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


class BlinkTracker:
    """A blink requires an observed open -> closed -> open cycle."""

    def __init__(self, min_closed_frames=1, min_gap_seconds=0.20):
        self.min_closed_frames = max(1, int(min_closed_frames))
        self.min_gap_seconds = max(0.20, float(min_gap_seconds))
        self.open_ear = None
        self.ear_threshold = 0.18
        self.closed_at = None
        self.closed_frames = 0
        self.saw_open = False
        self.face_found = False
        self.face_detected_seconds = 0.0
        self.elapsed_seconds = 0.0
        self.processed_frames = 0
        self.blink_timestamps = []

    def update(self, frame, elapsed_seconds):
        elapsed = max(self.elapsed_seconds, _finite_number(elapsed_seconds) or 0.0)
        # Gaps caused by dropped requests/frames are unobserved time.
        delta = min(0.25, max(0.0, elapsed - self.elapsed_seconds))
        if self.face_found:
            self.face_detected_seconds += delta
        self.elapsed_seconds = elapsed
        self.processed_frames += 1
        self.face_found = bool(frame.get('face_found'))
        if not self.face_found:
            self.closed_at = None
            self.closed_frames = 0
            self.saw_open = False
            return

        ear = _finite_number(frame.get('combined_ear'))
        score = _finite_number(frame.get('blink_score'))
        has_ear = ear is not None and ear > 0
        if has_ear and (score is None or score < 0.25) and self.closed_at is None:
            self.open_ear = ear if self.open_ear is None else max(ear, self.open_ear * 0.995)
        self.ear_threshold = max(0.10, min(0.23, (self.open_ear or 0.26) * 0.70))
        closed = (score is not None and score >= 0.45) or (has_ear and ear < self.ear_threshold)
        reopened = (score is None or score < 0.25) and (not has_ear or ear >= self.ear_threshold + 0.02)
        if closed:
            if self.closed_at is None and self.saw_open:
                self.closed_at = elapsed
            if self.closed_at is not None:
                self.closed_frames += 1
        elif reopened:
            last_blink = self.blink_timestamps[-1] if self.blink_timestamps else -math.inf
            if (
                self.closed_at is not None and
                self.closed_frames >= self.min_closed_frames and
                elapsed - self.closed_at <= 1.5 and
                elapsed - last_blink >= self.min_gap_seconds
            ):
                self.blink_timestamps.append(round(elapsed, 2))
            self.closed_at = None
            self.closed_frames = 0
            self.saw_open = True

    def result(self, duration_seconds=None):
        duration = max(0.001, _finite_number(duration_seconds) or self.elapsed_seconds)
        face_seconds = min(duration, self.face_detected_seconds)
        quality = face_seconds >= min(3.0, duration * 0.5) and face_seconds / duration >= 0.5
        total = len(self.blink_timestamps)
        bpm = round(total / duration * 60.0, 1)
        display_duration = round(duration, 1)
        display_face_seconds = round(face_seconds, 1)
        return {
            'total_blinks': total,
            'bpm_overall': bpm if quality else None,
            'bpm_face_only': round(total / max(face_seconds, 0.001) * 60, 1) if quality else None,
            'face_detected_seconds': display_face_seconds,
            'no_face_seconds': round(max(0.0, display_duration - display_face_seconds), 1),
            'analyzed_duration_seconds': display_duration,
            'blink_timestamps': list(self.blink_timestamps),
            'processed_frames': self.processed_frames,
            'quality': quality,
            'interpretation': f'{bpm:.1f} blinks per minute measured' if quality else 'Try again with your face in view and good light.',
            'interpretation_band': 'MEASURED' if quality else 'RETRY',
            'ear_threshold': round(self.ear_threshold, 4),
            'min_closed_frames': self.min_closed_frames,
        }
