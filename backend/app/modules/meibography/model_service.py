# Shared analysis math; runtime selection does not import PyTorch on small hosts.
import os
import threading
import time
import cv2
import numpy as np
from app.utils.env import env_int
from .inference_backends import MODEL_INPUT, create_backend

# Map gland dropout percentages into the clinical grade shown in the UI.
MGD_GRADES = [
    (0, 25, "Grade 0 - Normal", "#4CAF50"),
    (25, 50, "Grade 1 - Mild", "#FFEB3B"),
    (50, 75, "Grade 2 - Moderate", "#FF9800"),
    (75, 101, "Grade 3 - Severe", "#F44336"),
]

HYSTERESIS_CLOSE_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
HYSTERESIS_OPEN_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
EYELID_DILATION_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))

# Resize, normalize, and letterbox the source image into the model's square tensor layout.
def _preprocess_image(image_bgr, target=MODEL_INPUT):
    """Resize and letterbox an image into the square tensor shape expected by the model."""
    height, width = image_bgr.shape[:2]
    scale = float(target) / max(height, width)
    resized_height = int(round(height * scale))
    resized_width = int(round(width * scale))
    resized = cv2.resize(image_bgr, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)

    # Letterbox into a square input so we preserve aspect ratio and can map the
    # output probabilities back onto the original image coordinates later.
    canvas = np.zeros((target, target, 3), dtype=np.uint8)
    pad_top = (target - resized_height) // 2
    pad_left = (target - resized_width) // 2
    canvas[pad_top:pad_top + resized_height, pad_left:pad_left + resized_width] = resized
    array = canvas[:, :, ::-1].astype(np.float32) / 255.0
    array = np.ascontiguousarray(np.transpose(array, (2, 0, 1)))
    return array[np.newaxis, ...], (height, width, pad_left, pad_top, resized_width, resized_height)


# Undo the letterboxing metadata so the probability map lines up with the original image.
def _unmap_prediction(probability_map, meta):
    """Project the square model output back into the original image resolution."""
    height, width, pad_left, pad_top, resized_width, resized_height = meta
    cropped = probability_map[pad_top:pad_top + resized_height, pad_left:pad_left + resized_width]
    if cropped.size == 0:
        return np.zeros((height, width), dtype=np.float32)
    return cv2.resize(cropped, (width, height), interpolation=cv2.INTER_LINEAR)


# Run one forward pass and return a probability map in the original image coordinates.
def _infer_probability(image_bgr, model):
    """Run one segmentation pass and return a probability map in source coordinates."""
    array, meta = _preprocess_image(image_bgr)
    raw = model.predict(array)
    return _unmap_prediction(raw, meta)


# Enhance local contrast so faint glands can survive an extra inference pass.
def _enhance_meibo_input(image_bgr):
    """Lift faint gland contrast before a secondary inference pass."""
    if image_bgr is None or image_bgr.size == 0:
        return image_bgr

    working = image_bgr.copy()
    if len(working.shape) == 2 or working.shape[2] == 1:
        working = cv2.cvtColor(working, cv2.COLOR_GRAY2BGR)

    lab = cv2.cvtColor(working, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.6, tileGridSize=(8, 8))
    l_channel = clahe.apply(l_channel)
    enhanced_lab = cv2.merge((l_channel, a_channel, b_channel))
    enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

    blurred = cv2.GaussianBlur(enhanced_bgr, (0, 0), sigmaX=1.1, sigmaY=1.1)
    sharpened = cv2.addWeighted(enhanced_bgr, 1.30, blurred, -0.30, 0)
    return np.clip(sharpened, 0, 255).astype(np.uint8)


# Use linked strong/weak thresholds so thin gland structures are kept without keeping noise.
def _build_hysteresis_mask(probability_map, eyelid_mask, strong_threshold, weak_threshold):
    """Convert soft probabilities into a cleaner gland mask using linked thresholds."""
    strong_mask = (probability_map > strong_threshold).astype(np.uint8) * 255
    weak_mask = (probability_map > weak_threshold).astype(np.uint8) * 255

    weak_mask[eyelid_mask == 0] = 0
    strong_mask[eyelid_mask == 0] = 0

    # Keep weak responses only when they connect to at least one strong seed.
    # This preserves elongated gland structures while discarding isolated noise.
    component_count, labels = cv2.connectedComponents(weak_mask, connectivity=8)
    # A label lookup visits the image once instead of once per weak component.
    seeded_labels = np.zeros(component_count, dtype=np.uint8)
    seeded_labels[np.unique(labels[strong_mask > 0])] = 255
    seeded_labels[0] = 0
    kept_mask = seeded_labels[labels]

    kept_mask = cv2.morphologyEx(kept_mask, cv2.MORPH_CLOSE, HYSTERESIS_CLOSE_KERNEL, iterations=1)
    kept_mask = cv2.morphologyEx(kept_mask, cv2.MORPH_OPEN, HYSTERESIS_OPEN_KERNEL, iterations=1)
    kept_mask[eyelid_mask == 0] = 0
    return kept_mask


# Summarize a candidate eyelid mask so upper and lower predictions can be compared fairly.
def _summarize_eyelid_candidate(probability_map, threshold=0.5):
    """Score an eyelid candidate so upper and lower predictions can be compared."""
    mask = (probability_map > threshold).astype(np.uint8) * 255
    total_pixels = int(mask.size) if mask.size else 1
    mask_pixels = int((mask > 0).sum())
    area_fraction = float(mask_pixels) / max(total_pixels, 1)
    ys, _ = np.where(mask > 0)
    if mask_pixels > 0:
        y_mean = float(ys.mean() / probability_map.shape[0])
        y_min = float(ys.min() / probability_map.shape[0])
        y_max = float(ys.max() / probability_map.shape[0])
    else:
        y_mean = 0.0
        y_min = 0.0
        y_max = 0.0

    if mask_pixels > 0:
        active_probability = probability_map[mask > 0]
        mean_mask_probability = float(active_probability.mean())
    else:
        mean_mask_probability = 0.0

    percentile_values = np.percentile(probability_map, [99.0, 99.5, 99.9])
    peak_probability = float(np.mean(percentile_values))

    largest_component_pixels = 0
    if mask_pixels > 0:
        component_count, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        if component_count > 1:
            largest_component_pixels = int(stats[1:, cv2.CC_STAT_AREA].max())

    coherence = float(largest_component_pixels) / max(mask_pixels, 1)
    score = (peak_probability * 0.45) + (mean_mask_probability * 0.35) + (coherence * 0.20)

    if area_fraction < 0.005:
        score *= area_fraction / 0.005 if area_fraction > 0 else 0.0
    elif area_fraction > 0.60:
        score *= max(0.10, 1.0 - ((area_fraction - 0.60) / 0.40))

    # Return both the raw mask and the scoring fields so callers can inspect the decision.
    return {
        "probability_map": probability_map,
        "mask": mask,
        "score": float(score),
        "peak_probability": peak_probability,
        "mean_mask_probability": mean_mask_probability,
        "mask_pixels": mask_pixels,
        "area_fraction": area_fraction,
        "coherence": coherence,
        "y_mean": y_mean,
        "y_min": y_min,
        "y_max": y_max,
    }


# Paint the gland mask and eyelid outline into the review image shown in the frontend.
def _build_meibo_frame(image_bgr, eyelid_mask, meibo_mask, probability_map=None):
    """Create the gland overlay image returned to the frontend."""
    result = image_bgr.copy().astype(np.float32)
    gland_mask = (meibo_mask > 0)[:, :, np.newaxis]
    gland_red_bgr = (80.0, 80.0, 255.0)

    if probability_map is not None:
        # Use the soft probability map to brighten stronger gland responses more intensely.
        probability = np.clip(probability_map.astype(np.float32), 0.0, 1.0)
        probability_min = float(probability[eyelid_mask > 0].min()) if (eyelid_mask > 0).any() else 0.0
        probability_max = float(probability.max())
        probability_norm = np.clip((probability - probability_min) / max(probability_max - probability_min, 1e-6), 0.0, 1.0)
        probability_gamma = np.power(probability_norm, 0.6)
        red_boost = (probability_gamma * 255.0)[:, :, np.newaxis]
        red_color = np.zeros_like(result)
        red_color[:, :, 0] = gland_red_bgr[0] * (red_boost[:, :, 0] / 255.0)
        red_color[:, :, 1] = gland_red_bgr[1] * (red_boost[:, :, 0] / 255.0)
        red_color[:, :, 2] = gland_red_bgr[2] * (red_boost[:, :, 0] / 255.0)
        result = np.where(gland_mask, red_color, result)
    else:
        red = np.zeros_like(result)
        red[:, :, 0] = gland_red_bgr[0]
        red[:, :, 1] = gland_red_bgr[1]
        red[:, :, 2] = gland_red_bgr[2]
        result = np.where(gland_mask, red, result)

    result = np.clip(result, 0, 255).astype(np.uint8)
    gland_contours, _ = cv2.findContours(meibo_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(result, gland_contours, -1, (80, 80, 255), 1)
    contours, _ = cv2.findContours(eyelid_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(result, contours, -1, (255, 230, 0), 3)
    return result


# Draw only the eyelid boundary for the simpler overlay shown in the UI.
def _build_eyelid_frame(image_bgr, eyelid_mask):
    """Create a lightweight overlay that only shows the detected eyelid boundary."""
    result = image_bgr.copy()
    contours, _ = cv2.findContours(eyelid_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(result, contours, -1, (255, 230, 0), 3)
    return result


# Build a step-by-step sequence where each accepted gland component is added in order.
def _build_gland_progress_frames(image_bgr, eyelid_mask, labels, component_entries, probability_map):
    """Build progressive overlays so the UI can animate glands appearing one by one."""
    progress_frames = []
    cumulative_mask = np.zeros_like(eyelid_mask, dtype=np.uint8)

    frame_limit = max(1, env_int("MAX_GLAND_PROGRESS_FRAMES", 24))
    frame_steps = set(np.linspace(1, len(component_entries), min(frame_limit, len(component_entries)), dtype=int))
    for step, component in enumerate(component_entries, 1):
        cumulative_mask[labels == component["label"]] = 255
        if step not in frame_steps:
            continue
        progress_frames.append(
            _build_meibo_frame(image_bgr, eyelid_mask, cumulative_mask, probability_map)
        )

    return progress_frames


# Own the lazily loaded upper/lower models and provide the public analysis methods.
class MeibographyModelService:
    """Lazy-load and run the upper/lower eyelid segmentation models."""

    def __init__(self, models_root, *, backend=None):
        self.backend = create_backend(backend)
        # Remember the root folder so each checkpoint path can be derived from it.
        self.models_root = models_root
        self.lower_eyelid_path = os.path.join(models_root, "best_lower_eyelid_effb5.pth")
        self.lower_meibo_path = os.path.join(models_root, "best_lower_meibo_effb5.pth")
        self.upper_eyelid_path = os.path.join(models_root, "best_upper_eyelid_effb5_unet.pth")
        self.upper_meibo_path = os.path.join(models_root, "best_upper_meibo_effb5_unet.pth")
        if self.backend.extension != ".pth":
            for field in ("lower_eyelid_path", "lower_meibo_path", "upper_eyelid_path", "upper_meibo_path"):
                setattr(self, field, os.path.splitext(getattr(self, field))[0] + self.backend.extension)
        # Model slots stay empty until ensure_loaded() is called for the first time.
        self.lower_eyelid_model = None
        self.lower_meibo_model = None
        self.upper_eyelid_model = None
        self.upper_meibo_model = None
        self.lower_encoder = None
        self.upper_encoder = None
        self.loaded = False
        self.error = ""
        self.load_duration_ms = None
        # Separate locks keep one thread loading while another cannot predict concurrently.
        self._load_lock = threading.Lock()
        self._predict_lock = threading.Lock()

    # Load the checkpoints once and cache the model instances for later requests.
    def ensure_loaded(self):
        """Load the model checkpoints once, only when they are first needed."""
        if self.loaded:
            return

        with self._load_lock:
            if self.loaded:
                return

            try:
                load_started_at = time.perf_counter()
                self.lower_eyelid_model, lower_eye_encoder = self.backend.load_model(self.lower_eyelid_path)
                self.lower_meibo_model, lower_meibo_encoder = self.backend.load_model(self.lower_meibo_path)
                self.lower_encoder = lower_eye_encoder or lower_meibo_encoder

                upper_eye_available = os.path.exists(self.upper_eyelid_path)
                upper_meibo_available = os.path.exists(self.upper_meibo_path)
                if upper_eye_available and upper_meibo_available:
                    self.upper_eyelid_model, upper_eye_encoder = self.backend.load_model(self.upper_eyelid_path)
                    self.upper_meibo_model, upper_meibo_encoder = self.backend.load_model(self.upper_meibo_path)
                    self.upper_encoder = upper_eye_encoder or upper_meibo_encoder

                self.loaded = True
                self.load_duration_ms = round((time.perf_counter() - load_started_at) * 1000, 1)
                self.error = ""
            except Exception as error:
                self.loaded = False
                self.error = str(error)
                raise

    # Expose a small readiness payload that the frontend can poll safely.
    def get_status(self):
        """Return a lightweight snapshot of model readiness for the frontend."""
        return {
            "loaded": self.loaded,
            "device": self.backend.device,
            "cpu_threads": self.backend.cpu_threads,
            "inference_backend": self.backend.name,
            **self.backend.get_status(),
            "load_duration_ms": self.load_duration_ms,
            "lower_models_ready": self.lower_eyelid_model is not None and self.lower_meibo_model is not None,
            "upper_models_ready": self.upper_eyelid_model is not None and self.upper_meibo_model is not None,
            "lower_encoder": self.lower_encoder,
            "upper_encoder": self.upper_encoder,
            "error": self.error,
        }

    # Decide whether an image belongs to the upper or lower lid before full analysis.
    def detect_lid_side(self, image_bgr, *, probability_maps=None):
        """Detect the lid and optionally retain probabilities for this request's analysis."""
        self.ensure_loaded()

        with self._predict_lock:
            lower_candidate = _summarize_eyelid_candidate(
                _infer_probability(image_bgr, self.lower_eyelid_model)
            )
            candidates = {
                "lower": lower_candidate,
            }

            if self.upper_eyelid_model is not None and self.upper_meibo_model is not None:
                candidates["upper"] = _summarize_eyelid_candidate(
                    _infer_probability(image_bgr, self.upper_eyelid_model)
                )

            # Keep these arrays in the caller's request, never in shared service state
            # or the JSON detection payload. Analysis can reuse the selected pass.
            if probability_maps is not None:
                probability_maps.update({
                    side: details["probability_map"]
                    for side, details in candidates.items()
                })

            heuristic = "score"
            if "upper" in candidates:
                lower_candidate = candidates["lower"]
                upper_candidate = candidates["upper"]
                lower_centroid_gap = lower_candidate["y_mean"] - upper_candidate["y_mean"]

                # When the lower lid mask is dense and clearly sits below the
                # upper candidate, prefer geometry over raw score alone.
                lower_geometry_match = (
                    lower_candidate["mask_pixels"] > int(image_bgr.shape[0] * image_bgr.shape[1] * 0.015)
                    and lower_candidate["mean_mask_probability"] >= 0.80
                    and lower_candidate["y_mean"] >= 0.60
                    and lower_centroid_gap >= 0.12
                )
                if lower_geometry_match:
                    return {
                        "predicted_lid": "lower",
                        "confident": True,
                        "score_margin": float(lower_candidate["score"] - upper_candidate["score"]),
                        "score_ratio": float(lower_candidate["score"] / max(upper_candidate["score"], 1e-6)),
                        "heuristic": "lower-centroid",
                        "candidates": {
                            side: {
                                "score": round(details["score"], 4),
                                "peak_probability": round(details["peak_probability"], 4),
                                "mean_mask_probability": round(details["mean_mask_probability"], 4),
                                "mask_pixels": int(details["mask_pixels"]),
                                "area_fraction": round(details["area_fraction"], 4),
                                "coherence": round(details["coherence"], 4),
                                "y_mean": round(details["y_mean"], 4),
                                "y_min": round(details["y_min"], 4),
                                "y_max": round(details["y_max"], 4),
                            }
                            for side, details in candidates.items()
                        }
                    }

            sorted_candidates = sorted(
                candidates.items(),
                key=lambda item: item[1]["score"],
                reverse=True
            )
            predicted_lid, predicted_candidate = sorted_candidates[0]
            alternate_lid = None
            alternate_candidate = None
            if len(sorted_candidates) > 1:
                alternate_lid, alternate_candidate = sorted_candidates[1]

            score_margin = predicted_candidate["score"] - (alternate_candidate["score"] if alternate_candidate else 0.0)
            score_ratio = (
                predicted_candidate["score"] / max(alternate_candidate["score"], 1e-6)
                if alternate_candidate
                else float("inf")
            )
            confident = (
                predicted_candidate["mask_pixels"] > int(image_bgr.shape[0] * image_bgr.shape[1] * 0.01)
                and predicted_candidate["peak_probability"] >= 0.60
                and predicted_candidate["mean_mask_probability"] >= 0.52
                and score_margin >= 0.035
                and score_ratio >= 1.08
            )

            # Confidence combines mask size, peak strength, and separation from the runner-up.
            return {
                "predicted_lid": predicted_lid,
                "confident": confident,
                "score_margin": float(score_margin),
                "score_ratio": float(score_ratio),
                "heuristic": heuristic,
                "candidates": {
                    side: {
                        "score": round(details["score"], 4),
                        "peak_probability": round(details["peak_probability"], 4),
                        "mean_mask_probability": round(details["mean_mask_probability"], 4),
                        "mask_pixels": int(details["mask_pixels"]),
                        "area_fraction": round(details["area_fraction"], 4),
                        "coherence": round(details["coherence"], 4),
                        "y_mean": round(details["y_mean"], 4),
                        "y_min": round(details["y_min"], 4),
                        "y_max": round(details["y_max"], 4),
                    }
                    for side, details in candidates.items()
                }
            }

    # Run the complete eyelid and gland analysis pipeline for one uploaded image.
    def analyze(self, image_bgr, lid="lower", manual_eyelid_mask=None, *,
                eyelid_probability=None, include_progress_frames=True):
        """Run the full meibography workflow and return masks, overlays, and metrics."""
        self.ensure_loaded()

        with self._predict_lock:
            # Select upper models only when requested and when they were successfully loaded.
            use_upper = str(lid).lower() == "upper" and self.upper_eyelid_model is not None and self.upper_meibo_model is not None
            eyelid_model = self.upper_eyelid_model if use_upper else self.lower_eyelid_model
            meibo_model = self.upper_meibo_model if use_upper else self.lower_meibo_model
            side_label = "upper" if use_upper else "lower"

            # Warn when the request asked for upper-lid analysis but only lower models are ready.
            if str(lid).lower() == "upper" and not use_upper:
                pass

            # Respect a manually drawn eyelid mask when the user supplied one from the UI.
            eyelid_mask = None
            if manual_eyelid_mask is not None:
                eyelid_mask = manual_eyelid_mask.copy().astype(np.uint8)
            else:
                if eyelid_probability is None:
                    eyelid_probability = _infer_probability(image_bgr, eyelid_model)
                elif eyelid_probability.shape != image_bgr.shape[:2]:
                    raise ValueError("Eyelid probabilities must match the source image dimensions.")
                eyelid_mask = (eyelid_probability > 0.5).astype(np.uint8) * 255

            # Blend three views of the meibography model output:
            # 1) the full image,
            # 2) a padded crop around the detected eyelid, and
            # 3) an eyelid-only ROI with background pixels removed.
            probability_a = _infer_probability(image_bgr, meibo_model)

            height, width = image_bgr.shape[:2]
            ys, xs = np.where(eyelid_mask == 255)
            if len(ys) > 0:
                # Expand around the eyelid so the cropped pass still sees nearby gland context.
                padding = max(120, int(min(height, width) * 0.6))
                y0 = max(0, int(ys.min()) - padding)
                y1 = min(height, int(ys.max()) + padding)
                x0 = max(0, int(xs.min()) - padding)
                x1 = min(width, int(xs.max()) + padding)
                crop = image_bgr[y0:y1, x0:x1]
                if (y0, y1, x0, x1) == (0, height, 0, width):
                    # Generous padding often covers the full image. Its prediction
                    # is already available, with exactly the same preprocessing.
                    probability_b = probability_a
                elif crop.size:
                    probability_crop = _infer_probability(crop, meibo_model)
                    probability_b = np.zeros((height, width), dtype=np.float32)
                    probability_b[y0:y1, x0:x1] = probability_crop
                else:
                    probability_b = probability_a
            else:
                probability_b = probability_a

            roi_image = image_bgr.copy()
            roi_image[eyelid_mask == 0] = 0
            probability_c = _infer_probability(roi_image, meibo_model)

            enhanced_image = _enhance_meibo_input(image_bgr)
            probability_d = _infer_probability(enhanced_image, meibo_model)

            # The enhanced pass helps faint glands survive when the original
            # image is low contrast, but we only let it boost rather than fully
            # replace the base ensemble.
            probability = (0.30 * probability_a) + (0.40 * probability_b) + (0.30 * probability_c)
            probability = np.maximum(probability, (0.55 * probability) + (0.45 * probability_d))
            softness = 0.30 + 0.70 * (eyelid_mask > 0).astype(np.float32)
            probability = probability * softness
            probability = cv2.GaussianBlur(probability, (0, 0), sigmaX=0.9, sigmaY=0.9)

            # Use a very low threshold because the ensemble already suppresses a lot of noise.
            threshold = 0.05
            weak_threshold = max(0.02, threshold * 0.55)

            binary_mask = _build_hysteresis_mask(probability, eyelid_mask, threshold, weak_threshold)
            binary_mask[cv2.dilate(eyelid_mask, EYELID_DILATION_KERNEL, iterations=1) == 0] = 0

            # Connected-component filtering removes tiny specks that survive thresholding.
            component_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary_mask, connectivity=8)
            accepted_labels = (stats[:, cv2.CC_STAT_AREA] >= 4).astype(np.uint8) * 255
            accepted_labels[0] = 0
            clean_mask = accepted_labels[labels]
            gland_sizes = []
            component_entries = []
            for index in range(1, component_count):
                area = stats[index, cv2.CC_STAT_AREA]
                if area >= 4:
                    gland_sizes.append(int(area))
                    component_entries.append({
                        "label": index,
                        "x": float(stats[index, cv2.CC_STAT_LEFT] + (stats[index, cv2.CC_STAT_WIDTH] / 2.0)),
                        "y": float(stats[index, cv2.CC_STAT_TOP] + (stats[index, cv2.CC_STAT_HEIGHT] / 2.0)),
                    })

            component_entries.sort(key=lambda component: (component["x"], component["y"]))

            # Convert raw pixel counts into the coverage/dropout values shown in the report.
            eyelid_area = int((eyelid_mask == 255).sum())
            gland_area = int((clean_mask == 255).sum())
            coverage_pct = round(100.0 * gland_area / max(eyelid_area, 1), 1)
            dropout_pct = round(100.0 * (1.0 - gland_area / max(eyelid_area, 1)), 1)

            # The dropout band is converted into the clinical-style grade shown in the UI.
            grade_label = "N/A"
            grade_color = "#94a3b8"
            for lower, upper, label, color in MGD_GRADES:
                if lower <= dropout_pct < upper:
                    grade_label = label
                    grade_color = color
                    break

            stats_dict = {
                "gland_px": gland_area,
                "gland_count": len(gland_sizes),
                "eyelid_px": eyelid_area,
                "coverage_pct": coverage_pct,
                "dropout_pct": dropout_pct,
                "avg_gland_px": round(np.mean(gland_sizes), 1) if gland_sizes else 0,
                "max_gland_px": max(gland_sizes) if gland_sizes else 0,
                "thresh_used": round(threshold, 3),
                "grade": grade_label,
                "grade_color": grade_color,
                "prob_mean": round(float(probability.mean()), 4),
                "prob_max": round(float(probability.max()), 4),
                "eyelid_side": side_label,
            }

            eyelid_frame = _build_eyelid_frame(image_bgr, eyelid_mask)
            meibo_frame = _build_meibo_frame(image_bgr, eyelid_mask, clean_mask, probability)
            # The review UI shows the final overlay immediately. Generate the
            # expensive per-gland animation only for callers that request it.
            gland_progress_frames = []
            if include_progress_frames and env_int("MAX_GLAND_PROGRESS_FRAMES", 24) > 0:
                gland_progress_frames = _build_gland_progress_frames(
                    image_bgr,
                    eyelid_mask,
                    labels,
                    component_entries,
                    probability,
                )
            summary = (
                f"Coverage {coverage_pct}% | Dropout {dropout_pct}%\n"
                f"{grade_label}\n"
                f"Using {side_label} eyelid models."
            )

            return {
                "summary": summary,
                "stats": stats_dict,
                "eyelid_mask": eyelid_mask,
                "meibo_mask": clean_mask,
                "probability_map": probability,
                "eyelid_frame": eyelid_frame,
                "meibo_frame": meibo_frame,
                "gland_progress_frames": gland_progress_frames,
                "source_frame": image_bgr.copy(),
            }


meibography_model_service = None


# Initialize the singleton once during app startup.
def init_meibography_model_service(models_root, *, backend=None):
    """Create the process-wide meibography service singleton."""
    global meibography_model_service
    meibography_model_service = MeibographyModelService(models_root, backend=backend)


# Return the singleton so route handlers can reuse the same loaded models.
def get_meibography_model_service():
    """Return the shared meibography service singleton."""
    return meibography_model_service
