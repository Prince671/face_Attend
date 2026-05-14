import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Webcam from 'react-webcam';
import toast from 'react-hot-toast';
import { Camera, CheckCircle, XCircle, AlertCircle, RefreshCw, Send, Lock } from 'lucide-react';
import { attendanceAPI, studentAPI, subjectAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';

const STEPS = { CODE: 'code', CAMERA: 'camera', VERIFYING: 'verifying', SUCCESS: 'success', ERROR: 'error' };
const AUTO_CAPTURE_READY_FRAMES = 2;
const ML_GUIDE_PROBE_BACKOFF_MS = 5000;
const PASSPORT_WIDTH = 480;
const PASSPORT_HEIGHT = 640;
const CAPTURE_QUALITY = 0.78;
const LIVENESS_FRAME_COUNT = 4;
const LIVENESS_FRAME_INTERVAL_MS = 260;
const CAMERA_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 640, max: 640 },
  height: { ideal: 480, max: 480 },
  frameRate: { ideal: 15, max: 24 }
};

const sortLecturesByDateAsc = (items = []) => [...items].sort((a, b) => {
  const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

export default function MarkAttendance() {
  const webcamRef = useRef(null);
  const autoCaptureFrames = useRef(0);
  const autoCaptureTimer = useRef(null);
  const cameraRetryTimer = useRef(null);
  const lastFaceBox = useRef(null);
  const captureInProgress = useRef(false);
  const guideProbeInProgress = useRef(false);
  const mlProbeBackoffUntil = useRef(0);
  const [step, setStep] = useState(STEPS.CODE);
  const [code, setCode] = useState('');
  const [lectureId, setLectureId] = useState('');
  const [openLectures, setOpenLectures] = useState([]);
  const [capturedImage, setCapturedImage] = useState(null);
  const [livenessFrameImages, setLivenessFrameImages] = useState([]);
  const [result, setResult] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraRequestKey, setCameraRequestKey] = useState(0);
  const [selectedLecture, setSelectedLecture] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [autoCaptureStatus, setAutoCaptureStatus] = useState('Align your face inside the oval');
  const [autoCaptureReady, setAutoCaptureReady] = useState(false);
  const [autoCaptureAvailable, setAutoCaptureAvailable] = useState(true);
  const [autoSubmitAfterCapture, setAutoSubmitAfterCapture] = useState(false);

  useEffect(() => {
    studentAPI.getDashboard().then(r => {
      setOpenLectures(sortLecturesByDateAsc(r.data.openLectures || []));
    }).catch(() => {});
    subjectAPI.getMine().then(r => setSubjects(r.data.subjects)).catch(() => {});
  }, []);

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

  const capture = useCallback(async (automatic = false, faceBox = null) => {
    if (captureInProgress.current) return;
    captureInProgress.current = true;
    try {
      setAutoCaptureStatus('Capturing live verification frames...');
      const frames = await collectLiveFrames(faceBox);
      const imageSrc = frames[0] || getPassportCropFromVideo(faceBox);
      if (imageSrc) {
        setCapturedImage(imageSrc);
        setLivenessFrameImages(frames);
        setAutoCaptureReady(false);
        if (automatic) {
          setAutoSubmitAfterCapture(true);
          toast.success('Live face captured automatically');
        }
      }
    } finally {
      captureInProgress.current = false;
    }
  }, [collectLiveFrames, getPassportCropFromVideo]);

  const imageToFile = useCallback((imageSrc, filename = 'attendance_capture.jpg') => {
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

  const probeGuideFaceWithML = useCallback(async () => {
    if (Date.now() < mlProbeBackoffUntil.current) {
      return { ready: false, message: 'Face service is warming up. Hold your face steady...' };
    }
    if (guideProbeInProgress.current) return { pending: true, ready: false };

    const guideFrame = getPassportCropFromVideo();
    if (!guideFrame) return { ready: false, message: 'Camera frame is not ready yet' };

    guideProbeInProgress.current = true;
    try {
      const file = await imageToFile(guideFrame, 'guide_frame.jpg');
      const formData = new FormData();
      formData.append('guideFrame', file);
      const response = await attendanceAPI.detectGuideFace(formData);
      return response.data || { ready: false, message: 'Move your face into the oval' };
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

  const retake = () => {
    setCapturedImage(null);
    setLivenessFrameImages([]);
    autoCaptureFrames.current = 0;
    setAutoCaptureReady(false);
    setAutoCaptureStatus('Align your face inside the oval');
    setAutoSubmitAfterCapture(false);
  };

  const requestCameraAgain = useCallback(() => {
    setCameraReady(false);
    setCameraError('');
    setCameraRequestKey(key => key + 1);
  }, []);

  const handleCameraReady = useCallback(() => {
    setCameraReady(true);
    setCameraError('');
    if (cameraRetryTimer.current) window.clearTimeout(cameraRetryTimer.current);
    cameraRetryTimer.current = null;
  }, []);

  const handleCameraError = useCallback((error) => {
    const message = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
      ? 'Camera permission is denied. Allow camera access to continue.'
      : 'Camera is unavailable. Check that no other app is using it.';
    setCameraReady(false);
    setCameraError(message);
    setAutoCaptureReady(false);
    setAutoCaptureStatus('Camera access is required before auto capture can start');
    toast.error(message);
  }, []);

  useEffect(() => {
    if (step !== STEPS.CAMERA || cameraReady || !cameraError || capturedImage) {
      if (cameraRetryTimer.current) window.clearTimeout(cameraRetryTimer.current);
      cameraRetryTimer.current = null;
      return;
    }

    cameraRetryTimer.current = window.setTimeout(() => {
      requestCameraAgain();
    }, 5000);

    return () => {
      if (cameraRetryTimer.current) window.clearTimeout(cameraRetryTimer.current);
      cameraRetryTimer.current = null;
    };
  }, [cameraError, cameraReady, capturedImage, requestCameraAgain, step]);

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

  useEffect(() => {
    if (step !== STEPS.CAMERA || !cameraReady || capturedImage) {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
      return;
    }

    const FaceDetector = window.FaceDetector;
    const detector = FaceDetector ? new FaceDetector({ fastMode: true, maxDetectedFaces: 1 }) : null;
    setAutoCaptureAvailable(true);
    if (!detector) {
      setAutoCaptureStatus('Move your face inside the oval');
    }

    const detectionIntervalMs = detector ? 300 : 1800;
    autoCaptureTimer.current = window.setInterval(async () => {
      const video = webcamRef.current?.video;
      if (!video || video.readyState < 2 || capturedImage || captureInProgress.current) return;

      if (!detector) {
        const probe = await probeGuideFaceWithML();
        if (probe.pending) return;
        if (!probe.ready) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus(probe.message || 'Move your face into the oval');
          return;
        }

        autoCaptureFrames.current += 1;
        setAutoCaptureReady(true);
        setAutoCaptureStatus('Face detected inside the oval. Hold still...');
        if (autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          capture(true);
        }
        return;
      }

      try {
        const faces = await detector.detect(video);
        if (faces.length !== 1) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus(faces.length > 1 ? 'Only one face should be visible' : 'Move your face into the oval');
          lastFaceBox.current = null;
          return;
        }

        lastFaceBox.current = faces[0].boundingBox;
        const { ready, centered, sizeOk } = isFaceInsideGuide(faces[0].boundingBox, video);
        if (!centered) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus('Center your face inside the oval');
          return;
        }
        if (!sizeOk) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus('Move slightly closer or farther from the camera');
          return;
        }

        autoCaptureFrames.current += 1;
        setAutoCaptureReady(true);
        setAutoCaptureStatus('Hold still. Capturing...');
        if (ready && autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          capture(true, faces[0].boundingBox);
        }
      } catch {
        const probe = await probeGuideFaceWithML();
        if (probe.pending) return;
        setAutoCaptureAvailable(true);
        if (!probe.ready) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus(probe.message || 'Move your face into the oval');
          return;
        }

        autoCaptureFrames.current += 1;
        setAutoCaptureReady(true);
        setAutoCaptureStatus('Face detected inside the oval. Hold still...');
        if (autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          capture(true);
        }
      }
    }, detectionIntervalMs);

    return () => {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
    };
  }, [cameraReady, capture, capturedImage, isFaceInsideGuide, probeGuideFaceWithML, step]);

  const handleCodeSubmit = (e) => {
    e.preventDefault();
    if (code.length !== 6) { toast.error('Enter a valid 6-digit code'); return; }
    if (!lectureId) { toast.error('Please select a lecture or enter a lecture'); return; }
    setCameraReady(false);
    setCameraError('');
    setCameraRequestKey(key => key + 1);
    setStep(STEPS.CAMERA);
  };

  const handleSubmitAttendance = async () => {
    if (!capturedImage) { toast.error('Please capture your photo'); return; }
    if (livenessFrameImages.length < 3) {
      toast.error('Live camera verification frames are missing. Please retake from the camera.');
      retake();
      return;
    }
    setStep(STEPS.VERIFYING);

    try {
      const file = await imageToFile(capturedImage);
      const liveFiles = await Promise.all(
        livenessFrameImages.map((frame, index) => imageToFile(frame, `liveness_frame_${index + 1}.jpg`))
      );

      const formData = new FormData();
      formData.append('lectureId', lectureId);
      formData.append('attendanceCode', code);
      formData.append('faceCapture', file);
      liveFiles.forEach(fileItem => formData.append('livenessFrames', fileItem));

      const response = await attendanceAPI.mark(formData);
      if (!response.data?.success) {
        setResult(response.data || { message: 'Verification failed' });
        setStep(STEPS.ERROR);
        return;
      }
      setResult(response.data);
      setStep(STEPS.SUCCESS);
    } catch (err) {
      const errorData = err.response?.data || { message: 'Verification failed' };
      setResult(errorData);
      toast.error(errorData.message || 'Attendance could not be marked');
      setStep(STEPS.ERROR);
    }
  };

  useEffect(() => {
    if (!autoSubmitAfterCapture || !capturedImage || step !== STEPS.CAMERA) return;
    setAutoSubmitAfterCapture(false);
    handleSubmitAttendance();
  }, [autoSubmitAfterCapture, capturedImage, step]);

  const reset = () => {
    setStep(STEPS.CODE);
    setCode('');
    setLectureId('');
    setCapturedImage(null);
    setLivenessFrameImages([]);
    setResult(null);
    setCameraReady(false);
    setCameraError('');
    setSelectedLecture(null);
    autoCaptureFrames.current = 0;
    setAutoCaptureReady(false);
    setAutoCaptureStatus('Align your face inside the oval');
    setAutoSubmitAfterCapture(false);
    lastFaceBox.current = null;
  };

  return (
    <div className="space-y-5 sm:space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Mark Attendance</h1>
        <p className="text-slate-400 mt-1">Use your face and the session code to mark attendance</p>
      </div>

      <AdminBreadcrumb items={[
        { label: 'Student Portal' },
        { label: 'Attendance' },
        selectedLecture?.subject?.name && { label: selectedLecture.subject.name }
      ]} />

      {/* Open lectures quick select */}
      {openLectures.length > 0 && step === STEPS.CODE && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
          <p className="text-emerald-400 font-medium mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Open Attendance Sessions
          </p>
          <div className="space-y-2">
            {openLectures.map(lec => (
              <button key={lec._id} onClick={() => { setLectureId(lec._id); setSelectedLecture(lec); }}
                className={`w-full text-left p-3 rounded-xl border transition-all ${lectureId === lec._id ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 hover:border-white/20 bg-white/5'}`}>
                <p className="font-medium text-white text-sm">{lec.title}</p>
                <p className="text-slate-400 text-xs">{lec.subject?.name} · {lec.subject?.code}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="glass-card">
        <AnimatePresence mode="wait">
          {/* STEP 1: Enter Code */}
          {step === STEPS.CODE && (
            <motion.div key="code" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary-400" /> Enter Attendance Code
              </h2>
              <form onSubmit={handleCodeSubmit} className="space-y-4">
                {!selectedLecture && (
                  <div>
                    <label className="label">Select Subject / Lecture</label>
                    <select className="input-field" value={lectureId} onChange={e => setLectureId(e.target.value)}>
                      <option value="">Select lecture...</option>
                      {openLectures.map(l => <option key={l._id} value={l._id}>{l.subject?.name} – {l.title}</option>)}
                    </select>
                  </div>
                )}
                {selectedLecture && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <p className="text-emerald-400 text-sm font-medium">{selectedLecture.subject?.name} – {selectedLecture.title}</p>
                    <button type="button" onClick={() => { setSelectedLecture(null); setLectureId(''); }} className="text-slate-500 text-xs hover:text-white mt-1">Change</button>
                  </div>
                )}
                <div>
                  <label className="label">6-Digit Attendance Code *</label>
                  <input
                    className="input-field text-center text-2xl sm:text-3xl font-mono tracking-[0.35em] sm:tracking-[0.5em] font-bold"
                    placeholder="______"
                    maxLength={6}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                  <p className="text-slate-500 text-xs mt-1">Ask your teacher for the attendance code</p>
                </div>
                <button type="submit" disabled={code.length !== 6 || !lectureId} className="btn-primary w-full">
                  Continue to Face Verification →
                </button>
              </form>
            </motion.div>
          )}

          {/* STEP 2: Camera */}
          {step === STEPS.CAMERA && (
            <motion.div key="camera" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 className="font-semibold text-white mb-2 flex items-center gap-2">
                <Camera className="w-5 h-5 text-primary-400" /> Face Verification
              </h2>
              <p className="text-slate-400 text-sm mb-4">Look directly at the camera. Ensure good lighting and your face is fully visible.</p>

              <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] sm:aspect-video mb-4">
                {!capturedImage ? (
                  <>
                    <Webcam
                      key={cameraRequestKey}
                      ref={webcamRef}
                      audio={false}
                      screenshotFormat="image/jpeg"
                      screenshotQuality={CAPTURE_QUALITY}
                      className="w-full h-full object-cover"
                      onUserMedia={handleCameraReady}
                      onUserMediaError={handleCameraError}
                      videoConstraints={CAMERA_CONSTRAINTS}
                    />
                    {cameraReady && (
                      <>
                        <div className="camera-overlay" />
                        <div className="scan-line" />
                        {/* Face guide */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className={`w-40 h-48 border-2 rounded-[50%] transition-all duration-300 ${
                            autoCaptureReady
                              ? 'border-emerald-400/90 shadow-[0_0_28px_rgba(16,185,129,0.35)]'
                              : 'border-primary-400/60 opacity-70'
                          }`} />
                        </div>
                      </>
                    )}
                    {!cameraReady && !cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    {cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6">
                        <div className="max-w-sm text-center">
                          <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto mb-3">
                            <AlertCircle className="w-6 h-6 text-amber-300" />
                          </div>
                          <p className="text-white font-semibold">Camera Access Needed</p>
                          <p className="text-slate-400 text-sm mt-2">{cameraError}</p>
                          <p className="text-slate-500 text-xs mt-2">If your browser blocked it permanently, click the camera icon in the address bar and allow access.</p>
                          <button type="button" onClick={requestCameraAgain} className="btn-primary mt-4 inline-flex items-center justify-center gap-2">
                            <Camera className="w-4 h-4" /> Ask Again
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
                )}
              </div>

              {/* Tips */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 text-xs text-slate-400 text-center">
                {['Face centered', 'Good lighting', 'No sunglasses'].map(t => (
                  <div key={t} className="bg-white/5 rounded-lg p-2">{t}</div>
                ))}
              </div>
              {!capturedImage && (
                <div className={`mb-4 text-xs text-center rounded-lg p-2 border ${
                  autoCaptureReady
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-slate-400'
                }`}>
                  {autoCaptureStatus}
                  {!autoCaptureAvailable && <span className="text-slate-500"> Manual capture remains available.</span>}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={reset} className="btn-secondary flex-1">← Back</button>
                {!capturedImage ? (
                  <button onClick={() => capture(false)} disabled={!cameraReady || captureInProgress.current} className="btn-primary flex-1 flex items-center justify-center gap-2">
                    <Camera className="w-4 h-4" /> Capture Photo
                  </button>
                ) : (
                  <>
                    <button onClick={retake} className="btn-secondary flex items-center justify-center gap-2 px-4">
                      <RefreshCw className="w-4 h-4" /> Retake
                    </button>
                    <button onClick={handleSubmitAttendance} className="btn-primary flex-1 flex items-center justify-center gap-2">
                      <Send className="w-4 h-4" /> Submit
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 3: Verifying */}
          {step === STEPS.VERIFYING && (
            <motion.div key="verifying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-10">
              <div className="w-20 h-20 rounded-full border-4 border-primary-500/30 border-t-primary-500 animate-spin mx-auto mb-4" />
              <h2 className="font-semibold text-white text-xl">Verifying Identity</h2>
              <p className="text-slate-400 mt-2">Running face recognition analysis...</p>
              <div className="mt-4 space-y-2 text-sm text-slate-500">
                <p>🔍 Detecting face features...</p>
                <p>🧠 Comparing with registered profile...</p>
                <p>🛡️ Running liveness detection...</p>
              </div>
            </motion.div>
          )}

          {/* STEP 4: Success */}
          {step === STEPS.SUCCESS && (
            <motion.div key="success" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-8">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-emerald-400" />
              </div>
              <h2 className="font-display text-2xl font-bold text-white">Attendance Marked!</h2>
              <p className="text-slate-400 mt-2">{result?.message}</p>
              {result?.attendance && (
                <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm space-y-1">
                  <p className="text-emerald-400">Subject: {result.attendance.subject}</p>
                  <p className="text-emerald-400">Lecture: {result.attendance.lecture}</p>
                  <p className="text-emerald-400 font-mono">Face Confidence: {result.attendance.faceConfidence?.toFixed(1)}%</p>
                </div>
              )}
              <button onClick={reset} className="btn-secondary mt-6">Mark Another</button>
            </motion.div>
          )}

          {/* STEP 5: Error */}
          {step === STEPS.ERROR && (
            <motion.div key="error" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-8">
              <div className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500/40 flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-10 h-10 text-red-400" />
              </div>
              <h2 className="font-display text-2xl font-bold text-white">Verification Failed</h2>
              <p className="text-slate-400 mt-2">{result?.message || 'Face verification failed. Please try again.'}</p>
              {result?.restricted && (
                <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-sm font-semibold">Your account is restricted. Contact admin.</p>
                </div>
              )}
              {typeof result?.confidence === 'number' && (
                <p className="text-slate-500 text-sm mt-3">Face confidence: {result.confidence.toFixed(1)}%</p>
              )}
              {typeof result?.threshold === 'number' && (
                <p className="text-slate-500 text-xs mt-1">Required threshold: {result.threshold.toFixed(1)}%</p>
              )}
              <div className="flex flex-col sm:flex-row gap-3 mt-6 justify-center">
                <button onClick={reset} className="btn-secondary">Start Over</button>
                <button onClick={() => { setStep(STEPS.CAMERA); setCapturedImage(null); }} className="btn-primary">Try Again</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
