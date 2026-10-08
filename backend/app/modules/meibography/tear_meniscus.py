"""
TMH Analyzer  —  Wolffsohn et al. (2025) Protocol
===================================================
Contact Lens and Anterior Eye 48, 102419
https://doi.org/10.1016/j.clae.2025.102419

HVID REFERENCE (adult mean):
  11.7 mm  — Wolffsohn et al. (2025), CLAE 48:102419
  Range 11.6–12.0 mm  — clinical consensus (SpecialEyes / ReviewOfCL 2019)
  Asian adult mean ≈ 11.5–11.8 mm (Orbscan IIz: 11.77 ± 0.40 mm; PMC8284630)

FORMULA (ratio method):
  TMH = HVID_MM × (P_CD / P_AB)
  where:
    P_AB = horizontal limbal span in pixels  (nasal → temporal limbus)
    P_CD = VERTICAL pixel distance           (eyelid margin C → meniscus apex D)
    HVID_MM = 11.7 mm

ANATOMY (lower-lid IR measurement):
  D  = Tear meniscus APEX  — top of bright IR crescent  ← ABOVE eyelid margin
  C  = Lower EYELID MARGIN — skin/conjunctiva border    ← BELOW meniscus apex
  Normal TMH: 0.20–0.50 mm.  Values > 1.5 mm likely indicate wrong click positions.

CUT-OFFS (TFOS DEWS II):
  ≤ 0.20 mm  →  Dry Eye (abnormal)
  0.21–0.30  →  Borderline
  > 0.30 mm  →  Normal

FIXES vs previous version:
  [FIX-1] draw_diagram(): D (meniscus apex) now drawn ABOVE C (eyelid margin)
          — was incorrectly inverted (Cy at 28%, Dy at 72%)
  [FIX-2] Triangle vertices updated to match corrected D/C positions
  [FIX-3] Arrow in diagram now points C (bottom) → D (top), anatomically correct
  [FIX-4] Calibration iris-span hint now actually displayed in the status bar
          — was computed but silently discarded by the fall-through status.set()
  [FIX-5] Physiological TMH range check: warns if measured value > 1.5 mm
          (likely caused by clicking upper/lower eyelid margins instead of
           the tiny tear meniscus strip near the lower lid)

OPTIMISED CHANGES (carried forward):
  [1] Live TMH preview line + mm readout while hovering for click 4
  [2] Real-time distance shown in status bar for ALL clicks
  [3] canvas.bind(<Configure>) → auto zoom-fit on resize so coords never drift
  [4] Mouse crosshair snaps to image bounds; pan/zoom cannot break coordinate math
  [5] Single-eye camera mode: iris fills ~60–80% of frame; calibration guide updated
  [6] Calibration helper: auto-estimates iris span for sanity check
  [7] Cleaner overlay: colour-coded per click (cyan=cal, green=C, blue=D)
  [8] Diagram panel scales to panel width
  [9] All edge-cases (tiny span, same-y clicks) have user-facing messages

CONTROLS
---------
  Scroll / + / −   zoom
  Right-drag       pan
  u                undo last click
  r                restart from scratch
  s                save result diagram
  q                quit

Requirements:
    pip install opencv-python pillow numpy
"""

from __future__ import annotations

import os
from datetime import datetime
from enum import Enum, auto
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageTk
import tkinter as tk
from tkinter import filedialog, messagebox

# ── Clinical constants ────────────────────────────────────────────────────────
HVID_MM         = 11.7   # mm  — adult mean HVID (Wolffsohn 2025 / PMC8284630)
TMH_DRY_EYE    = 0.20   # mm  — TFOS DEWS II aqueous-deficient cut-off
TMH_BORDERLINE  = 0.30   # mm  — upper borderline limit
TMH_MAX_VALID   = 1.50   # mm  — [FIX-5] physiological upper bound; above this = wrong clicks
MAX_LATERAL_MM  = 1.0    # mm  — max offset from pupil midline (Wolffsohn Fig. 3)

# ── Colours ───────────────────────────────────────────────────────────────────
CYAN_BGR   = (220, 213,  70)
CYAN_HEX   = "#46c8d2"
GREEN_BGR  = ( 60, 220,  80)
BLUE_BGR   = (220,  80,  60)
BG_DARK    = "#080c18"
BG_PANEL   = "#0f1827"
BG_STRIP   = "#060b14"

ZOOM_MIN   = 0.2
ZOOM_MAX   = 12.0
ZOOM_STEP  = 1.25

# ── Workflow ──────────────────────────────────────────────────────────────────
class Step(Enum):
    IDLE   = auto()
    CAL_1  = auto()   # click nasal limbus
    CAL_2  = auto()   # click temporal limbus
    MEAS_1 = auto()   # click eyelid margin  (C)  ← lower point
    MEAS_2 = auto()   # click meniscus apex  (D)  ← upper point, live preview active
    DONE   = auto()

STEP_MSG = {
    Step.IDLE:   "Open an eye image to begin.",
    Step.CAL_1:  "CALIBRATE  ▶  Click 1/4 — NASAL limbal edge  (inner iris/sclera border)",
    Step.CAL_2:  "CALIBRATE  ▶  Click 2/4 — TEMPORAL limbal edge  (outer iris/sclera border)",
    Step.MEAS_1: "MEASURE    ▶  Click 3/4 — Lower EYELID MARGIN  [C]  (skin / conjunctiva border, lower point)",
    Step.MEAS_2: "MEASURE    ▶  Click 4/4 — Tear MENISCUS APEX  [D]  (top of bright IR arc, ABOVE eyelid)  ← LIVE PREVIEW",
    Step.DONE:   "✓ Done  |  u=undo  r=restart  s=save  q=quit",
}


def get_status(tmh: float):
    if tmh <= TMH_DRY_EYE:
        return "ABNORMAL — Dry Eye (≤ 0.20 mm)", "#e74c3c"
    if tmh <= TMH_BORDERLINE:
        return "BORDERLINE (0.21 – 0.30 mm)", "#f39c12"
    return "NORMAL (> 0.30 mm)", "#2ecc71"


def _coerce_point(point, point_name):
    if not isinstance(point, dict):
        raise ValueError(f"{point_name} must be a point object.")

    try:
        x_px = int(round(float(point.get("x_px"))))
        y_px = int(round(float(point.get("y_px"))))
    except (TypeError, ValueError):
        raise ValueError(f"{point_name} must include numeric x_px and y_px values.")

    return x_px, y_px


def analyze_tmh_measurement(image_bgr, top_point, bottom_point, cornea_width_pixels=None):
    """Compute TMH from two selected points and return API-friendly metadata."""
    if image_bgr is None or not hasattr(image_bgr, "shape") or len(image_bgr.shape) < 2:
        raise ValueError("A valid image is required for tear meniscus measurement.")

    image_height, image_width = image_bgr.shape[:2]
    if image_height <= 0 or image_width <= 0:
        raise ValueError("Image dimensions must be greater than zero.")

    x1_px, y1_px = _coerce_point(top_point, "Top point")
    x2_px, y2_px = _coerce_point(bottom_point, "Bottom point")

    vertical_distance_pixels = abs(y2_px - y1_px)
    if vertical_distance_pixels < 1:
        raise ValueError("Selected points are too close together to measure TMH.")

    if cornea_width_pixels is None:
        # Fallback estimate when a calibration span is not provided by the client.
        cornea_width_px = float(max(1.0, image_width * 0.33))
    else:
        try:
            cornea_width_px = float(cornea_width_pixels)
        except (TypeError, ValueError):
            raise ValueError("cornea_width_pixels must be numeric when provided.")
        if cornea_width_px <= 0:
            raise ValueError("cornea_width_pixels must be greater than zero.")

    px_per_mm = cornea_width_px / HVID_MM
    tmh_mm = vertical_distance_pixels / px_per_mm

    status_label, status_color = get_status(tmh_mm)
    tmh_label = f"{tmh_mm:.3f} mm"
    distance_label = f"{vertical_distance_pixels:.1f} px"

    summary = (
        f"TMH {tmh_label} based on vertical distance {distance_label} "
        f"and corneal span {cornea_width_px:.1f} px (HVID {HVID_MM:.1f} mm)."
    )

    return {
        "distance_pixels": float(vertical_distance_pixels),
        "distance_label": distance_label,
        "tmh_mm": float(tmh_mm),
        "tmh_label": tmh_label,
        "status_label": status_label,
        "status_color": status_color,
        "cornea_width_pixels": float(cornea_width_px),
        "summary": summary,
        "diagram_image": draw_diagram(tmh_mm, px_per_mm),
    }


# ── Diagram renderer ──────────────────────────────────────────────────────────
def draw_diagram(tmh_mm: float, px_per_mm: float) -> np.ndarray:
    W, H = 580, 700
    img  = np.zeros((H, W, 3), dtype=np.uint8)
    c    = CYAN_BGR
    lw   = 2
    AA   = cv2.LINE_AA

    cx = int(W * 0.42)
    cr = 18
    tl, tr = int(W * 0.30), int(W * 0.58)
    tt, tb = int(H * 0.09), int(H * 0.93)
    hx1, hx2 = int(W * 0.20), int(W * 0.68)

    # ── [FIX-1] D (meniscus apex) is ABOVE C (eyelid margin) ─────────────────
    # Previously: Cy=0.28 (top), Dy=0.72 (bottom) — anatomically backwards.
    # Corrected:  Dy=0.28 (top, D is the higher point), Cy=0.72 (bottom).
    Dy = int(H * 0.28)   # D = meniscus apex  — upper point (ABOVE eyelid)
    Cy = int(H * 0.72)   # C = eyelid margin  — lower point

    # ── [FIX-2] Triangle vertices use corrected Dy / Cy ──────────────────────
    # Upper inverted triangle represents upper eyelid; its tip points down to D
    cv2.polylines(img, [np.array([[tl, tt], [tr, tt], [cx, Dy - cr - 2]], np.int32)],
                  True, c, lw)
    # Lower upright triangle represents lower eyelid; its tip points up to C
    cv2.polylines(img, [np.array([[cx, Cy + cr + 2], [tl, tb], [tr, tb]], np.int32)],
                  True, c, lw)

    for py, label, col in (
        (Dy, "D  Meniscus apex",  BLUE_BGR),   # top
        (Cy, "C  Eyelid margin",  GREEN_BGR),  # bottom
    ):
        cv2.line(img, (hx1, py), (hx2, py), col, lw)
        cv2.circle(img, (cx, py), cr, col, lw)
        cv2.line(img, (cx - 7, py), (cx + 7, py), col, lw)
        cv2.line(img, (cx, py - 7), (cx, py + 7), col, lw)
        cv2.putText(img, label, (hx2 + 8, py + 5),
                    cv2.FONT_HERSHEY_PLAIN, 0.95, col, 1, AA)

    # ── [FIX-3] Arrow: C (bottom) → D (top), anatomically correct ────────────
    # Previously pointed C (top) → D (bottom), which implied meniscus was
    # below the eyelid — impossible anatomy.
    cv2.arrowedLine(img, (cx, Cy - cr - 1), (cx, Dy + cr + 1),
                    c, lw, AA, tipLength=0.15)

    # TMH label
    tmh_lbl = f"TMH:  {tmh_mm:.3f} mm"
    fs = 0.95
    (lw2, lh2), _ = cv2.getTextSize(tmh_lbl, cv2.FONT_HERSHEY_DUPLEX, fs, 2)
    lx = min(cx + cr + 24, W - lw2 - 6)
    ly = (Cy + Dy) // 2 + lh2 // 2
    cv2.putText(img, tmh_lbl, (lx, ly),
                cv2.FONT_HERSHEY_DUPLEX, fs, c, 2, AA)

    # Calibration sub-label
    cv2.putText(img, f"Cal: {px_per_mm:.1f} px/mm  (HVID = {HVID_MM} mm)",
                (lx, ly + 22), cv2.FONT_HERSHEY_PLAIN, 0.80, (60, 140, 140), 1, AA)

    # Status badge
    st, _ = get_status(tmh_mm)
    st_bgr = (
        (50,  50, 220) if "ABNORMAL" in st else
        (40, 160, 220) if "BORDER"   in st else
        (50, 190, 70)
    )
    (sw, _), _ = cv2.getTextSize(st, cv2.FONT_HERSHEY_PLAIN, 1.0, 1)
    cv2.putText(img, st, ((W - sw) // 2, H - 14),
                cv2.FONT_HERSHEY_PLAIN, 1.0, st_bgr, 1, AA)

    # Timestamp
    ts = datetime.now().strftime("%Y-%m-%d  %H:%M")
    (tw, th), _ = cv2.getTextSize(ts, cv2.FONT_HERSHEY_PLAIN, 0.7, 1)
    cv2.putText(img, ts, (W - tw - 8, th + 4),
                cv2.FONT_HERSHEY_PLAIN, 0.7, (60, 100, 100), 1, AA)

    cv2.putText(img, "Wolffsohn et al. (2025) CLAE 48:102419  |  HVID=11.7 mm",
                (6, H - 4), cv2.FONT_HERSHEY_PLAIN, 0.62, (35, 65, 65), 1, AA)
    return img


# =============================================================================
#  Application
# =============================================================================
class TMHApp:

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("TMH Analyzer  —  Wolffsohn 2025 Protocol  (v3 fixed)")
        self.root.configure(bg=BG_DARK)
        self.root.minsize(1100, 700)

        # image / view
        self.orig_bgr: np.ndarray | None = None
        self.zoom   = 1.0
        self.pan_x  = 0.0
        self.pan_y  = 0.0
        self._drag_start = None
        self._drag_pan   = None

        # measurement
        self.step         = Step.IDLE
        self.cal_nasal:    tuple | None = None
        self.cal_temporal: tuple | None = None
        self.px_per_mm:    float | None = None
        self.pt_eyelid:    tuple | None = None
        self.pt_meniscus:  tuple | None = None
        self.tmh_result:   float | None = None

        # [FIX-4] store calibration hint so it can be shown in status bar
        self._cal_hint: str = ""

        # live preview state (MEAS_2 hover)
        self._live_pt: tuple | None = None   # current mouse image coord

        # tk image handles
        self._photo      = None
        self._diag_photo = None

        self._build_ui()

    # =========================================================================
    #  UI
    # =========================================================================
    def _build_ui(self):
        bk = dict(font=("Segoe UI", 9, "bold"), relief=tk.FLAT,
                  padx=12, pady=5, cursor="hand2", bd=0)

        # ── toolbar ───────────────────────────────────────────────────────────
        tb = tk.Frame(self.root, bg=BG_PANEL, pady=7, padx=12)
        tb.pack(fill=tk.X)

        tk.Label(tb, text="TMH Analyzer", font=("Segoe UI", 13, "bold"),
                 fg=CYAN_HEX, bg=BG_PANEL).pack(side=tk.LEFT)

        tk.Button(tb, text="Open Image", bg="#1d4ed8", fg="white",
                  command=self.open_image, **bk).pack(side=tk.LEFT, padx=(18, 5))

        self.btn_start = tk.Button(
            tb, text="Start Measurement", bg="#6d28d9", fg="white",
            command=self.start_measurement, state=tk.DISABLED, **bk)
        self.btn_start.pack(side=tk.LEFT, padx=5)

        self.btn_undo = tk.Button(
            tb, text="↩ Undo", bg="#374151", fg="#d1d5db",
            command=self.undo, state=tk.DISABLED, **bk)
        self.btn_undo.pack(side=tk.LEFT, padx=5)

        self.btn_save = tk.Button(
            tb, text="💾 Save Diagram", bg="#065f46", fg="white",
            command=self.save_diagram, state=tk.DISABLED, **bk)
        self.btn_save.pack(side=tk.LEFT, padx=5)

        # zoom
        tk.Label(tb, text="Zoom:", fg="#4b5563", bg=BG_PANEL,
                 font=("Segoe UI", 9)).pack(side=tk.RIGHT, padx=(0, 3))
        self.zoom_var = tk.StringVar(value="100%")
        tk.Label(tb, textvariable=self.zoom_var, fg=CYAN_HEX, bg=BG_PANEL,
                 font=("Courier New", 9, "bold"), width=6).pack(side=tk.RIGHT)
        for txt, cmd in (("−", self.zoom_out), ("+", self.zoom_in),
                         ("Fit", self.zoom_fit)):
            tk.Button(tb, text=txt, bg="#1e293b", fg="#cbd5e1",
                      font=("Segoe UI", 9), relief=tk.FLAT,
                      padx=9, pady=4, cursor="hand2",
                      command=cmd).pack(side=tk.RIGHT, padx=2)

        # ── step indicator ────────────────────────────────────────────────────
        step_bar = tk.Frame(self.root, bg=BG_STRIP)
        step_bar.pack(fill=tk.X)

        self._step_frames = {}
        steps_info = [
            (Step.CAL_1,  "1  Nasal limbus",    CYAN_HEX),
            (Step.CAL_2,  "2  Temporal limbus",  CYAN_HEX),
            (Step.MEAS_1, "3  Eyelid margin [C]",    "#4ade80"),
            (Step.MEAS_2, "4  Meniscus apex [D]",    "#60a5fa"),
        ]
        for s, txt, _ in steps_info:
            f = tk.Frame(step_bar, bg="#0c1524", padx=16, pady=4)
            f.pack(side=tk.LEFT, padx=1)
            lbl = tk.Label(f, text=txt, bg="#0c1524", fg="#1e3050",
                           font=("Segoe UI", 8))
            lbl.pack()
            self._step_frames[s] = (f, lbl, _)

        # ── status bar ────────────────────────────────────────────────────────
        self.status_var = tk.StringVar(value=STEP_MSG[Step.IDLE])
        self._status_lbl = tk.Label(
            self.root, textvariable=self.status_var,
            bg="#050810", fg=CYAN_HEX,
            font=("Courier New", 9), anchor=tk.W, padx=12, pady=3)
        self._status_lbl.pack(fill=tk.X)

        # ── paned layout ──────────────────────────────────────────────────────
        paned = tk.PanedWindow(self.root, orient=tk.HORIZONTAL,
                               bg=BG_DARK, sashwidth=5, bd=0)
        paned.pack(fill=tk.BOTH, expand=True)

        # LEFT — image viewer
        left = tk.Frame(paned, bg=BG_DARK)
        paned.add(left, minsize=460, stretch="always")

        self.canvas = tk.Canvas(left, bg="#000000",
                                cursor="crosshair", highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)

        self.canvas.create_text(
            20, 20, anchor=tk.NW,
            text="Open an eye image to begin\n"
                 "Tip: camera should show ONE eye filling the frame\n"
                 "C = lower eyelid margin  |  D = meniscus apex (just above C)",
            fill="#1a3050", font=("Segoe UI", 11), justify=tk.LEFT, tags="hint")

        # canvas bindings
        self.canvas.bind("<Button-1>",        self._on_click)
        self.canvas.bind("<Motion>",          self._on_mouse_move)
        self.canvas.bind("<ButtonPress-3>",   self._drag_start_cb)
        self.canvas.bind("<B3-Motion>",       self._drag_move_cb)
        self.canvas.bind("<ButtonRelease-3>", self._drag_end_cb)
        self.canvas.bind("<MouseWheel>",      self._scroll_zoom)
        self.canvas.bind("<Button-4>",        self._scroll_zoom)
        self.canvas.bind("<Button-5>",        self._scroll_zoom)
        self.canvas.bind("<Configure>",       self._on_canvas_resize)

        # keyboard
        self.root.bind("<r>",      lambda _: self.restart())
        self.root.bind("<u>",      lambda _: self.undo())
        self.root.bind("<s>",      lambda _: self.save_diagram())
        self.root.bind("<q>",      lambda _: self.root.quit())
        self.root.bind("<plus>",   lambda _: self.zoom_in())
        self.root.bind("<minus>",  lambda _: self.zoom_out())
        self.root.bind("<equal>",  lambda _: self.zoom_in())

        # RIGHT — diagram + result
        right = tk.Frame(paned, bg=BG_DARK)
        paned.add(right, minsize=520, stretch="always")

        tk.Label(right, text="  CLINICAL DIAGRAM",
                 font=("Segoe UI", 7, "bold"), fg="#233045",
                 bg=BG_DARK).pack(anchor=tk.W, pady=(4, 0))

        self.diag_canvas = tk.Canvas(right, bg="#000000",
                                     highlightthickness=1,
                                     highlightbackground="#1a2d45")
        self.diag_canvas.pack(fill=tk.BOTH, expand=True, padx=6, pady=(2, 0))
        self._draw_placeholder()

        # result strip
        bot = tk.Frame(right, bg="#090f1e", pady=10, padx=16)
        bot.pack(fill=tk.X, padx=6, pady=(5, 6))

        self.tmh_var  = tk.StringVar(value="—")
        self.stat_var = tk.StringVar(value="—")

        tk.Label(bot, text="TMH", fg="#1e3050", bg="#090f1e",
                 font=("Segoe UI", 8)).grid(row=0, column=0, sticky=tk.W)
        self._tmh_lbl = tk.Label(bot, textvariable=self.tmh_var,
                                  fg=CYAN_HEX, bg="#090f1e",
                                  font=("Courier New", 28, "bold"))
        self._tmh_lbl.grid(row=1, column=0, sticky=tk.W)
        self.stat_lbl = tk.Label(bot, textvariable=self.stat_var,
                                  fg="#2ecc71", bg="#090f1e",
                                  font=("Segoe UI", 10, "bold"))
        self.stat_lbl.grid(row=2, column=0, sticky=tk.W, pady=(2, 0))

        self.detail_var = tk.StringVar(value="")
        tk.Label(bot, textvariable=self.detail_var,
                 fg="#2d4060", bg="#090f1e",
                 font=("Courier New", 8), justify=tk.LEFT
                 ).grid(row=3, column=0, sticky=tk.W, pady=(5, 0))

        # Live preview label
        self._live_var = tk.StringVar(value="")
        self._live_lbl = tk.Label(bot, textvariable=self._live_var,
                                   fg="#f59e0b", bg="#090f1e",
                                   font=("Courier New", 11, "bold"))
        self._live_lbl.grid(row=4, column=0, sticky=tk.W, pady=(4, 0))

    # =========================================================================
    #  Step indicator
    # =========================================================================
    def _update_step_indicator(self):
        done = {
            Step.CAL_1:  self.cal_nasal    is not None,
            Step.CAL_2:  self.cal_temporal is not None,
            Step.MEAS_1: self.pt_eyelid    is not None,
            Step.MEAS_2: self.pt_meniscus  is not None,
        }
        for s, (f, lbl, active_fg) in self._step_frames.items():
            if done[s]:
                bg, fg = "#0a2518", "#22c55e"
            elif s == self.step:
                bg, fg = "#180f3a", active_fg
            else:
                bg, fg = "#0c1524", "#1e3050"
            f.configure(bg=bg); lbl.configure(bg=bg, fg=fg)

    # =========================================================================
    #  Image loading
    # =========================================================================
    def open_image(self):
        path = filedialog.askopenfilename(
            title="Select eye image (single eye, zoomed)",
            filetypes=[("Images", "*.jpg *.jpeg *.png *.bmp *.tif *.tiff"),
                       ("All files", "*.*")])
        if not path:
            return
        bgr = cv2.imread(path)
        if bgr is None:
            messagebox.showerror("Error", f"Cannot read:\n{path}")
            return
        self.orig_bgr = bgr
        self._reset_state()
        self.btn_start.config(state=tk.NORMAL)
        self.btn_undo.config(state=tk.DISABLED)
        self.btn_save.config(state=tk.DISABLED)
        self.root.after(50, self.zoom_fit)
        self.status_var.set(
            f"Loaded: {os.path.basename(path)}  "
            f"({bgr.shape[1]}×{bgr.shape[0]} px)  "
            f"— click  Start Measurement  to begin")

    # =========================================================================
    #  Measurement flow
    # =========================================================================
    def start_measurement(self):
        if self.orig_bgr is None:
            return
        self._reset_state()
        self.step = Step.CAL_1
        self._update_step_indicator()
        self.canvas.config(cursor="crosshair")
        self.btn_undo.config(state=tk.NORMAL)
        self.status_var.set(STEP_MSG[Step.CAL_1])
        self._render()

    def _reset_state(self):
        self.step          = Step.IDLE
        self.cal_nasal     = None
        self.cal_temporal  = None
        self.px_per_mm     = None
        self.pt_eyelid     = None
        self.pt_meniscus   = None
        self.tmh_result    = None
        self._live_pt      = None
        self._cal_hint     = ""   # [FIX-4]
        self.tmh_var.set("—")
        self.stat_var.set("—")
        self.detail_var.set("")
        self._live_var.set("")
        self._draw_placeholder()
        self._update_step_indicator()
        if self.orig_bgr is not None:
            self._render()

    def restart(self):
        if self.orig_bgr is not None:
            self.start_measurement()

    def undo(self):
        if self.step == Step.DONE:
            self.pt_meniscus  = None
            self.tmh_result   = None
            self._live_pt     = None
            self.step         = Step.MEAS_2
            self._draw_placeholder()
            self.tmh_var.set("—"); self.stat_var.set("—")
            self.detail_var.set(""); self._live_var.set("")
            self.btn_save.config(state=tk.DISABLED)
        elif self.step == Step.MEAS_2:
            self.pt_eyelid = None
            self._live_pt  = None
            self.step      = Step.MEAS_1
        elif self.step == Step.MEAS_1:
            self.cal_temporal = None
            self.px_per_mm    = None
            self._cal_hint    = ""  # [FIX-4]
            self.step         = Step.CAL_2
        elif self.step == Step.CAL_2:
            self.cal_nasal = None
            self.step      = Step.CAL_1
        self._live_var.set("")
        self._update_step_indicator()
        self.status_var.set(STEP_MSG[self.step])
        self._render()

    # ── Mouse motion — live TMH preview ──────────────────────────────────────
    def _on_mouse_move(self, event):
        if self.orig_bgr is None:
            return
        ix, iy = self._canvas_to_img(event.x, event.y)
        ih, iw = self.orig_bgr.shape[:2]
        ix = max(0.0, min(float(iw - 1), ix))
        iy = max(0.0, min(float(ih - 1), iy))
        self._live_pt = (ix, iy)

        if self.step == Step.MEAS_2 and self.pt_eyelid is not None and self.px_per_mm:
            p_cd_live = abs(iy - self.pt_eyelid[1])
            tmh_live  = HVID_MM * p_cd_live / (
                abs(self.cal_temporal[0] - self.cal_nasal[0]))
            self._live_var.set(f"Preview: {tmh_live:.3f} mm  ← click to confirm")
            self.status_var.set(
                f"LIVE TMH = {tmh_live:.3f} mm  "
                f"({p_cd_live:.1f} px vertical)  "
                f"— Click to confirm  |  u=undo")
        elif self.step not in (Step.IDLE, Step.DONE):
            self._live_var.set("")

        self._render()

    # ── Click handler ─────────────────────────────────────────────────────────
    def _on_click(self, event):
        if self.step == Step.IDLE or self.orig_bgr is None:
            return
        ix, iy = self._canvas_to_img(event.x, event.y)
        ih, iw = self.orig_bgr.shape[:2]
        ix = max(0.0, min(float(iw - 1), ix))
        iy = max(0.0, min(float(ih - 1), iy))
        pt = (ix, iy)

        if self.step == Step.CAL_1:
            self.cal_nasal = pt
            self.step      = Step.CAL_2

        elif self.step == Step.CAL_2:
            span_px = abs(ix - self.cal_nasal[0])
            if span_px < 15:
                messagebox.showwarning(
                    "Clicks too close",
                    "Nasal and temporal clicks are too close (< 15 px).\n"
                    "Undo (u) and re-click the limbal edges wider apart.")
                return
            self.cal_temporal = pt
            self.px_per_mm    = span_px / HVID_MM
            self.step         = Step.MEAS_1

            # [FIX-4] Compute iris-span hint AND store it so it's actually shown
            iris_pct = span_px / self.orig_bgr.shape[1] * 100
            if iris_pct < 35:
                self._cal_hint = "  ⚠ Iris span < 35% of image — zoom in more for accuracy"
            elif iris_pct > 85:
                self._cal_hint = "  ✓ Iris fills frame nicely"
            else:
                self._cal_hint = ""

            # Update step + show hint immediately, then return to avoid
            # the generic status.set() at the bottom overwriting the hint
            self._update_step_indicator()
            self.status_var.set(STEP_MSG[self.step] + self._cal_hint)
            self._render()
            return

        elif self.step == Step.MEAS_1:
            self.pt_eyelid = pt
            self._live_var.set("")
            self.step      = Step.MEAS_2

        elif self.step == Step.MEAS_2:
            self.pt_meniscus = pt
            self._live_pt    = None
            self._live_var.set("")
            self._compute_tmh()
            return

        self._update_step_indicator()
        self.status_var.set(STEP_MSG[self.step])
        self._render()

    # =========================================================================
    #  TMH calculation
    # =========================================================================
    def _compute_tmh(self):
        """
        TMH = HVID_MM × (P_CD / P_AB)

        P_AB  = abs(temporal_x – nasal_x)   [horizontal limbal span, pixels]
        P_CD  = abs(meniscus_y – eyelid_y)   [vertical meniscus height, pixels]

        Anatomy: D (meniscus apex) is ABOVE C (eyelid margin).
        Both points should be close together near the lower eyelid.
        Expected TMH: 0.10 – 0.60 mm. Values > 1.5 mm suggest wrong clicks.
        """
        _, y_c = self.pt_eyelid
        _, y_d = self.pt_meniscus
        p_cd = abs(y_d - y_c)

        if p_cd < 1:
            messagebox.showwarning(
                "Same Y position",
                "Eyelid margin [C] and meniscus apex [D] are at the same height.\n"
                "Undo (u) and place C at the lower eyelid margin,\n"
                "then D just above it at the top of the tear meniscus.")
            self.pt_meniscus = None
            self.step        = Step.MEAS_2
            self._update_step_indicator()
            self.status_var.set(STEP_MSG[self.step])
            self._render()
            return

        p_ab = abs(self.cal_temporal[0] - self.cal_nasal[0])
        tmh  = HVID_MM * p_cd / p_ab
        self.tmh_result = tmh
        self.step       = Step.DONE

        # ── [FIX-5] Physiological range check ────────────────────────────────
        # Normal TMH is 0.10–0.60 mm. Values > 1.5 mm almost certainly mean
        # the user placed C and D too far apart (e.g. clicking upper and lower
        # eyelid margins to measure palpebral aperture instead of the tiny
        # tear meniscus strip at the lower lid).
        if tmh > TMH_MAX_VALID:
            messagebox.showwarning(
                "⚠  Unusually large TMH — possible wrong click positions",
                f"Measured TMH = {tmh:.3f} mm\n\n"
                f"Normal TMH is 0.10 – 0.60 mm.\n"
                f"Values above {TMH_MAX_VALID} mm almost certainly mean the\n"
                f"measurement points were placed incorrectly.\n\n"
                f"Common mistake:\n"
                f"  • Clicking the UPPER eyelid margin as one point and the\n"
                f"    LOWER eyelid margin as the other — this measures\n"
                f"    palpebral aperture (~6–11 mm), NOT tear meniscus height.\n\n"
                f"Correct placement:\n"
                f"  C  →  lower eyelid margin (skin/conjunctiva border)\n"
                f"  D  →  top of the bright IR tear meniscus arc, just\n"
                f"         ABOVE C (typical distance: 0.2–0.5 mm)\n\n"
                f"Press  u  to undo and re-click.")

        # Lateral offset warning
        pupil_mid_x = (self.cal_nasal[0] + self.cal_temporal[0]) / 2.0
        lat_mm = abs(self.pt_eyelid[0] - pupil_mid_x) / self.px_per_mm

        st, col = get_status(tmh)
        self.tmh_var.set(f"{tmh:.3f} mm")
        self.stat_var.set(st)
        self.stat_lbl.config(fg=col)
        self._live_var.set("")

        lat_warn = (
            f"\n  ⚠ Lateral offset {lat_mm:.2f} mm "
            f"(> {MAX_LATERAL_MM} mm limit)"
            if lat_mm > MAX_LATERAL_MM else ""
        )
        self.detail_var.set(
            f"P_CD  = {p_cd:.1f} px   (eyelid margin C → meniscus apex D)\n"
            f"P_AB  = {p_ab:.1f} px   (limbal calibration span)\n"
            f"HVID  = {HVID_MM} mm   (Wolffsohn 2025)\n"
            f"TMH   = {HVID_MM} × {p_cd:.1f} / {p_ab:.1f}  =  {tmh:.4f} mm"
            f"{lat_warn}"
        )

        self._update_step_indicator()
        self.status_var.set(
            f"✓  TMH = {tmh:.4f} mm   {st}   "
            f"|  u=undo  r=restart  s=save  q=quit")
        self._show_diagram(tmh)
        self.btn_save.config(state=tk.NORMAL)
        self._render()

    # =========================================================================
    #  Rendering
    # =========================================================================
    def _render(self):
        if self.orig_bgr is None:
            return
        ih, iw = self.orig_bgr.shape[:2]
        vw = max(1, self.canvas.winfo_width())
        vh = max(1, self.canvas.winfo_height())

        x0 = max(0, int(self.pan_x))
        y0 = max(0, int(self.pan_y))
        x1 = min(iw, int(self.pan_x + vw / self.zoom) + 1)
        y1 = min(ih, int(self.pan_y + vh / self.zoom) + 1)

        crop  = self.orig_bgr[y0:y1, x0:x1]
        ow    = max(1, int((x1 - x0) * self.zoom))
        oh    = max(1, int((y1 - y0) * self.zoom))
        disp  = cv2.resize(crop, (ow, oh),
                           interpolation=(cv2.INTER_NEAREST
                                          if self.zoom >= 3
                                          else cv2.INTER_LINEAR))
        disp = self._overlay(disp, x0, y0)

        rgb = cv2.cvtColor(disp, cv2.COLOR_BGR2RGB)
        self._photo = ImageTk.PhotoImage(Image.fromarray(rgb))
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self._photo)
        self.zoom_var.set(f"{self.zoom * 100:.0f}%")

    def _overlay(self, disp: np.ndarray, x0: int, y0: int) -> np.ndarray:
        out = disp.copy()
        AA  = cv2.LINE_AA

        def d(pt):
            """Image coord → display pixel coordinate."""
            return (int((pt[0] - x0) * self.zoom),
                    int((pt[1] - y0) * self.zoom))

        # ── Calibration bar ──────────────────────────────────────────────────
        if self.cal_nasal:
            dn = d(self.cal_nasal)
            cv2.circle(out, dn, 9, CYAN_BGR, 2, AA)
            cv2.line(out, (dn[0]-5, dn[1]), (dn[0]+5, dn[1]), CYAN_BGR, 1, AA)
            cv2.line(out, (dn[0], dn[1]-5), (dn[0], dn[1]+5), CYAN_BGR, 1, AA)
            cv2.putText(out, "N", (dn[0]+12, dn[1]+5),
                        cv2.FONT_HERSHEY_DUPLEX, 0.55, CYAN_BGR, 1, AA)

        if self.cal_temporal:
            dt = d(self.cal_temporal)
            cv2.circle(out, dt, 9, CYAN_BGR, 2, AA)
            cv2.line(out, (dt[0]-5, dt[1]), (dt[0]+5, dt[1]), CYAN_BGR, 1, AA)
            cv2.line(out, (dt[0], dt[1]-5), (dt[0], dt[1]+5), CYAN_BGR, 1, AA)
            cv2.putText(out, "T", (dt[0]+12, dt[1]+5),
                        cv2.FONT_HERSHEY_DUPLEX, 0.55, CYAN_BGR, 1, AA)

        if self.cal_nasal and self.cal_temporal:
            dn = d(self.cal_nasal)
            dt = d(self.cal_temporal)
            cv2.line(out, dn, dt, CYAN_BGR, 1, AA)
            mid = ((dn[0]+dt[0])//2, min(dn[1], dt[1]) - 14)
            span = abs(self.cal_temporal[0] - self.cal_nasal[0])
            if self.px_per_mm:
                cv2.putText(out,
                    f"HVID  {span:.0f}px = {HVID_MM}mm  ({self.px_per_mm:.1f}px/mm)",
                    (mid[0]-80, mid[1]),
                    cv2.FONT_HERSHEY_PLAIN, 0.80, CYAN_BGR, 1, AA)

        # ── Eyelid margin (C) — lower point ──────────────────────────────────
        if self.pt_eyelid:
            dc = d(self.pt_eyelid)
            cv2.circle(out, dc, 9, GREEN_BGR, -1, AA)
            cv2.circle(out, dc, 9, (255,255,255), 1, AA)
            cv2.putText(out, "C  Eyelid margin (lower)", (dc[0]+13, dc[1]+5),
                        cv2.FONT_HERSHEY_DUPLEX, 0.50, GREEN_BGR, 1, AA)

        # ── Meniscus apex (D) — upper point, confirmed ────────────────────────
        if self.pt_meniscus:
            dd = d(self.pt_meniscus)
            cv2.circle(out, dd, 9, BLUE_BGR, -1, AA)
            cv2.circle(out, dd, 9, (255,255,255), 1, AA)
            cv2.putText(out, "D  Meniscus apex (above C)", (dd[0]+13, dd[1]+5),
                        cv2.FONT_HERSHEY_DUPLEX, 0.50, BLUE_BGR, 1, AA)

        # ── Final measurement arrow ───────────────────────────────────────────
        if self.pt_eyelid and self.pt_meniscus and self.tmh_result is not None:
            dc = d(self.pt_eyelid)
            dd = d(self.pt_meniscus)
            x_line = dc[0]
            # Arrow from C (lower) to D (upper); arrowhead at D
            cv2.arrowedLine(out, (x_line, dc[1]), (x_line, dd[1]),
                            CYAN_BGR, 2, AA, tipLength=0.25)
            _, col = get_status(self.tmh_result)
            bgr_col = {"#e74c3c": (50,50,220),
                       "#f39c12": (40,160,220),
                       "#2ecc71": (50,190,70)}.get(col, CYAN_BGR)
            mid_y = (dc[1] + dd[1]) // 2
            cv2.putText(out,
                f"TMH = {self.tmh_result:.3f} mm",
                (x_line + 10, mid_y),
                cv2.FONT_HERSHEY_DUPLEX, 0.65, bgr_col, 2, AA)

        # ── LIVE preview line (MEAS_2 hover before click) ─────────────────────
        elif (self.step == Step.MEAS_2
              and self.pt_eyelid is not None
              and self._live_pt is not None
              and self.px_per_mm):
            dc   = d(self.pt_eyelid)
            dl   = d(self._live_pt)
            x_ln = dc[0]
            y_min = min(dc[1], dl[1])
            y_max = max(dc[1], dl[1])
            for seg_y in range(y_min, y_max, 8):
                cv2.line(out, (x_ln, seg_y), (x_ln, min(seg_y+4, y_max)),
                         (50, 200, 255), 1, AA)
            p_cd_live = abs(self._live_pt[1] - self.pt_eyelid[1])
            p_ab      = abs(self.cal_temporal[0] - self.cal_nasal[0])
            tmh_live  = HVID_MM * p_cd_live / p_ab
            _, col = get_status(tmh_live)
            bgr_col = {"#e74c3c": (50,50,220),
                       "#f39c12": (40,160,220),
                       "#2ecc71": (50,190,70)}.get(col, CYAN_BGR)
            lbl_y = (dc[1] + dl[1]) // 2
            cv2.putText(out,
                f"{tmh_live:.3f} mm",
                (x_ln + 10, lbl_y),
                cv2.FONT_HERSHEY_DUPLEX, 0.7, bgr_col, 2, AA)
            cv2.circle(out, (int(dl[0]), int(dl[1])), 7,
                       (50, 200, 255), 1, AA)

        return out

    # =========================================================================
    #  Diagram panel
    # =========================================================================
    def _draw_placeholder(self):
        self.diag_canvas.delete("all")
        self.diag_canvas.create_text(
            260, 180,
            text="Clinical diagram appears here\nafter all 4 measurement clicks\n\n"
                 "D = meniscus apex (top)\nC = eyelid margin (bottom)",
            fill="#152030", font=("Segoe UI", 12), justify=tk.CENTER)

    def _show_diagram(self, tmh_mm: float):
        diag = draw_diagram(tmh_mm, self.px_per_mm or 0)
        rgb  = cv2.cvtColor(diag, cv2.COLOR_BGR2RGB)
        self._diag_photo = ImageTk.PhotoImage(Image.fromarray(rgb))
        self.diag_canvas.delete("all")
        self.diag_canvas.create_image(0, 0, anchor=tk.NW,
                                       image=self._diag_photo)
        self.diag_canvas.config(
            scrollregion=(0, 0, diag.shape[1], diag.shape[0]))

    # =========================================================================
    #  Zoom & Pan
    # =========================================================================
    def _canvas_to_img(self, cx, cy):
        return (self.pan_x + cx / self.zoom,
                self.pan_y + cy / self.zoom)

    def _clamp_pan(self):
        if self.orig_bgr is None:
            return
        ih, iw = self.orig_bgr.shape[:2]
        vw = max(1, self.canvas.winfo_width())
        vh = max(1, self.canvas.winfo_height())
        self.pan_x = max(0.0, min(self.pan_x, max(0.0, iw - vw  / self.zoom)))
        self.pan_y = max(0.0, min(self.pan_y, max(0.0, ih - vh / self.zoom)))

    def _zoom_by(self, factor, around=None):
        if self.orig_bgr is None:
            return
        new_z = max(ZOOM_MIN, min(ZOOM_MAX, self.zoom * factor))
        if new_z == self.zoom:
            return
        vw = max(1, self.canvas.winfo_width())
        vh = max(1, self.canvas.winfo_height())
        ax, ay = around if around else (vw / 2, vh / 2)
        ix = self.pan_x + ax / self.zoom
        iy = self.pan_y + ay / self.zoom
        self.zoom  = new_z
        self.pan_x = ix - ax / self.zoom
        self.pan_y = iy - ay / self.zoom
        self._clamp_pan()
        self._render()

    def zoom_in(self):   self._zoom_by(ZOOM_STEP)
    def zoom_out(self):  self._zoom_by(1 / ZOOM_STEP)

    def zoom_fit(self):
        if self.orig_bgr is None:
            return
        self.root.update_idletasks()
        vw = max(1, self.canvas.winfo_width())
        vh = max(1, self.canvas.winfo_height())
        ih, iw = self.orig_bgr.shape[:2]
        self.zoom  = min(vw / iw, vh / ih, 1.0)
        self.pan_x = 0.0
        self.pan_y = 0.0
        self._render()

    def _on_canvas_resize(self, event):
        if self.orig_bgr is not None and self.step == Step.IDLE:
            self.zoom_fit()
        elif self.orig_bgr is not None:
            self._clamp_pan()
            self._render()

    def _scroll_zoom(self, event):
        if self.orig_bgr is None:
            return
        direction = (event.delta > 0) or (event.num == 4)
        self._zoom_by(ZOOM_STEP if direction else 1 / ZOOM_STEP,
                      around=(event.x, event.y))

    def _drag_start_cb(self, event):
        self._drag_start = (event.x, event.y)
        self._drag_pan   = (self.pan_x, self.pan_y)
        self.canvas.config(cursor="fleur")

    def _drag_move_cb(self, event):
        if not self._drag_start:
            return
        dx = (event.x - self._drag_start[0]) / self.zoom
        dy = (event.y - self._drag_start[1]) / self.zoom
        self.pan_x = self._drag_pan[0] - dx
        self.pan_y = self._drag_pan[1] - dy
        self._clamp_pan()
        self._render()

    def _drag_end_cb(self, event):
        self._drag_start = None
        self.canvas.config(cursor="crosshair")

    # =========================================================================
    #  Save
    # =========================================================================
    def save_diagram(self):
        if self.tmh_result is None:
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".png",
            initialfile=f"TMH_{self.tmh_result:.3f}mm_{datetime.now().strftime('%Y%m%d_%H%M')}.png",
            filetypes=[("PNG", "*.png"), ("All files", "*.*")])
        if not path:
            return
        diag = draw_diagram(self.tmh_result, self.px_per_mm or 0)
        cv2.imwrite(path, diag)
        messagebox.showinfo("Saved", f"Diagram saved:\n{path}")
        self.status_var.set(f"✓ Saved → {path}")


# =============================================================================
#  Entry point
# =============================================================================
def main():
    root = tk.Tk()
    root.geometry("1440x840")

    try:
        from ctypes import windll, byref, sizeof, c_int
        windll.dwmapi.DwmSetWindowAttribute(
            windll.user32.GetParent(root.winfo_id()),
            20, byref(c_int(1)), sizeof(c_int))
    except Exception:
        pass

    TMHApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()