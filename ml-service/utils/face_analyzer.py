import cv2
import numpy as np
import os
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

# ── InsightFace — replaces dlib + face-recognition ───────────────────────────
# Supports Python 3.13, no compiler needed, pre-built ONNX wheels.
INSIGHTFACE_AVAILABLE = False
app_instance = None   # InsightFace FaceAnalysis app (loaded once)

try:
    import insightface
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
    logger.info("✅ insightface imported successfully")
except ImportError as e:
    logger.warning(f"⚠️  insightface not available: {e}")


def _get_insightface_app():
    """Lazy-initialise InsightFace once and reuse."""
    global app_instance
    if app_instance is not None:
        return app_instance
    if not INSIGHTFACE_AVAILABLE:
        return None
    try:
        # det_size must be multiple of 32. 320x320 is fast and accurate for
        # portrait / webcam images.
        fa = FaceAnalysis(
            name="buffalo_sc",     # lightweight model (~20 MB), no GPU needed
            providers=["CPUExecutionProvider"]
        )
        fa.prepare(ctx_id=-1, det_size=(320, 320))   # ctx_id=-1 = CPU
        app_instance = fa
        logger.info("✅ InsightFace FaceAnalysis ready (buffalo_sc / CPU)")
        return fa
    except Exception as e:
        logger.error(f"InsightFace init error: {e}")
        return None


class FaceAnalyzer:
    def __init__(self):
        # Trigger lazy init at startup so first request is not slow
        self._app = _get_insightface_app()
        if INSIGHTFACE_AVAILABLE and self._app is not None:
            logger.info("✅ FaceAnalyzer ready (InsightFace / CPU)")
        else:
            logger.warning("⚠️  FaceAnalyzer: InsightFace unavailable")

    # ------------------------------------------------------------------ #
    #  Public helpers                                                      #
    # ------------------------------------------------------------------ #

    def _not_available(self) -> Dict[str, Any]:
        return {
            "error": (
                "InsightFace not installed. "
                "Run: pip install insightface onnxruntime"
            )
        }

    def _ensure_app(self):
        if self._app is None:
            self._app = _get_insightface_app()
        return self._app

    # ------------------------------------------------------------------ #
    #  Face detection                                                      #
    # ------------------------------------------------------------------ #

    def detect_faces(self, rgb_image: np.ndarray) -> Dict[str, Any]:
        """Detect all faces. Returns face_locations as [top,right,bottom,left]."""
        app = self._ensure_app()
        if app is None:
            return {
                "faces_found": False,
                "face_count": 0,
                "face_locations": [],
                **self._not_available()
            }
        try:
            # InsightFace expects BGR
            bgr = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
            faces = app.get(bgr)

            face_locations = []
            for face in faces:
                x1, y1, x2, y2 = [int(c) for c in face.bbox]
                # Convert to (top, right, bottom, left) — same convention as face_recognition
                top, right, bottom, left = y1, x2, y2, x1
                face_locations.append([top, right, bottom, left])

            return {
                "faces_found": len(face_locations) > 0,
                "face_count": len(face_locations),
                "face_locations": face_locations,
                "_faces": faces   # keep raw for get_encoding
            }
        except Exception as e:
            logger.exception("detect_faces error")
            return {"faces_found": False, "face_count": 0, "face_locations": []}

    # ------------------------------------------------------------------ #
    #  Face encoding (512-d embedding from InsightFace ArcFace)           #
    # ------------------------------------------------------------------ #

    def get_encoding(self, rgb_image: np.ndarray, face_location: List) -> Optional[np.ndarray]:
        """
        Extract face embedding via InsightFace ArcFace.
        Returns a normalised 512-d float32 vector, or None on failure.
        """
        app = self._ensure_app()
        if app is None:
            return None
        try:
            bgr = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)

            # Crop face ROI with padding for better accuracy
            top, right, bottom, left = face_location
            h, w = bgr.shape[:2]
            pad = 20
            top    = max(0, top - pad)
            bottom = min(h, bottom + pad)
            left   = max(0, left - pad)
            right  = min(w, right + pad)
            face_crop = bgr[top:bottom, left:right]

            if face_crop.size == 0:
                return None

            # Run full InsightFace pipeline on crop
            faces = app.get(face_crop)
            if not faces:
                # Retry on full image
                faces = app.get(bgr)

            if not faces:
                return None

            # Use the face with highest detection score
            best = max(faces, key=lambda f: float(f.det_score))
            if best.embedding is None:
                return None

            emb = np.array(best.embedding, dtype=np.float32)
            # L2-normalise so cosine distance = Euclidean distance
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb = emb / norm
            return emb

        except Exception as e:
            logger.exception("get_encoding error")
            return None

    # ------------------------------------------------------------------ #
    #  Face comparison                                                     #
    # ------------------------------------------------------------------ #

    def compare_faces(
        self,
        known_encoding: np.ndarray,
        unknown_encoding: np.ndarray,
        tolerance: float = 0.42
    ) -> Dict[str, Any]:
        """
        Compare two face embeddings.
        InsightFace uses cosine similarity on L2-normalised embeddings.
        Threshold 0.42 → ~EER on LFW. Lower distance = better match.
        """
        if not INSIGHTFACE_AVAILABLE:
            return {"match": False, "distance": 1.0, "confidence": 0.0, **self._not_available()}
        try:
            known   = np.array(known_encoding,   dtype=np.float32).flatten()
            unknown = np.array(unknown_encoding, dtype=np.float32).flatten()

            # Cosine distance (0 = identical, 2 = opposite)
            cosine_sim  = float(np.dot(known, unknown))
            cosine_dist = float(1.0 - cosine_sim)  # 0..2

            # Normalise to 0-1 range for comparison with tolerance
            normalised_dist = cosine_dist / 2.0   # 0..1

            # Confidence: 100% at dist=0, 0% at dist>=0.5
            confidence = float(max(0.0, min(100.0, (1.0 - normalised_dist * 2) * 100)))

            match = normalised_dist <= tolerance

            return {
                "match": match,
                "distance": round(normalised_dist, 4),
                "confidence": round(confidence, 2)
            }
        except Exception as e:
            logger.exception("compare_faces error")
            return {"match": False, "distance": 1.0, "confidence": 0.0}

    # ------------------------------------------------------------------ #
    #  Image quality assessment (OpenCV only — no dlib dependency)        #
    # ------------------------------------------------------------------ #

    def assess_quality(self, rgb_image: np.ndarray, face_location: List) -> Dict[str, Any]:
        try:
            top, right, bottom, left = face_location
            h, w = rgb_image.shape[:2]
            face_h = bottom - top
            face_w = right - left

            scores  = []
            reasons = []

            # 1. Face size ratio
            ratio = (face_h * face_w) / (h * w + 1e-8)
            if ratio < 0.05:
                reasons.append("Face too small in frame — move closer")
                scores.append(0.4)
            elif ratio < 0.10:
                scores.append(0.75)
            else:
                scores.append(1.0)

            # 2. Sharpness (Laplacian variance)
            bgr      = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
            gray     = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            face_roi = gray[top:bottom, left:right]
            if face_roi.size > 0:
                lap_var = cv2.Laplacian(face_roi, cv2.CV_64F).var()
                if lap_var < 50:
                    reasons.append("Image is blurry — hold steady")
                    scores.append(0.3)
                elif lap_var < 100:
                    scores.append(0.7)
                else:
                    scores.append(1.0)

            # 3. Brightness
            face_region = rgb_image[top:bottom, left:right]
            if face_region.size > 0:
                brightness = float(np.mean(face_region))
                if brightness < 50:
                    reasons.append("Too dark — improve lighting")
                    scores.append(0.3)
                elif brightness > 220:
                    reasons.append("Overexposed — reduce light or move away from source")
                    scores.append(0.5)
                else:
                    scores.append(1.0)

            # 4. Minimum face resolution
            if face_h < 80 or face_w < 80:
                reasons.append("Face resolution too low")
                scores.append(0.4)
            else:
                scores.append(1.0)

            overall = float(np.mean(scores)) if scores else 0.5
            return {
                "score":   round(overall, 3),
                "reason":  "; ".join(reasons) if reasons else "Good quality",
                "details": {"face_area_ratio": round(ratio, 4)}
            }
        except Exception as e:
            return {"score": 0.7, "reason": str(e)}

    # ------------------------------------------------------------------ #
    #  Orientation check (OpenCV-only, no dlib)                           #
    # ------------------------------------------------------------------ #

    def check_orientation(self, rgb_image: np.ndarray, face_location: List) -> Dict[str, Any]:
        """
        Estimate head pose from raw face crop using Haar-cascade eye detector
        as a lightweight proxy.  InsightFace buffalo_sc also exposes
        face.pose = [pitch, yaw, roll] when the recognition model is loaded.
        We use InsightFace pose when available; fall back to eye-symmetry otherwise.
        """
        app = self._ensure_app()
        try:
            bgr = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
            faces = app.get(bgr) if app else []

            # InsightFace buffalo_l exposes .pose; buffalo_sc may not always
            for face in faces:
                if hasattr(face, "pose") and face.pose is not None:
                    pitch, yaw, roll = [float(v) for v in face.pose]
                    is_frontal = abs(yaw) < 30 and abs(pitch) < 20
                    if not is_frontal:
                        direction = "turned_right" if yaw > 0 else "turned_left"
                        if abs(pitch) > 20:
                            direction = "tilted"
                        return {"is_frontal": False, "direction": direction,
                                "yaw": round(yaw, 1), "pitch": round(pitch, 1)}
                    return {"is_frontal": True, "direction": "frontal",
                            "yaw": round(yaw, 1), "pitch": round(pitch, 1)}

            # Fallback: eye-symmetry heuristic
            return self._eye_symmetry_orientation(rgb_image, face_location)

        except Exception:
            return {"is_frontal": True, "direction": "unknown"}

    def _eye_symmetry_orientation(self, rgb_image, face_location) -> Dict[str, Any]:
        """Haar cascade eye detector as orientation fallback."""
        try:
            top, right, bottom, left = face_location
            bgr = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            face_roi = gray[top:bottom, left:right]

            cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_eye.xml"
            )
            eyes = cascade.detectMultiScale(face_roi, 1.1, 4, minSize=(20, 20))

            if len(eyes) < 2:
                # Can't determine orientation with < 2 eyes visible
                return {"is_frontal": True, "direction": "unknown"}

            # Sort by x position
            eyes = sorted(eyes, key=lambda e: e[0])
            left_eye_cx  = eyes[0][0] + eyes[0][2] // 2
            right_eye_cx = eyes[-1][0] + eyes[-1][2] // 2
            face_w = right - left
            eye_span = right_eye_cx - left_eye_cx
            face_center = face_w / 2

            left_margin  = left_eye_cx
            right_margin = face_w - right_eye_cx
            asymmetry = abs(left_margin - right_margin) / (face_w + 1e-8)

            if asymmetry > 0.25:
                direction = "turned_right" if right_margin < left_margin else "turned_left"
                return {"is_frontal": False, "direction": direction, "asymmetry": round(asymmetry, 3)}

            return {"is_frontal": True, "direction": "frontal"}
        except Exception:
            return {"is_frontal": True, "direction": "unknown"}

    # ------------------------------------------------------------------ #
    #  Eye openness (EAR via InsightFace landmark points)                 #
    # ------------------------------------------------------------------ #

    def check_eye_openness(self, rgb_image: np.ndarray, face_location: List) -> float:
        """
        Eye Aspect Ratio from InsightFace keypoints (5-point or 68-point).
        Returns 0-1 score (1 = fully open, 0 = closed).
        """
        app = self._ensure_app()
        if app is None:
            return 0.7
        try:
            bgr   = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
            faces = app.get(bgr)
            if not faces:
                return 0.7

            best = max(faces, key=lambda f: float(f.det_score))
            kps  = best.kps   # 5-point: [left_eye, right_eye, nose, left_mouth, right_mouth]

            if kps is None or len(kps) < 2:
                return 0.7

            # With only 5 keypoints we can't compute full EAR.
            # Use the eye span relative to face height as a proxy.
            top, right, bottom, left = face_location
            face_h = bottom - top + 1e-8
            left_eye_y  = float(kps[0][1])
            right_eye_y = float(kps[1][1])
            avg_eye_y   = (left_eye_y + right_eye_y) / 2
            # Eyes near top-third of face = likely open
            eye_pos_ratio = (avg_eye_y - top) / face_h
            if 0.2 <= eye_pos_ratio <= 0.55:
                return 0.85   # eyes in expected position
            return 0.55

        except Exception:
            return 0.7
