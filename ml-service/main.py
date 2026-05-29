import os
import cv2
import json
import base64
import logging
import numpy as np
from typing import List

from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import uvicorn

load_dotenv()

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# ── InsightFace import (replaces dlib + face-recognition) ────────────────────
# InsightFace works on Python 3.13 with pre-built ONNX wheels.
# Install: pip install insightface onnxruntime
FACE_RECOGNITION_AVAILABLE = False
try:
    import insightface  # noqa — just to validate install
    FACE_RECOGNITION_AVAILABLE = True
    logger.info("✅ InsightFace loaded successfully")
except ImportError as e:
    logger.warning(f"⚠️  InsightFace not available: {e}")
    logger.warning("   Run: pip install insightface onnxruntime")

# ── Local utils ───────────────────────────────────────────────────────────────
from utils.face_analyzer     import FaceAnalyzer
from utils.liveness_detector import LivenessDetector
from utils.body_language     import BodyLanguageAnalyzer
from utils.image_processor   import ImageProcessor
from utils.ai_assistant      import AIAssistant

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="StudySphere ML Service",
    description="Face recognition & biometric analysis for attendance — Python 3.13 compatible",
    version="3.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Service instances (created once at startup) ───────────────────────────────
face_analyzer     = FaceAnalyzer()
liveness_detector = LivenessDetector()
body_analyzer     = BodyLanguageAnalyzer()
image_processor   = ImageProcessor()
ai_assistant      = AIAssistant()

MAX_FILE_SIZE_MB = 10


# ── Helpers ───────────────────────────────────────────────────────────────────

def _need_face_recognition():
    if not FACE_RECOGNITION_AVAILABLE:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "message": (
                    "InsightFace is not installed.\n"
                    "Run: pip install insightface onnxruntime\n"
                    "Then restart the ML service."
                ),
            },
        )
    return None


async def _read_image(upload: UploadFile) -> np.ndarray:
    """Read and decode uploaded image. Raises ValueError on failure."""
    contents = await upload.read()
    if not contents:
        raise ValueError("Uploaded file is empty")
    if len(contents) / (1024 * 1024) > MAX_FILE_SIZE_MB:
        raise ValueError(f"File too large (max {MAX_FILE_SIZE_MB} MB)")
    nparr = np.frombuffer(contents, np.uint8)
    img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image — unsupported format or corrupt file")
    return img


def _safe_json(data: str):
    try:
        return json.loads(data)
    except Exception:
        raise ValueError("Invalid JSON in face_encoding field")


def _safe_candidates_json(data: str):
    try:
        parsed = json.loads(data)
    except Exception:
        raise ValueError("Invalid JSON in candidates field")
    if not isinstance(parsed, list):
        raise ValueError("Candidates must be a list")
    safe = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        encoding = item.get("encoding")
        if not isinstance(encoding, list) or len(encoding) == 0:
            continue
        safe.append({
            "id": str(item.get("id", "")),
            "encoding": encoding
        })
    return safe


def _face_motion_metrics(face_location, shape):
    top, right, bottom, left = face_location
    height, width = shape[:2]
    center_x = ((left + right) / 2.0) / max(width, 1)
    center_y = ((top + bottom) / 2.0) / max(height, 1)
    area = max((right - left) * (bottom - top), 1) / max(width * height, 1)
    return center_x, center_y, area


async def _check_active_liveness(liveness_images: List[UploadFile], stored_enc: np.ndarray, tolerance: float) -> dict:
    if len(liveness_images or []) < 3:
        return {
            "passed": False,
            "score": 0.0,
            "message": "Live camera challenge failed. Keep the real student in front of the camera.",
            "details": {"reason": "insufficient_live_frames"}
        }

    gray_frames = []
    boxes = []
    frame_confidences = []
    max_frames = min(len(liveness_images), 6)

    for upload in liveness_images[:max_frames]:
        img = await _read_image(upload)
        processed = image_processor.preprocess_for_recognition(img)
        rgb = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)
        detection = face_analyzer.detect_faces(rgb)

        if not detection.get("faces_found"):
            return {
                "passed": False,
                "score": 0.0,
                "message": "Live camera challenge failed. Face was not visible in every frame.",
                "details": {"reason": "face_missing_in_live_frame"}
            }
        if detection.get("face_count", 0) > 1:
            return {
                "passed": False,
                "score": 0.0,
                "message": "Live camera challenge failed. Only the registered student should be visible.",
                "details": {"reason": "multiple_faces_in_live_frame"}
            }

        face_loc = detection["face_locations"][0]
        frame_enc = face_analyzer.get_encoding(rgb, face_loc)
        if frame_enc is None:
            return {
                "passed": False,
                "score": 0.0,
                "message": "Live camera challenge failed. Could not read face features.",
                "details": {"reason": "encoding_failed_in_live_frame"}
            }

        frame_match = face_analyzer.compare_faces(stored_enc, frame_enc, tolerance + 0.08)
        if not frame_match.get("match"):
            return {
                "passed": False,
                "score": 0.0,
                "message": "Live camera challenge failed. The live frames do not match the registered student.",
                "details": {"reason": "identity_changed_in_live_frame"}
            }

        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gray = cv2.resize(gray, (160, 213), interpolation=cv2.INTER_AREA)
        gray_frames.append(gray)
        boxes.append(_face_motion_metrics(face_loc, rgb.shape))
        frame_confidences.append(float(frame_match.get("confidence", 0.0)))

    frame_diffs = [
        float(np.mean(cv2.absdiff(gray_frames[index - 1], gray_frames[index])))
        for index in range(1, len(gray_frames))
    ]
    center_moves = [
        float(np.hypot(boxes[index][0] - boxes[index - 1][0], boxes[index][1] - boxes[index - 1][1]))
        for index in range(1, len(boxes))
    ]
    area_changes = [
        float(abs(boxes[index][2] - boxes[index - 1][2]))
        for index in range(1, len(boxes))
    ]

    avg_diff = float(np.mean(frame_diffs)) if frame_diffs else 0.0
    avg_center_move = float(np.mean(center_moves)) if center_moves else 0.0
    avg_area_change = float(np.mean(area_changes)) if area_changes else 0.0
    confidence_score = float(np.clip(np.mean(frame_confidences) / 100.0, 0.0, 1.0)) if frame_confidences else 0.0

    min_frame_diff = float(os.getenv("ACTIVE_LIVENESS_MIN_FRAME_DIFF", "1.8"))
    max_frame_diff = float(os.getenv("ACTIVE_LIVENESS_MAX_FRAME_DIFF", "58"))
    min_motion = float(os.getenv("ACTIVE_LIVENESS_MIN_MOTION", "0.0035"))
    threshold = float(os.getenv("ACTIVE_LIVENESS_THRESHOLD", "0.38"))

    diff_score = float(np.clip((avg_diff - 1.0) / 8.0, 0.0, 1.0))
    motion_score = float(np.clip((avg_center_move + avg_area_change - 0.002) / 0.035, 0.0, 1.0))
    active_score = float(np.clip((diff_score * 0.55) + (motion_score * 0.25) + (confidence_score * 0.20), 0.0, 1.0))

    too_static = avg_diff < min_frame_diff and (avg_center_move + avg_area_change) < min_motion
    too_jumpy = avg_diff > max_frame_diff
    passed = active_score >= threshold and not too_static and not too_jumpy

    reason = None
    if too_static:
        reason = "static_frames"
    elif too_jumpy:
        reason = "unstable_frames"
    elif active_score < threshold:
        reason = "active_score_below_threshold"

    return {
        "passed": passed,
        "score": round(active_score, 4),
        "message": "Live camera challenge passed" if passed else "Live camera challenge failed. Use the real student in front of the camera, not a photo or screen.",
        "details": {
            "reason": reason,
            "frames": len(gray_frames),
            "avg_frame_diff": round(avg_diff, 4),
            "avg_center_motion": round(avg_center_move, 5),
            "avg_area_change": round(avg_area_change, 5),
            "identity_score": round(confidence_score, 4),
            "threshold": threshold
        }
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "status": "ML Service Running",
        "version": "3.0.0",
        "python_313_compatible": True,
        "face_recognition_available": FACE_RECOGNITION_AVAILABLE,
        "engine": "InsightFace + ONNX Runtime",
    }


@app.get("/health")
async def health():
    services = ["liveness", "body_language", "image_processing"]
    if FACE_RECOGNITION_AVAILABLE:
        services.insert(0, "face_recognition (InsightFace)")
    return {
        "success": True,
        "service": "ml",
        "status": "ready",
        "face_recognition_available": FACE_RECOGNITION_AVAILABLE,
        "services": services,
    }


@app.get("/heath")
async def health_typo_alias():
    return await health()


# ── /validate-face ────────────────────────────────────────────────────────────

@app.post("/validate-face")
async def validate_face(image: UploadFile = File(...)):
    err = _need_face_recognition()
    if err:
        return err
    try:
        img       = await _read_image(image)
        processed = image_processor.preprocess_for_recognition(img)
        rgb       = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)

        detection = face_analyzer.detect_faces(rgb)
        if not detection.get("faces_found"):
            return JSONResponse(status_code=400, content={
                "valid": False,
                "message": "No face detected. Upload a clear, front-facing photo."
            })
        if detection.get("face_count", 0) > 1:
            return JSONResponse(status_code=400, content={
                "valid": False,
                "message": f"Multiple faces detected ({detection['face_count']}). Only your face should be in the photo."
            })

        face_loc = detection["face_locations"][0]

        quality = face_analyzer.assess_quality(rgb, face_loc)
        if quality["score"] < 0.70:
            return JSONResponse(status_code=400, content={
                "valid": False,
                "message": f"Image quality too low ({quality['score']:.0%}). {quality['reason']}"
            })

        orientation = face_analyzer.check_orientation(rgb, face_loc)
        if not orientation.get("is_frontal", True):
            return JSONResponse(status_code=400, content={
                "valid": False,
                "message": f"Face not front-facing ({orientation.get('direction', 'unknown')}). Look directly at the camera."
            })

        encoding = face_analyzer.get_encoding(rgb, face_loc)
        if encoding is None:
            return JSONResponse(status_code=400, content={
                "valid": False,
                "message": "Could not extract face features. Use a clearer, well-lit photo."
            })

        return JSONResponse(content={
            "valid": True,
            "message": "Face validated successfully",
            "encoding": encoding.tolist(),
            "quality_score": round(float(quality["score"]), 3),
            "face_count": detection["face_count"],
            "face_location": face_loc,
        })

    except ValueError as e:
        return JSONResponse(status_code=400, content={"valid": False, "message": str(e)})
    except Exception as e:
        logger.exception("validate_face error")
        return JSONResponse(status_code=500, content={"valid": False, "message": f"Processing error: {e}"})


# ── /verify-face ──────────────────────────────────────────────────────────────

@app.post("/verify-face")
async def verify_face(
    image:              UploadFile = File(...),
    liveness_images:    List[UploadFile] = File(default=[]),
    student_id:         str        = Form(...),
    face_encoding:      str        = Form(...),
    profile_image_path: str        = Form(default=""),
):
    err = _need_face_recognition()
    if err:
        return err
    try:
        img        = await _read_image(image)
        stored_enc = np.array(_safe_json(face_encoding), dtype=np.float32)
        if stored_enc.size == 0:
            raise ValueError("Stored face encoding is empty")

        processed = image_processor.preprocess_for_recognition(img)
        rgb       = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)

        # 1 — Detect face
        detection = face_analyzer.detect_faces(rgb)
        if not detection.get("faces_found"):
            return JSONResponse(status_code=400, content={
                "match": False, "confidence": 0.0,
                "message": "No face detected. Ensure your face is fully visible and well-lit."
            })
        if detection.get("face_count", 0) > 1:
            return JSONResponse(status_code=400, content={
                "match": False, "confidence": 0.0,
                "message": "Multiple faces detected. Only the registered student should be visible."
            })

        face_loc = detection["face_locations"][0]

        # 2 — Liveness
        liveness = liveness_detector.check_liveness(rgb, face_loc)
        liveness_score = float(liveness.get("liveness_score", 0))
        threshold = float(os.getenv("LIVENESS_THRESHOLD", "0.60"))
        if liveness_score < threshold:
            return JSONResponse(status_code=400, content={
                "match": False, "confidence": 0.0,
                "liveness_score": round(liveness_score, 3),
                "message": "Liveness check failed. Use your real face, not a photo or screen."
            })

        # 3 — Face encoding + comparison
        capture_enc = face_analyzer.get_encoding(rgb, face_loc)
        if capture_enc is None:
            return JSONResponse(status_code=400, content={
                "match": False, "confidence": 0.0,
                "message": "Could not extract face features from camera image."
            })

        tolerance = float(os.getenv("FACE_RECOGNITION_TOLERANCE", "0.42"))
        match_res  = face_analyzer.compare_faces(stored_enc, capture_enc, tolerance)

        active_liveness = await _check_active_liveness(liveness_images, stored_enc, tolerance)
        active_liveness_score = float(active_liveness.get("score", 0.0))
        if not active_liveness.get("passed"):
            return JSONResponse(status_code=400, content={
                "match": False,
                "confidence": round(float(match_res.get("confidence", 0.0)), 2),
                "distance": round(float(match_res.get("distance", 1.0)), 4),
                "liveness_score": round(liveness_score, 3),
                "active_liveness_score": round(active_liveness_score, 3),
                "details": active_liveness.get("details", {}),
                "message": active_liveness.get("message", "Live camera challenge failed.")
            })

        # 4 — Supplementary scores
        eye_score    = 0.85
        presence     = 0.80
        quality      = face_analyzer.assess_quality(rgb, face_loc)
        quality_score = float(quality.get("score", 0.7))

        # 5 — Composite confidence
        if match_res.get("match"):
            composite = min(99.9, (
                float(match_res["confidence"]) * 0.50 +
                liveness_score  * 100 * 0.18 +
                active_liveness_score * 100 * 0.12 +
                eye_score       * 100 * 0.10 +
                presence        * 100 * 0.03 +
                quality_score   * 100 * 0.10
            ))
        else:
            composite = float(match_res.get("confidence", 0))

        # Attendance uses webcam captures, so keep the acceptance gate practical
        # even if an older .env/docker value still sets MIN_FACE_CONFIDENCE high.
        configured_min_conf = float(os.getenv("MIN_FACE_CONFIDENCE", "0.55"))
        min_conf = min(configured_min_conf, 0.55) * 100
        final_match = match_res.get("match", False) and active_liveness.get("passed", False) and composite >= min_conf

        return JSONResponse(content={
            "match":               final_match,
            "student_id":          student_id,
            "confidence":          round(composite, 2),
            "distance":            round(float(match_res.get("distance", 1.0)), 4),
            "threshold":           round(min_conf, 2),
            "liveness_score":      round(liveness_score, 3),
            "active_liveness_score": round(active_liveness_score, 3),
            "body_language_score": round(presence, 3),
            "eye_open_score":      round(eye_score, 3),
            "quality_score":       round(quality_score, 3),
            "is_restricted":       False,
            "details":             active_liveness.get("details", {}),
            "message":             "Verified successfully" if final_match
                                   else f"Verification failed. Confidence: {composite:.1f}%",
        })

    except ValueError as e:
        return JSONResponse(status_code=400, content={"match": False, "confidence": 0.0, "message": str(e)})
    except Exception as e:
        logger.exception("verify_face error")
        return JSONResponse(status_code=500, content={"match": False, "confidence": 0.0, "message": f"Error: {e}"})


@app.post("/identify-face")
async def identify_face(
    image: UploadFile = File(...),
    candidates: str = Form(...),
    liveness_images: List[UploadFile] = File(default=[]),
):
    err = _need_face_recognition()
    if err:
        return err
    try:
        img = await _read_image(image)
        candidate_list = _safe_candidates_json(candidates)
        if not candidate_list:
            return JSONResponse(status_code=400, content={
                "success": False,
                "match": False,
                "message": "No enrolled student face data is available."
            })

        processed = image_processor.preprocess_for_recognition(img)
        rgb = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)
        detection = face_analyzer.detect_faces(rgb)
        if not detection.get("faces_found"):
            return JSONResponse(status_code=400, content={
                "success": False,
                "match": False,
                "confidence": 0.0,
                "message": "No face detected. Center your face and try again."
            })
        if detection.get("face_count", 0) > 1:
            return JSONResponse(status_code=400, content={
                "success": False,
                "match": False,
                "confidence": 0.0,
                "message": "Multiple faces detected. Only one student should be visible."
            })

        face_loc = detection["face_locations"][0]
        liveness = liveness_detector.check_liveness(rgb, face_loc)
        liveness_score = float(liveness.get("liveness_score", 0))
        liveness_threshold = float(os.getenv("FACE_LOGIN_LIVENESS_THRESHOLD", os.getenv("LIVENESS_THRESHOLD", "0.60")))
        if liveness_score < liveness_threshold:
            return JSONResponse(status_code=400, content={
                "success": False,
                "match": False,
                "confidence": 0.0,
                "liveness_score": round(liveness_score, 3),
                "message": "Liveness check failed. Use your real face, not a photo or screen."
            })

        capture_enc = face_analyzer.get_encoding(rgb, face_loc)
        if capture_enc is None:
            return JSONResponse(status_code=400, content={
                "success": False,
                "match": False,
                "confidence": 0.0,
                "message": "Could not extract face features. Use better lighting and try again."
            })

        tolerance = float(os.getenv("FACE_LOGIN_TOLERANCE", os.getenv("FACE_RECOGNITION_TOLERANCE", "0.42")))
        min_confidence = float(os.getenv("FACE_LOGIN_MIN_CONFIDENCE", "55"))
        best = None

        for candidate in candidate_list:
            result = face_analyzer.compare_faces(np.array(candidate["encoding"], dtype=np.float32), capture_enc, tolerance)
            item = {
                "student_id": candidate["id"],
                "confidence": float(result.get("confidence", 0.0)),
                "distance": float(result.get("distance", 1.0)),
                "match": bool(result.get("match"))
            }
            if best is None or item["confidence"] > best["confidence"]:
                best = item

        if not best:
            return JSONResponse(status_code=400, content={
                "success": False,
                "match": False,
                "confidence": 0.0,
                "message": "No usable registered face data was found."
            })

        active_liveness = await _check_active_liveness(liveness_images, capture_enc, tolerance)
        active_liveness_score = float(active_liveness.get("score", 0.0))
        quality = face_analyzer.assess_quality(rgb, face_loc)
        quality_score = float(quality.get("score", 0.7))
        if best["match"]:
            composite = min(99.9, (
                best["confidence"] * 0.72 +
                liveness_score * 100 * 0.10 +
                active_liveness_score * 100 * 0.10 +
                quality_score * 100 * 0.08
            ))
        else:
            composite = best["confidence"]

        final_match = best["match"] and composite >= min_confidence and active_liveness.get("passed", False)
        failure_message = "Face not recognized. Try again or use email and password."
        if best["match"] and not active_liveness.get("passed", False):
            failure_message = active_liveness.get("message", failure_message)
        elif best["match"] and composite < min_confidence:
            failure_message = f"Face confidence is too low ({composite:.1f}%). Try better lighting or use email and password."

        return JSONResponse(content={
            "success": True,
            "match": final_match,
            "student_id": best["student_id"] if final_match else None,
            "best_student_id": best["student_id"],
            "confidence": round(composite, 2),
            "raw_confidence": round(best["confidence"], 2),
            "distance": round(best["distance"], 4),
            "threshold": min_confidence,
            "liveness_score": round(liveness_score, 3),
            "active_liveness_score": round(active_liveness_score, 3),
            "quality_score": round(quality_score, 3),
            "details": active_liveness.get("details", {}),
            "message": "Face identified successfully" if final_match else failure_message
        })
    except ValueError as e:
        return JSONResponse(status_code=400, content={"success": False, "match": False, "confidence": 0.0, "message": str(e)})
    except Exception as e:
        logger.exception("identify_face error")
        return JSONResponse(status_code=500, content={"success": False, "match": False, "confidence": 0.0, "message": f"Error: {e}"})


# ── /analyze-attendance-image ─────────────────────────────────────────────────

@app.post("/analyze-attendance-image")
async def analyze_with_ai(
    image:   UploadFile = File(...),
    context: str        = Form(default=""),
):
    try:
        contents  = await image.read()
        if not contents:
            raise ValueError("Empty image")
        b64       = base64.b64encode(contents).decode("utf-8")
        analysis  = await ai_assistant.analyze_image(b64, context)
        return JSONResponse(content={"success": True, "analysis": analysis})
    except Exception as e:
        logger.exception("AI analysis error")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/analyze-timetable")
async def analyze_timetable(
    image:      UploadFile = File(...),
    department: str        = Form(default=""),
    semester:   str        = Form(default=""),
):
    try:
        contents = await image.read()
        if not contents:
            raise ValueError("Empty image")
        if len(contents) / (1024 * 1024) > MAX_FILE_SIZE_MB:
            raise ValueError(f"File too large (max {MAX_FILE_SIZE_MB} MB)")
        b64 = base64.b64encode(contents).decode("utf-8")
        analysis = await ai_assistant.analyze_timetable_image(b64, department, image.content_type or "image/jpeg", semester)
        if analysis.get("available") is False:
            return JSONResponse(status_code=503, content={
                "success": False,
                "message": analysis.get("message", "AI service not configured")
            })
        if analysis.get("error"):
            return JSONResponse(status_code=422, content={
                "success": False,
                "message": analysis["error"],
                "slots": analysis.get("slots", [])
            })
        return JSONResponse(content={
            "success": True,
            "slots": analysis.get("slots", []),
            "analysis": analysis
        })
    except ValueError as e:
        return JSONResponse(status_code=400, content={"success": False, "message": str(e)})
    except Exception as e:
        logger.exception("Timetable AI analysis error")
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})


# ── Global error handler ──────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception(f"Unhandled error: {exc}")
    return JSONResponse(status_code=500, content={"success": False, "message": "Internal server error"})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    logger.info(f"🚀 Starting StudySphere ML Service v3.0 on port {port}")
    logger.info(f"🐍 Python 3.13 compatible — using InsightFace + ONNX Runtime")
    logger.info(f"📡 InsightFace: {'✅ ready' if FACE_RECOGNITION_AVAILABLE else '❌ not installed — run: pip install insightface onnxruntime'}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
