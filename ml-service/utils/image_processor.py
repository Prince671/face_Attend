import cv2
import numpy as np
import base64
import logging
from typing import Tuple

logger = logging.getLogger(__name__)


class ImageProcessor:
    """
    Image preprocessing pipeline for face recognition.
    Pure OpenCV + NumPy — Python 3.13 compatible.
    """

    def __init__(self):
        logger.info("✅ ImageProcessor initialized")

    def preprocess_for_recognition(self, bgr_image: np.ndarray) -> np.ndarray:
        """Fast pipeline: resize -> CLAHE -> sharpen -> normalise."""
        try:
            img = bgr_image.copy()
            img = self._smart_resize(img, max_size=640)
            img = self._clahe_equalize(img)
            img = self._sharpen(img)
            img = self._normalize_brightness(img)
            return img
        except Exception as e:
            logger.warning(f"Preprocessing error (returning original): {e}")
            return bgr_image

    def _smart_resize(self, img: np.ndarray, max_size: int = 1280) -> np.ndarray:
        h, w = img.shape[:2]
        if max(h, w) <= max_size:
            return img
        scale = max_size / max(h, w)
        return cv2.resize(img, (int(w * scale), int(h * scale)),
                          interpolation=cv2.INTER_LANCZOS4)

    def _denoise(self, img: np.ndarray) -> np.ndarray:
        try:
            return cv2.fastNlMeansDenoisingColored(img, None, 5, 5, 7, 21)
        except Exception:
            return img

    def _clahe_equalize(self, bgr: np.ndarray) -> np.ndarray:
        try:
            lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            l_eq  = clahe.apply(l)
            return cv2.cvtColor(cv2.merge([l_eq, a, b]), cv2.COLOR_LAB2BGR)
        except Exception:
            return bgr

    def _sharpen(self, img: np.ndarray) -> np.ndarray:
        try:
            blur = cv2.GaussianBlur(img, (0, 0), 2.0)
            return cv2.addWeighted(img, 1.3, blur, -0.3, 0)
        except Exception:
            return img

    def _normalize_brightness(self, img: np.ndarray) -> np.ndarray:
        try:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            mean = float(np.mean(gray))
            if abs(mean - 128) < 20:
                return img
            factor = 128.0 / (mean + 1e-6)
            return np.clip(img.astype(np.float32) * factor, 0, 255).astype(np.uint8)
        except Exception:
            return img

    def decode_base64_image(self, b64_string: str) -> np.ndarray:
        try:
            if "," in b64_string:
                b64_string = b64_string.split(",")[1]
            img_bytes = base64.b64decode(b64_string)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("Cannot decode image from base64")
            return img
        except Exception as e:
            raise ValueError(f"Base64 decode failed: {e}")
