import cv2
import numpy as np
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

# ── OpenCV DNN pose — replaces mediapipe (Python 3.13 compatible) ─────────────
# We use a lightweight Haar + HOG approach with OpenCV built-ins only.
# No mediapipe, no dlib — works on Python 3.13 out of the box.


class BodyLanguageAnalyzer:
    """
    Body presence and posture analysis using OpenCV only.
    Replaces MediaPipe (which does not support Python 3.13).

    Approach:
      1. Haar cascade face detector  — confirms face presence
      2. Upper-body Haar cascade     — confirms body presence
      3. HOG person detector         — full-body presence score
      4. Skin-tone region analysis   — extra liveness proxy
    """

    def __init__(self):
        # Face cascade (always available with OpenCV)
        self._face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        # Upper-body cascade
        self._upper_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_upperbody.xml"
        )
        # HOG person detector
        self._hog = cv2.HOGDescriptor()
        self._hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

        logger.info("✅ BodyLanguageAnalyzer initialized (OpenCV Haar + HOG)")

    # ------------------------------------------------------------------ #
    #  Main entry point                                                    #
    # ------------------------------------------------------------------ #

    def analyze(self, bgr_image: np.ndarray) -> Dict[str, Any]:
        """
        Analyse body / person presence.
        Returns presence_score (0-1), where >= 0.60 = confident person present.
        """
        try:
            gray = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)
            h, w = bgr_image.shape[:2]

            scores = {}

            # --- 1. Face presence via Haar ---
            scores["face_haar"] = self._face_score(gray)

            # --- 2. Upper body via Haar ---
            scores["upper_body"] = self._upper_body_score(gray)

            # --- 3. HOG person detection (works best at ≥128px height) ---
            if h >= 128 and w >= 64:
                scores["hog_person"] = self._hog_score(bgr_image)
            else:
                scores["hog_person"] = 0.6   # image too small to run HOG reliably

            # --- 4. Skin tone presence ---
            scores["skin_tone"] = self._skin_tone_score(bgr_image)

            # --- 5. Image content check (not mostly blank) ---
            scores["content"] = self._content_score(gray)

            # Composite weighted score
            weights = {
                "face_haar":  0.40,
                "upper_body": 0.20,
                "hog_person": 0.15,
                "skin_tone":  0.15,
                "content":    0.10,
            }
            presence = float(np.clip(
                sum(scores[k] * weights[k] for k in weights), 0.0, 1.0
            ))

            return {
                "presence_score": round(presence, 3),
                "scores": {k: round(float(v), 3) for k, v in scores.items()},
                "analysis": {"mode": "opencv_haar_hog"},
                "verdict": "person_present" if presence >= 0.55 else "uncertain",
            }

        except Exception as e:
            logger.exception("BodyLanguageAnalyzer.analyze error")
            return self._fallback(bgr_image)

    # ------------------------------------------------------------------ #
    #  Sub-analysers                                                       #
    # ------------------------------------------------------------------ #

    def _face_score(self, gray: np.ndarray) -> float:
        """Haar face detector — returns 1.0 if face found, else 0.2."""
        try:
            faces = self._face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
            )
            if len(faces) == 1:
                return 1.0
            if len(faces) > 1:
                return 0.7   # multiple faces — less certain
            return 0.2
        except Exception:
            return 0.5

    def _upper_body_score(self, gray: np.ndarray) -> float:
        """Haar upper-body detector."""
        try:
            bodies = self._upper_cascade.detectMultiScale(
                gray, scaleFactor=1.05, minNeighbors=3, minSize=(60, 60)
            )
            return 1.0 if len(bodies) > 0 else 0.4
        except Exception:
            return 0.5

    def _hog_score(self, bgr: np.ndarray) -> float:
        """HOG person detector — returns presence confidence."""
        try:
            # Resize to standard HOG window for speed
            h, w = bgr.shape[:2]
            scale = min(1.0, 400 / max(h, w))
            resized = cv2.resize(bgr, (int(w * scale), int(h * scale)))

            rects, weights = self._hog.detectMultiScale(
                resized,
                winStride=(8, 8),
                padding=(4, 4),
                scale=1.05
            )
            if len(rects) == 0:
                return 0.35
            max_weight = float(np.max(weights)) if len(weights) > 0 else 0.5
            # HOG weights are typically in range [0, ~2]; normalise to 0-1
            return float(min(1.0, max_weight / 1.5))
        except Exception:
            return 0.5

    def _skin_tone_score(self, bgr: np.ndarray) -> float:
        """YCrCb skin tone detector."""
        try:
            ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
            Y, Cr, Cb = ycrcb[:, :, 0], ycrcb[:, :, 1], ycrcb[:, :, 2]
            mask = (Y > 80) & (Y < 240) & (Cr > 133) & (Cr < 173) & (Cb > 77) & (Cb < 127)
            ratio = float(np.sum(mask)) / (bgr.shape[0] * bgr.shape[1] + 1e-8)
            if 0.10 <= ratio <= 0.75:
                return float(min(1.0, ratio * 1.8))
            return 0.3
        except Exception:
            return 0.5

    def _content_score(self, gray: np.ndarray) -> float:
        """Check image is not mostly blank/uniform."""
        try:
            std = float(np.std(gray))
            mean = float(np.mean(gray))
            if std < 8 or mean < 10 or mean > 245:
                return 0.1   # blank or blown-out image
            return float(min(1.0, std / 40.0))
        except Exception:
            return 0.6

    def _fallback(self, bgr_image: np.ndarray) -> Dict[str, Any]:
        """Safe fallback when everything fails."""
        try:
            gray = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2GRAY)
            std  = float(np.std(gray))
            score = float(min(1.0, std / 35.0)) if std > 8 else 0.3
        except Exception:
            score = 0.65
        return {
            "presence_score": score,
            "scores": {"fallback": score},
            "analysis": {"mode": "fallback"},
            "verdict": "person_present" if score > 0.55 else "uncertain",
        }
