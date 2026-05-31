import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Webcam from 'react-webcam';
import toast from 'react-hot-toast';
import { BookOpen, Camera, CheckCircle, XCircle, AlertCircle, RefreshCw, Send, Lock } from 'lucide-react';
import { attendanceAPI, studentAPI, subjectAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { useSocket } from '../../context/SocketContext';
import { SkeletonLine } from '../../components/LoadingStates';
import DynamicFaceGuide from '../../components/DynamicFaceGuide';

const STEPS = { CODE: 'code', CAMERA: 'camera', VERIFYING: 'verifying', SUCCESS: 'success', ERROR: 'error' };
const AUTO_CAPTURE_READY_FRAMES = 2;
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

const sortLecturesByDateAsc = (items = []) => [...items].sort((a, b) => {
  const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

export default function MarkAttendance() {
  const { socket } = useSocket();
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
  const [autoCaptureStatus, setAutoCaptureStatus] = useState('Look at the camera and keep your face visible');
  const [detectedFaceBox, setDetectedFaceBox] = useState(null);
  const [autoCaptureReady, setAutoCaptureReady] = useState(false);
  const [autoCaptureAvailable, setAutoCaptureAvailable] = useState(true);
  const [autoSubmitAfterCapture, setAutoSubmitAfterCapture] = useState(false);
  const [codePromptOpen, setCodePromptOpen] = useState(false);

  const refreshAttendanceContext = useCallback(() => {
    studentAPI.getDashboard().then(r => {
      setOpenLectures(sortLecturesByDateAsc(r.data.openLectures || []));
    }).catch(() => {});
    subjectAPI.getMine().then(r => setSubjects(r.data.subjects)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshAttendanceContext();
  }, [refreshAttendanceContext]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('attendance_opened', refreshAttendanceContext);
    socket.on('attendance_closed', refreshAttendanceContext);
    socket.on('lectures_changed', refreshAttendanceContext);
    socket.on('subject_updated', refreshAttendanceContext);
    return () => {
      socket.off('attendance_opened', refreshAttendanceContext);
      socket.off('attendance_closed', refreshAttendanceContext);
      socket.off('lectures_changed', refreshAttendanceContext);
      socket.off('subject_updated', refreshAttendanceContext);
    };
  }, [socket, refreshAttendanceContext]);

  const clampCrop = useCallback((crop, width, height) => {
    const next = { ...crop };
    if (next.x < 0) next.x = 0;
    if (next.y < 0) next.y = 0;
    if (next.x + next.width > width) next.x = Math.max(0, width - next.width);
    if (next.y + next.height > height) next.y = Math.max(0, height - next.height);
    return next;
  }, []);

  const getPassportCropFromVideo = useCallback((box, options = {}) => {
    const video = webcamRef.current?.video;
    if (!video || video.readyState < 2) return webcamRef.current?.getScreenshot();

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const faceBox = options.ignoreLastFaceBox ? null : (box || lastFaceBox.current);
    let crop;

    if (faceBox) {
      const faceCenterX = faceBox.x + faceBox.width / 2;
      const faceCenterY = faceBox.y + faceBox.height / 2;
      let cropWidth = Math.max(faceBox.width * 1.55, faceBox.height * 1.1);
      let cropHeight = Math.max(faceBox.height * 1.45, cropWidth * 1.12);

      if (cropHeight > sourceHeight) {
        cropHeight = sourceHeight;
        cropWidth = Math.min(sourceWidth, cropHeight * 0.9);
      }
      if (cropWidth > sourceWidth) {
        cropWidth = sourceWidth;
        cropHeight = Math.min(sourceHeight, cropWidth * 1.12);
      }

      crop = clampCrop({
        x: faceCenterX - cropWidth / 2,
        y: faceCenterY - cropHeight * 0.42,
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

  const mlFaceLocationToVideoBox = useCallback((faceLocation) => {
    const video = webcamRef.current?.video;
    if (!video || video.readyState < 2 || !Array.isArray(faceLocation) || faceLocation.length < 4) return null;
    const [top, right, bottom, left] = faceLocation.map(Number);
    if ([top, right, bottom, left].some(value => !Number.isFinite(value))) return null;

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const cropWidth = Math.min(sourceWidth, sourceHeight * (PASSPORT_WIDTH / PASSPORT_HEIGHT));
    const cropHeight = cropWidth * (PASSPORT_HEIGHT / PASSPORT_WIDTH);
    const crop = {
      x: (sourceWidth - cropWidth) / 2,
      y: (sourceHeight - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight
    };

    return {
      x: crop.x + (left / PASSPORT_WIDTH) * crop.width,
      y: crop.y + (top / PASSPORT_HEIGHT) * crop.height,
      width: ((right - left) / PASSPORT_WIDTH) * crop.width,
      height: ((bottom - top) / PASSPORT_HEIGHT) * crop.height
    };
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

    const guideFrame = getPassportCropFromVideo(null, { ignoreLastFaceBox: true });
    if (!guideFrame) return { ready: false, message: 'Camera frame is not ready yet' };

    guideProbeInProgress.current = true;
    try {
      const file = await imageToFile(guideFrame, 'guide_frame.jpg');
      const formData = new FormData();
      formData.append('guideFrame', file);
      const response = await attendanceAPI.detectGuideFace(formData);
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

  const retake = () => {
    setCapturedImage(null);
    setLivenessFrameImages([]);
    autoCaptureFrames.current = 0;
    setAutoCaptureReady(false);
    setAutoCaptureStatus('Look at the camera and keep your face visible');
    setDetectedFaceBox(null);
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
      setAutoCaptureStatus('Move your face into the camera frame');
    }

    const detectionIntervalMs = detector ? 80 : 650;
    autoCaptureTimer.current = window.setInterval(async () => {
      const video = webcamRef.current?.video;
      if (!video || video.readyState < 2 || capturedImage || captureInProgress.current) return;

      if (!detector) {
        const probe = await probeGuideFaceWithML();
        if (probe.pending) return;
        if (!probe.ready) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus(probe.message || 'Move your face into the camera frame');
          return;
        }

        autoCaptureFrames.current += 1;
        const mlBox = mlFaceLocationToVideoBox(probe.faceLocation);
        if (mlBox) {
          lastFaceBox.current = mlBox;
          setDetectedFaceBox(mlBox);
        }
        setAutoCaptureReady(true);
        setAutoCaptureStatus('Face detected. Hold still...');
        if (autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          capture(true, mlBox);
        }
        return;
      }

      try {
        const faces = await detector.detect(video);
        if (faces.length !== 1) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus(faces.length > 1 ? 'Only one face should be visible' : 'Move your face into the camera frame');
          lastFaceBox.current = null;
          setDetectedFaceBox(null);
          return;
        }

        lastFaceBox.current = faces[0].boundingBox;
        setDetectedFaceBox(faces[0].boundingBox);
        const { ready, centered, sizeOk } = isFaceInsideGuide(faces[0].boundingBox, video);
        if (!centered) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus('Center your face in the camera frame');
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
          setAutoCaptureStatus(probe.message || 'Move your face into the camera frame');
          return;
        }

        autoCaptureFrames.current += 1;
        const mlBox = mlFaceLocationToVideoBox(probe.faceLocation);
        if (mlBox) {
          lastFaceBox.current = mlBox;
          setDetectedFaceBox(mlBox);
        }
        setAutoCaptureReady(true);
        setAutoCaptureStatus('Face detected. Hold still...');
        if (autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          capture(true, mlBox);
        }
      }
    }, detectionIntervalMs);

    return () => {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
    };
  }, [cameraReady, capture, capturedImage, isFaceInsideGuide, mlFaceLocationToVideoBox, probeGuideFaceWithML, step]);

  const handleCodeSubmit = (e) => {
    e.preventDefault();
    if (code.length !== 6) { toast.error('Enter a valid 6-digit code'); return; }
    if (!lectureId) { toast.error('Please select a lecture or enter a lecture'); return; }
    setCodePromptOpen(false);
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
    setCodePromptOpen(false);
    autoCaptureFrames.current = 0;
    setAutoCaptureReady(false);
    setAutoCaptureStatus('Look at the camera and keep your face visible');
    setAutoSubmitAfterCapture(false);
    lastFaceBox.current = null;
    setDetectedFaceBox(null);
  };

  const openLectureBySubject = new Map(openLectures.map(lecture => [String(lecture.subject?._id || lecture.subject), lecture]));
  const openSubjectCards = subjects
    .map(subject => ({ subject, lecture: openLectureBySubject.get(String(subject._id)) }))
    .filter(item => Boolean(item.lecture));

  const selectSubjectCard = (subject) => {
    const lecture = openLectureBySubject.get(String(subject._id));
    if (!lecture) {
      toast('Attendance is not open for this subject yet.');
      return;
    }
    setSelectedLecture(lecture);
    setLectureId(lecture._id);
    setCode('');
    setCodePromptOpen(true);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Mark Attendance</h1>
        <p className="text-slate-400 mt-1">Choose the subject whose attendance is currently open</p>
      </div>

      <AdminBreadcrumb items={[
        { label: 'StudySphere' },
        { label: 'Attendance' },
        selectedLecture?.subject?.name && { label: selectedLecture.subject.name }
      ]} />

      {step === STEPS.CODE && (
        <div className="glass-card">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-white">
                <BookOpen className="h-5 w-5 text-primary-300" /> Your Subjects
              </h2>
              <p className="mt-1 text-sm text-slate-400">Only subjects with open attendance are shown here.</p>
            </div>
            <span className="badge-info w-fit">{openLectures.length} open</span>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {openSubjectCards.map(({ subject }) => {
              return (
                <motion.button
                  key={subject._id}
                  type="button"
                  onClick={() => selectSubjectCard(subject)}
                  whileTap={{ scale: 0.96 }}
                  whileHover={{ y: -4 }}
                  className="group relative mx-auto flex aspect-square w-full max-w-[118px] flex-col items-center justify-center rounded-full border border-emerald-300/70 bg-emerald-500/15 p-3 text-center shadow-[0_0_26px_rgba(16,185,129,0.28)] transition-all"
                >
                  <span className="absolute inset-0 rounded-full border border-emerald-300/60 animate-ping" />
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
                  <BookOpen className="mb-2 h-5 w-5 text-emerald-200" />
                  <span className="line-clamp-2 text-[11px] font-semibold text-white sm:text-xs">{subject.name}</span>
                  <span className="mt-1 max-w-full truncate text-[10px] text-emerald-200">{subject.code}</span>
                </motion.button>
              );
            })}
          </div>

          {openSubjectCards.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">No attendance is open right now.</div>
          )}
        </div>
      )}

      {false && openLectures.length > 0 && step === STEPS.CODE && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
          <p className="text-emerald-400 font-medium mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Open Attendance Sessions
          </p>
          <div className="card-strip lg:block lg:space-y-2">
            {openLectures.map(lec => (
              <button key={lec._id} onClick={() => { setLectureId(lec._id); setSelectedLecture(lec); }}
                className={`text-left p-3 rounded-xl border transition-all lg:w-full ${lectureId === lec._id ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 hover:border-white/20 bg-white/5'}`}>
                <p className="font-medium text-white text-sm">{lec.title}</p>
                <p className="text-slate-400 text-xs">{lec.subject?.name} · {lec.subject?.code}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={step === STEPS.CODE ? 'hidden' : 'glass-card max-w-2xl mx-auto'}>
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
                    className="input-field text-center text-xl sm:text-3xl font-mono tracking-[0.2em] sm:tracking-[0.5em] font-bold"
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
                        <DynamicFaceGuide box={detectedFaceBox} videoRef={webcamRef} ready={autoCaptureReady} scanning={!capturedImage} />
                      </>
                    )}
                    {!cameraReady && !cameraError && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                        <SkeletonLine className="h-8 w-8 rounded-full" />
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
              <SkeletonLine className="mx-auto mb-4 h-20 w-20 rounded-full" />
              <h2 className="font-semibold text-white text-xl">Verifying Identity</h2>
              <p className="text-slate-400 mt-2">Running face recognition analysis...</p>
              <div className="mx-auto mt-5 max-w-xs space-y-2">
                <SkeletonLine className="h-3 w-full" />
                <SkeletonLine className="mx-auto h-3 w-5/6" />
                <SkeletonLine className="mx-auto h-3 w-4/6" />
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

      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {codePromptOpen && selectedLecture && step === STEPS.CODE && (
          <div className="app-modal-backdrop">
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              onSubmit={handleCodeSubmit}
              className="glass-card w-full max-w-md"
            >
              <h2 className="mb-1 flex items-center gap-2 font-semibold text-white">
                <Lock className="h-5 w-5 text-emerald-300" /> Enter Attendance Code
              </h2>
              <p className="text-sm text-slate-400">{selectedLecture.subject?.name} - {selectedLecture.title}</p>
              <div className="mt-4">
                <label className="label">6-Digit Attendance Code *</label>
                <input
                  autoFocus
                  className="input-field text-center text-2xl font-bold font-mono tracking-[0.38em]"
                  placeholder="______"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
                <p className="mt-1 text-xs text-slate-500">Ask your teacher for the attendance code.</p>
              </div>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => { setCodePromptOpen(false); setSelectedLecture(null); setLectureId(''); }} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={code.length !== 6 || !lectureId} className="btn-primary flex-1">Verify Face</button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  );
}
