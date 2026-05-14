import cv2
import numpy as np
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


class LivenessDetector:
    """
    Multi-factor liveness / anti-spoofing using vectorised NumPy + OpenCV.
    No dlib, no mediapipe — fully compatible with Python 3.13.

    Signals analysed:
      1. LBP texture entropy        — printed photos have flatter texture
      2. Frequency domain analysis  — screens have periodic noise patterns
      3. Skin-tone chrominance      — real skin has a specific YCrCb distribution
      4. Gradient richness          — real faces have rich edge detail
      5. Specular highlight pattern — real skin reflects light differently
      6. Brightness variance        — screens have unnatural uniformity
    """

    def __init__(self):
        logger.info("✅ LivenessDetector initialized (vectorised OpenCV/NumPy)")

    # ------------------------------------------------------------------ #
    #  Main entry point                                                    #
    # ------------------------------------------------------------------ #

    def check_liveness(self, rgb_image: np.ndarray, face_location: List) -> Dict[str, Any]:
        try:
            top, right, bottom, left = face_location
            pad = 20
            h, w = rgb_image.shape[:2]
            top    = max(0, top - pad)
            bottom = min(h, bottom + pad)
            left   = max(0, left - pad)
            right  = min(w, right + pad)

            face_roi = rgb_image[top:bottom, left:right]
            if face_roi.size == 0:
                return {"liveness_score": 0.0, "details": {"error": "empty_roi"}, "verdict": "spoof"}

            bgr  = cv2.cvtColor(face_roi, cv2.COLOR_RGB2BGR)
            gray = cv2.cvtColor(bgr,  cv2.COLOR_BGR2GRAY)

            scores = {
                "texture":    self._lbp_texture(gray),
                "frequency":  self._frequency(gray),
                "skin_color": self._skin_color(bgr),
                "gradient":   self._gradient(gray),
                "specular":   self._specular(gray),
                "brightness": self._brightness_variance(gray),
            }

            weights = {
                "texture":    0.28,
                "frequency":  0.22,
                "skin_color": 0.20,
                "gradient":   0.15,
                "specular":   0.10,
                "brightness": 0.05,
            }

            liveness = float(np.clip(
                sum(scores[k] * weights[k] for k in weights), 0.0, 1.0
            ))

            return {
                "liveness_score": round(liveness, 4),
                "details": {k: round(float(v), 3) for k, v in scores.items()},
                "verdict": "real" if liveness >= 0.60 else "spoof",
            }

        except Exception as e:
            logger.exception("check_liveness error")
            return {"liveness_score": 0.0, "details": {"error": str(e)}, "verdict": "spoof"}

    # ------------------------------------------------------------------ #
    #  Signal 1: LBP texture (fully vectorised — O(1) NumPy, not O(N²))  #
    # ------------------------------------------------------------------ #

    def _lbp_texture(self, gray: np.ndarray) -> float:
        try:
            if gray.shape[0] < 10 or gray.shape[1] < 10:
                return 0.5

            g = gray.astype(np.int32)
            center = g[1:-1, 1:-1]

            # 8 neighbours clockwise
            neighbors = [
                g[0:-2, 0:-2], g[0:-2, 1:-1], g[0:-2, 2:],
                g[1:-1, 2:],
                g[2:,   2:],   g[2:,   1:-1], g[2:,   0:-2],
                g[1:-1, 0:-2],
            ]
            lbp = np.zeros_like(center, dtype=np.uint8)
            for bit, nb in enumerate(neighbors):
                lbp |= ((nb >= center).astype(np.uint8) << bit)

            hist, _ = np.histogram(lbp.ravel(), bins=256, range=(0, 256))
            hist = hist.astype(np.float64) / (hist.sum() + 1e-8)
            entropy = -np.sum(hist * np.log2(hist + 1e-10))
            normalized = entropy / np.log2(256)   # 0..1

            # Real faces: 0.55–0.92 entropy
            # Printed/screen photos: < 0.50 (too flat) or > 0.95 (noise)
            if 0.55 <= normalized <= 0.92:
                return float(min(1.0, normalized * 1.1))
            if normalized < 0.55:
                return float(normalized * 0.75)
            return 0.65
        except Exception:
            return 0.6

    # ------------------------------------------------------------------ #
    #  Signal 2: Frequency domain (FFT)                                   #
    # ------------------------------------------------------------------ #

    def _frequency(self, gray: np.ndarray) -> float:
        try:
            f = np.fft.fftshift(np.fft.fft2(gray.astype(np.float32)))
            mag = np.log(np.abs(f) + 1)
            cy, cx = mag.shape[0] // 2, mag.shape[1] // 2
            r = min(30, cy // 2, cx // 2)
            mask_low = np.zeros_like(mag)
            mask_low[cy - r:cy + r, cx - r:cx + r] = 1.0
            low_e  = np.sum(mag * mask_low)
            high_e = np.sum(mag * (1 - mask_low))
            total  = low_e + high_e + 1e-8
            ratio  = high_e / total
            # Screens / printed photos: abnormally low or very high high-freq energy
            if 0.28 <= ratio <= 0.82:
                return 0.85
            if ratio < 0.28:
                return 0.40   # too smooth — likely printed photo
            return 0.55       # too noisy — likely screen
        except Exception:
            return 0.65

    # ------------------------------------------------------------------ #
    #  Signal 3: Skin-tone chrominance                                    #
    # ------------------------------------------------------------------ #

    def _skin_color(self, bgr: np.ndarray) -> float:
        try:
            ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
            Y, Cr, Cb = ycrcb[:, :, 0], ycrcb[:, :, 1], ycrcb[:, :, 2]
            mask = (Y > 70) & (Y < 245) & (Cr > 128) & (Cr < 178) & (Cb > 72) & (Cb < 132)
            ratio = float(np.sum(mask)) / (bgr.shape[0] * bgr.shape[1] + 1e-8)
            if 0.12 <= ratio <= 0.80:
                return float(min(1.0, ratio * 1.4))
            return 0.35
        except Exception:
            return 0.6

    # ------------------------------------------------------------------ #
    #  Signal 4: Gradient richness (Sobel)                                #
    # ------------------------------------------------------------------ #

    def _gradient(self, gray: np.ndarray) -> float:
        try:
            sx  = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            sy  = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            mag = np.sqrt(sx ** 2 + sy ** 2)
            m   = float(np.mean(mag))
            s   = float(np.std(mag))
            if s > 8 and m > 4:
                return float(min(1.0, (s / 45.0 + m / 28.0) / 2.0))
            return 0.30   # very flat — likely printed photo on flat surface
        except Exception:
            return 0.6

    # ------------------------------------------------------------------ #
    #  Signal 5: Specular highlights                                      #
    # ------------------------------------------------------------------ #

    def _specular(self, gray: np.ndarray) -> float:
        """
        Real skin has small, localised specular highlights (nose tip, forehead).
        Screens and printed photos either have none or too many.
        """
        try:
            _, bright = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY)
            bright_ratio = float(np.sum(bright > 0)) / (gray.size + 1e-8)
            # Expect 1–15% specular pixels on a real face
            if 0.01 <= bright_ratio <= 0.15:
                return 0.90
            if bright_ratio > 0.50:
                return 0.30   # screen glare
            return 0.55
        except Exception:
            return 0.6

    # ------------------------------------------------------------------ #
    #  Signal 6: Brightness variance                                      #
    # ------------------------------------------------------------------ #

    def _brightness_variance(self, gray: np.ndarray) -> float:
        try:
            std = float(np.std(gray))
            if std < 8:
                return 0.15   # too uniform — blank / screen / flat lit photo
            if std > 90:
                return 0.50   # too variable — harsh shadows
            return float(min(1.0, std / 38.0))
        except Exception:
            return 0.6
