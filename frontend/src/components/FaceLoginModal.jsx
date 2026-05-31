import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Webcam from 'react-webcam';
import toast from 'react-hot-toast';
import { Camera, RefreshCw, ScanFace, X } from 'lucide-react';
import { authAPI } from '../services/api';
import DynamicFaceGuide from './DynamicFaceGuide';

const AUTO_CAPTURE_READY_FRAMES = 1;
const ML_GUIDE_PROBE_BACKOFF_MS = 5000;
const PASSPORT_WIDTH = 360;
const PASSPORT_HEIGHT = 480;
const CAPTURE_QUALITY = 0.72;
const LIVENESS_FRAME_COUNT = 3;
const LIVENESS_FRAME_INTERVAL_MS = 140;
const CAMERA_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 640, max: 640 },
  height: { ideal: 480, max: 480 },
  frameRate: { ideal: 15, max: 24 }
};

export default function FaceLoginModal({ open, onClose, onSuccess }) {
  const webcamRef = useRef(null);
  const autoCaptureTimer = useRef(null);
  const autoCaptureFrames = useRef(0);
  const captureInProgress = useRef(false);
  const guideProbeInProgress = useRef(false);
  const mlProbeBackoffUntil = useRef(0);
  const lastFaceBox = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [status, setStatus] = useState('Look at the camera and keep your face visible');
  const [detectedFaceBox, setDetectedFaceBox] = useState(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [requestKey, setRequestKey] = useState(0);

  const clampCrop = useCallback((crop, width, height) => {
    const next = { ...crop };
    if (next.x < 0) next.x = 0;
    if (next.y < 0) next.y = 0;
    if (next.x + next.width > width) next.x = Math.max(0, width - next.width);
    if (next.y + next.height > height) next.y = Math.max(0, height - next.height);
    return next;
  }, []);

  const getPassportCropFromVideo = useCallback((box) => {
    const video = webcamRef.current?.video;
    if (!video || video.readyState < 2) return webcamRef.current?.getScreenshot();

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const faceBox = box || lastFaceBox.current;
    let crop;

    if (faceBox) {
      const faceCenterX = faceBox.x + faceBox.width / 2;
      const faceCenterY = faceBox.y + faceBox.height / 2;
      let cropWidth = Math.max(faceBox.width * 2.35, faceBox.height * 1.35);
      let cropHeight = cropWidth * (PASSPORT_HEIGHT / PASSPORT_WIDTH);

      if (cropHeight > sourceHeight) {
        cropHeight = sourceHeight;
        cropWidth = cropHeight * (PASSPORT_WIDTH / PASSPORT_HEIGHT);
      }
      if (cropWidth > sourceWidth) {
        cropWidth = sourceWidth;
        cropHeight = cropWidth * (PASSPORT_HEIGHT / PASSPORT_WIDTH);
      }

      crop = clampCrop({
        x: faceCenterX - cropWidth / 2,
        y: faceCenterY - cropHeight * 0.38,
        width: cropWidth,
        height: cropHeight
      }, sourceWidth, sourceHeight);
    } else {
      const cropWidth = Math.min(sourceWidth, sourceHeight * (PASSPORT_WIDTH / PASSPORT_HEIGHT));
      const cropHeight = cropWidth * (PASSPORT_HEIGHT / PASSPORT_WIDTH);
      crop = clampCrop({
        x: (sourceWidth - cropWidth) / 2,
        y: (sourceHeight - cropHeight) / 2,
        width: cropWidth,
        height: cropHeight
      }, sourceWidth, sourceHeight);
    }

    const canvas = document.createElement('canvas');
    canvas.width = PASSPORT_WIDTH;
    canvas.height = PASSPORT_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, PASSPORT_WIDTH, PASSPORT_HEIGHT);
    return canvas.toDataURL('image/jpeg', CAPTURE_QUALITY);
  }, [clampCrop]);

  const imageToFile = useCallback((imageSrc, filename = 'face_login.jpg') => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = PASSPORT_WIDTH;
        canvas.height = PASSPORT_HEIGHT;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Could not prepare camera image'));
            return;
          }
          resolve(new File([blob], filename, { type: 'image/jpeg' }));
        }, 'image/jpeg', CAPTURE_QUALITY);
      };
      image.onerror = () => reject(new Error('Could not read camera image'));
      image.src = imageSrc;
    });
  }, []);

  const sleep = useCallback((ms) => new Promise(resolve => window.setTimeout(resolve, ms)), []);

  const collectLiveFrames = useCallback(async (faceBox = null) => {
    const frames = [];
    for (let index = 0; index < LIVENESS_FRAME_COUNT; index += 1) {
      if (index > 0) await sleep(LIVENESS_FRAME_INTERVAL_MS);
      const frame = getPassportCropFromVideo(faceBox || lastFaceBox.current);
      if (frame) frames.push(frame);
    }
    return frames;
  }, [getPassportCropFromVideo, sleep]);

  const probeGuideFaceWithML = useCallback(async () => {
    if (Date.now() < mlProbeBackoffUntil.current) {
      return { ready: false, message: 'Face service is warming up. Hold your face steady...' };
    }
    if (guideProbeInProgress.current) return { pending: true, ready: false };
    const guideFrame = getPassportCropFromVideo();
    if (!guideFrame) return { ready: false, message: 'Camera frame is not ready yet' };

    guideProbeInProgress.current = true;
    try {
      const file = await imageToFile(guideFrame, 'face_login_guide.jpg');
      const formData = new FormData();
      formData.append('guideFrame', file);
      const response = await authAPI.detectRegistrationFace(formData);
      return response.data || { ready: false, message: 'Move your face into the camera frame' };
    } catch (err) {
      if (err.response?.status === 503 || err.code === 'ERR_NETWORK') {
        mlProbeBackoffUntil.current = Date.now() + ML_GUIDE_PROBE_BACKOFF_MS;
      }
      return {
        ready: false,
        message: err.response?.data?.message || 'Checking face position...'
      };
    } finally {
      guideProbeInProgress.current = false;
    }
  }, [getPassportCropFromVideo, imageToFile]);

  const isFaceInsideGuide = useCallback((box, video) => {
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const centerX = width / 2;
    const centerY = height / 2;
    const radiusX = width * 0.12;
    const radiusY = height * 0.255;
    const faceCenterX = box.x + box.width / 2;
    const faceCenterY = box.y + box.height / 2;
    const centered =
      Math.abs(faceCenterX - centerX) <= radiusX * 0.45 &&
      Math.abs(faceCenterY - centerY) <= radiusY * 0.38;
    const sizeOk =
      box.width >= radiusX * 0.65 &&
      box.width <= radiusX * 1.8 &&
      box.height >= radiusY * 0.55 &&
      box.height <= radiusY * 1.75;
    return { centered, sizeOk, ready: centered && sizeOk };
  }, []);

  const submitFaceLogin = useCallback(async (faceBox = null) => {
    if (captureInProgress.current || submitting) return;
    captureInProgress.current = true;
    setSubmitting(true);
    setMatching(false);
    setReady(false);
    setStatus('Capturing live frames...');

    try {
      const frames = await collectLiveFrames(faceBox);
      if (frames.length < 3) throw new Error('Live camera frames are missing. Try again.');

      const formData = new FormData();
      formData.append('faceCapture', await imageToFile(frames[0], 'face_login.jpg'));
      for (let index = 0; index < frames.length; index += 1) {
        formData.append('livenessFrames', await imageToFile(frames[index], `face_login_live_${index}.jpg`));
      }

      setStatus('Matching your face with student records...');
      setMatching(true);
      const response = await authAPI.faceLogin(formData);
      onSuccess(response.data);
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Face login failed. Try again or use password.';
      setStatus(message);
      toast.error(message);
      autoCaptureFrames.current = 0;
      setRequestKey(key => key + 1);
    } finally {
      captureInProgress.current = false;
      setSubmitting(false);
      setMatching(false);
    }
  }, [collectLiveFrames, imageToFile, onSuccess, submitting]);

  const resetCamera = useCallback(() => {
    autoCaptureFrames.current = 0;
    lastFaceBox.current = null;
    setDetectedFaceBox(null);
    setReady(false);
    setCameraError('');
    setStatus('Look at the camera and keep your face visible');
    setRequestKey(key => key + 1);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setCameraReady(false);
    setCameraError('');
    setStatus('Look at the camera and keep your face visible');
    setDetectedFaceBox(null);
    setReady(false);
    setSubmitting(false);
    setMatching(false);
    autoCaptureFrames.current = 0;
    return () => {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !cameraReady || submitting) {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
      return undefined;
    }

    const FaceDetector = window.FaceDetector;
    const detector = FaceDetector ? new FaceDetector({ fastMode: true, maxDetectedFaces: 1 }) : null;
    if (!detector) setStatus('Move your face into the camera frame');

    const detectionIntervalMs = detector ? 180 : 1400;
    autoCaptureTimer.current = window.setInterval(async () => {
      const video = webcamRef.current?.video;
      if (!video || video.readyState < 2 || captureInProgress.current) return;

      if (!detector) {
        const probe = await probeGuideFaceWithML();
        if (probe.pending) return;
        if (!probe.ready) {
          autoCaptureFrames.current = 0;
          setReady(false);
          setStatus(probe.message || 'Move your face into the camera frame');
          return;
        }

        autoCaptureFrames.current += 1;
        setReady(true);
        setStatus('Face detected. Hold still...');
        if (autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          submitFaceLogin();
        }
        return;
      }

      try {
        const faces = await detector.detect(video);
        if (faces.length !== 1) {
          autoCaptureFrames.current = 0;
          lastFaceBox.current = null;
          setDetectedFaceBox(null);
          setReady(false);
          setStatus(faces.length > 1 ? 'Only one face should be visible' : 'Move your face into the camera frame');
          return;
        }

        const box = faces[0].boundingBox;
        lastFaceBox.current = box;
        setDetectedFaceBox(box);
        const gate = isFaceInsideGuide(box, video);
        if (!gate.centered) {
          autoCaptureFrames.current = 0;
          setReady(false);
          setStatus('Center your face in the camera frame');
          return;
        }
        if (!gate.sizeOk) {
          autoCaptureFrames.current = 0;
          setReady(false);
          setStatus('Move slightly closer or farther from the camera');
          return;
        }

        autoCaptureFrames.current += 1;
        setReady(true);
        setStatus('Face detected. Hold still...');
        if (gate.ready && autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          submitFaceLogin(box);
        }
      } catch {
        const probe = await probeGuideFaceWithML();
        if (probe.pending) return;
        if (!probe.ready) {
          autoCaptureFrames.current = 0;
          setReady(false);
          setStatus(probe.message || 'Move your face into the camera frame');
          return;
        }
        autoCaptureFrames.current += 1;
        setReady(true);
        setStatus('Face detected. Hold still...');
        if (autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          submitFaceLogin();
        }
      }
    }, detectionIntervalMs);

    return () => {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
    };
  }, [cameraReady, isFaceInsideGuide, open, probeGuideFaceWithML, submitFaceLogin, submitting]);

  const modal = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="app-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                  <ScanFace className="h-5 w-5 text-primary-400" /> Student Face ID
                </h3>
                <p className="mt-1 text-sm text-slate-400">Use your registered student profile face to sign in.</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
              <Webcam
                key={requestKey}
                ref={webcamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                screenshotQuality={CAPTURE_QUALITY}
                videoConstraints={CAMERA_CONSTRAINTS}
                mirrored
                className="aspect-[4/3] w-full object-cover"
                onUserMedia={() => { setCameraReady(true); setCameraError(''); }}
                onUserMediaError={(error) => {
                  const message = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
                    ? 'Camera permission denied. Allow camera access or use email and password.'
                    : 'Camera is unavailable. Check that no other app is using it.';
                  setCameraReady(false);
                  setCameraError(message);
                  setStatus(message);
                  toast.error(message);
                }}
              />
              <DynamicFaceGuide box={detectedFaceBox} videoRef={webcamRef} ready={ready} mirrored scanning={cameraReady && !matching} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent p-4">
                <p className={`text-sm font-medium ${ready ? 'text-emerald-300' : 'text-slate-200'}`}>{status}</p>
              </div>
              <AnimatePresence>
                {matching && (
                  <motion.div
                    className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/82 px-6 text-center backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <div className="relative mb-4 h-16 w-16">
                      <div className="absolute inset-0 rounded-full border-4 border-primary-400/20" />
                      <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary-300" />
                      <ScanFace className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-primary-200" />
                    </div>
                    <p className="text-base font-semibold text-white">Matching student records</p>
                    <p className="mt-1 text-sm text-slate-300">Checking your live face against registered profiles...</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={resetCamera} disabled={submitting} className="btn-secondary flex flex-1 items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
              <button type="button" onClick={() => submitFaceLogin(lastFaceBox.current)} disabled={!cameraReady || submitting || Boolean(cameraError)} className="btn-primary flex flex-1 items-center justify-center gap-2">
                {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Camera className="h-4 w-4" />}
                {submitting ? 'Verifying...' : 'Capture Now'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
