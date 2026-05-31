import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Webcam from 'react-webcam';
import toast from 'react-hot-toast';
import { Upload, Camera, CheckCircle, AlertCircle, Scan, X, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { authAPI } from '../../services/api';
import ThemeToggle from '../../components/ThemeToggle';
import { AuthButtonSkeleton, SkeletonLine } from '../../components/LoadingStates';
import { getPasswordIssues, passwordRules } from '../../utils/passwordPolicy';
import DynamicFaceGuide from '../../components/DynamicFaceGuide';

const COURSE_OPTIONS = {
  'B. Tech': ['Computer Science', 'Mechanical Engineering', 'Electrical Engineering', 'AI/ML Engineering'],
  Diploma: ['Computer Science', 'Mechanical Engineering', 'Electrical Engineering'],
  BBA: [],
  MBA: []
};

const COURSE_SEMESTERS = {
  'B. Tech': [1, 2, 3, 4, 5, 6, 7, 8],
  Diploma: [1, 2, 3, 4, 5, 6],
  BBA: [1, 2, 3, 4, 5, 6],
  MBA: [1, 2, 3, 4]
};

const REGISTER_FEATURES = [
  {
    title: 'Verified student onboarding',
    description: 'Register with Gmail OTP, strong password validation, and a clean academic profile setup.'
  },
  {
    title: 'Guided face capture',
    description: 'Capture or upload a passport-style face image that powers secure attendance verification.'
  },
  {
    title: 'Academic profile mapping',
    description: 'Choose course, branch, and semester so the dashboard shows only the right subjects and lectures.'
  }
];

const departmentFromCourseBranch = (course, branch) => {
  if (course === 'BBA' || course === 'MBA') return course;
  if (branch === 'Computer Science' || branch === 'AI/ML Engineering') return 'Computer Science';
  if (branch === 'Mechanical Engineering') return 'Mechanical';
  if (branch === 'Electrical Engineering') return 'Electrical';
  return '';
};
const AUTO_CAPTURE_READY_FRAMES = 2;
const ML_GUIDE_PROBE_BACKOFF_MS = 5000;
const PASSPORT_WIDTH = 420;
const PASSPORT_HEIGHT = 560;
const CAPTURE_QUALITY = 0.82;
const INDIA_PHONE_PREFIX = '+91';
const CAMERA_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 640, max: 1280 },
  height: { ideal: 480, max: 720 }
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const fileRef = useRef();
  const webcamRef = useRef(null);
  const autoCaptureFrames = useRef(0);
  const autoCaptureTimer = useRef(null);
  const guideProbeInProgress = useRef(false);
  const mlProbeBackoffUntil = useRef(0);
  const captureInProgress = useRef(false);
  const lastFaceBox = useRef(null);
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    studentId: '', course: '', department: '', branch: '', semester: '', fatherName: '', dateOfBirth: '', phone: '', address: ''
  });
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [autoCaptureStatus, setAutoCaptureStatus] = useState('Open camera and center your face');
  const [detectedFaceBox, setDetectedFaceBox] = useState(null);
  const [autoCaptureReady, setAutoCaptureReady] = useState(false);
  const [autoCaptureAvailable, setAutoCaptureAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [otpAutoSentEmail, setOtpAutoSentEmail] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [step, setStep] = useState(1); // 1=personal, 2=photo, 3=done
  const [activeFeature, setActiveFeature] = useState(0);
  const passwordIssues = getPasswordIssues(form.password);

  const setSelectedPhoto = useCallback((file, previewUrl) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(file);
    setPhotoPreview(previewUrl);
  }, [photoPreview]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveFeature(previous => (previous + 1) % REGISTER_FEATURES.length);
    }, 3400);
    return () => window.clearInterval(timer);
  }, []);

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setCameraOpen(false);
    setSelectedPhoto(file, URL.createObjectURL(file));
  };

  const handleCourseChange = (course) => {
    const branches = COURSE_OPTIONS[course] || [];
    const branch = branches[0] || '';
    setForm({
      ...form,
      course,
      branch,
      department: departmentFromCourseBranch(course, branch),
      semester: ''
    });
  };

  const handleBranchChange = (branch) => {
    setForm({
      ...form,
      branch,
      department: departmentFromCourseBranch(form.course, branch)
    });
  };

  const resetOtpVerification = () => {
    setOtpSent(false);
    setOtpVerified(false);
    setEmailOtp('');
    setOtpAutoSentEmail('');
  };

  const handleEmailChange = (email) => {
    setForm({ ...form, email });
    resetOtpVerification();
  };

  const getIndianMobileDigits = (phone) => {
    const raw = String(phone || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (raw.startsWith(INDIA_PHONE_PREFIX)) return digits.replace(/^91/, '').slice(0, 10);
    if (digits.startsWith('91') && digits.length > 10) return digits.slice(2, 12);
    return digits.slice(0, 10);
  };

  const handlePhoneChange = (phone) => {
    const digits = getIndianMobileDigits(phone);
    setForm(previous => ({ ...previous, phone: digits ? `${INDIA_PHONE_PREFIX}${digits}` : '' }));
  };

  const sendRegistrationOtp = useCallback(async (silent = false) => {
    const email = String(form.email || '').trim();
    if (!email) {
      if (!silent) toast.error('Enter your Gmail first.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (!silent) toast.error('Enter a valid Gmail address.');
      return;
    }
    setOtpLoading(true);
    setOtpAutoSentEmail(email);
    try {
      const res = await authAPI.sendRegistrationOtp({ email });
      setOtpSent(true);
      setOtpVerified(false);
      toast.success(res.data.message || 'Gmail OTP sent.');
    } catch (err) {
      console.error('Registration OTP error:', err);
      toast.error(err.response?.data?.message || 'Could not send Gmail OTP.');
    } finally {
      setOtpLoading(false);
    }
  }, [form.email]);

  useEffect(() => {
    const email = String(form.email || '').trim();
    if (!email || otpVerified || otpLoading || otpAutoSentEmail === email) return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;

    const timer = window.setTimeout(() => {
      sendRegistrationOtp(true);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [form.email, otpAutoSentEmail, otpLoading, otpVerified, sendRegistrationOtp]);

  const verifyRegistrationOtp = async () => {
    if (emailOtp.length !== 6) {
      toast.error('Enter the 6 digit Gmail OTP.');
      return;
    }
    setOtpLoading(true);
    try {
      await authAPI.verifyRegistrationOtp({
        email: form.email,
        emailOtp
      });
      setOtpVerified(true);
      toast.success('Gmail verified.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not verify Gmail OTP.');
    } finally {
      setOtpLoading(false);
    }
  };

  const dataUrlToFile = useCallback(async (dataUrl) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], `registration_photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
  }, []);

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

  const isFaceInsideGuide = useCallback((box, video) => {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const centerX = width / 2;
    const centerY = height / 2;
    const radiusY = height * 0.36;
    const radiusX = radiusY * 0.75;
    const faceCenterX = box.x + box.width / 2;
    const faceCenterY = box.y + box.height / 2;
    const centered =
      Math.abs(faceCenterX - centerX) <= radiusX * 0.42 &&
      Math.abs(faceCenterY - centerY) <= radiusY * 0.36;
    const sizeOk =
      box.width >= radiusX * 0.65 &&
      box.width <= radiusX * 1.75 &&
      box.height >= radiusY * 0.5 &&
      box.height <= radiusY * 1.65;

    return { centered, sizeOk, ready: centered && sizeOk };
  }, []);

  const openCamera = () => {
    setCameraError('');
    setCameraReady(false);
    setAutoCaptureReady(false);
    setAutoCaptureStatus('Center your face in the guide');
    setDetectedFaceBox(null);
    autoCaptureFrames.current = 0;
    setCameraOpen(true);
  };

  const closeCamera = useCallback(() => {
    setCameraOpen(false);
    setCameraReady(false);
    setCameraError('');
    setAutoCaptureReady(false);
    autoCaptureFrames.current = 0;
    lastFaceBox.current = null;
    setDetectedFaceBox(null);
    if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
    autoCaptureTimer.current = null;
  }, []);

  const capturePhoto = useCallback(async (automatic = false, faceBox = null) => {
    if (captureInProgress.current) return;
    captureInProgress.current = true;
    try {
      const imageSrc = getPassportCropFromVideo(faceBox);
      if (!imageSrc) {
        toast.error('Camera is not ready yet. Please try again.');
        return;
      }

      const file = await dataUrlToFile(imageSrc);
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Captured image is too large. Please retake it.');
        return;
      }

      closeCamera();
      setSelectedPhoto(file, URL.createObjectURL(file));
      toast.success(automatic ? 'Passport photo captured automatically' : 'Current photo captured');
    } finally {
      captureInProgress.current = false;
    }
  }, [closeCamera, dataUrlToFile, getPassportCropFromVideo, setSelectedPhoto]);

  const probeGuideFaceWithML = useCallback(async () => {
    if (Date.now() < mlProbeBackoffUntil.current) {
      return { ready: false, message: 'Face service is warming up. Hold your face steady...' };
    }
    if (guideProbeInProgress.current) return { pending: true, ready: false };

    const guideFrame = getPassportCropFromVideo(null, { ignoreLastFaceBox: true });
    if (!guideFrame) return { ready: false, message: 'Camera frame is not ready yet' };

    guideProbeInProgress.current = true;
    try {
      const file = await dataUrlToFile(guideFrame);
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
  }, [dataUrlToFile, getPassportCropFromVideo]);

  const handleCameraError = (error) => {
    const message = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
      ? 'Camera permission denied. Allow camera access or upload from gallery.'
      : 'Camera is unavailable. Upload from gallery or try again.';
    setCameraReady(false);
    setCameraError(message);
    setAutoCaptureReady(false);
    setAutoCaptureStatus('Camera access is required for auto capture');
    toast.error(message);
  };

  useEffect(() => {
    if (!cameraOpen || !cameraReady || photoPreview) {
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
      if (!video || video.readyState < 2 || photoPreview || captureInProgress.current) return;

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
          capturePhoto(true, mlBox);
        }
        return;
      }

      try {
        const faces = await detector.detect(video);
        if (faces.length !== 1) {
          autoCaptureFrames.current = 0;
          lastFaceBox.current = null;
          setDetectedFaceBox(null);
          setAutoCaptureReady(false);
          setAutoCaptureStatus(faces.length > 1 ? 'Only one face should be visible' : 'Move your face into the guide');
          return;
        }

        lastFaceBox.current = faces[0].boundingBox;
        setDetectedFaceBox(faces[0].boundingBox);
        const { ready, centered, sizeOk } = isFaceInsideGuide(faces[0].boundingBox, video);
        if (!centered) {
          autoCaptureFrames.current = 0;
          setAutoCaptureReady(false);
          setAutoCaptureStatus('Center your face in the guide');
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
        setAutoCaptureStatus('Hold still. Capturing passport photo...');
        if (ready && autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          capturePhoto(true, faces[0].boundingBox);
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
          capturePhoto(true, mlBox);
        }
      }
    }, detectionIntervalMs);

    return () => {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
    };
  }, [cameraOpen, cameraReady, capturePhoto, isFaceInsideGuide, mlFaceLocationToVideoBox, photoPreview, probeGuideFaceWithML]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (!photo) { toast.error('Please upload your passport photo'); return; }
    if (passwordIssues.length) { toast.error(`Password needs: ${passwordIssues.join(', ')}`); return; }
    if (!otpVerified) { toast.error('Verify Gmail OTP before submitting registration.'); return; }
    if (form.phone && getIndianMobileDigits(form.phone).length !== 10) { toast.error('Enter a valid 10 digit phone number.'); return; }

    setLoading(true);
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (k !== 'confirmPassword') formData.append(k, v); });
      formData.append('profileImage', photo);
      await authAPI.register(formData);
      setStep(3);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 3) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950 relative overflow-hidden">
        <ThemeToggle className="fixed right-4 top-4 z-20" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl" />
        <motion.div initial={{ scale: 0.86, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 22 }} className="relative glass-card max-w-md w-full mx-4 text-center">
          <motion.div initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.08 }} className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-emerald-400" />
          </motion.div>
          <h2 className="text-2xl font-bold text-white font-display mb-2">Registration Submitted!</h2>
          <p className="text-slate-400 mb-6">Your registration request has been sent to the admin. You'll be notified once your account is approved. This usually takes 1-2 business days.</p>
          <button onClick={() => navigate('/login')} className="btn-primary w-full">Go to Login</button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="register-compact min-h-dvh flex items-center justify-center bg-slate-950 py-6 sm:py-8 relative overflow-hidden">
      <ThemeToggle className="fixed right-4 top-4 z-20" />
      <div className="absolute inset-0">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 mx-3 grid w-full max-w-6xl items-center gap-6 sm:mx-4 lg:grid-cols-[0.95fr_1.15fr]">
        <div className="glass-card hidden min-h-[610px] overflow-hidden p-8 lg:flex lg:flex-col lg:justify-between">
          <div>
            <motion.div whileHover={{ scale: 1.04, rotate: 1 }} className="mb-7 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-600/20 border border-primary-500/30">
              <Scan className="h-8 w-8 text-primary-300" />
            </motion.div>
            <h1 className="font-display text-5xl font-bold leading-tight text-white">StudySphere</h1>
            <p className="mt-3 text-lg text-slate-300">Student registration made secure and simple</p>
          </div>

          <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="absolute -bottom-16 -right-16 h-36 w-36 rounded-full bg-violet-500/20 blur-3xl" />
            <motion.div
              key={activeFeature}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="relative"
            >
              <p className="text-xs uppercase tracking-[0.28em] text-primary-300">Registration step</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">{REGISTER_FEATURES[activeFeature].title}</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{REGISTER_FEATURES[activeFeature].description}</p>
            </motion.div>
            <div className="mt-5 flex gap-2">
              {REGISTER_FEATURES.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setActiveFeature(index)}
                  className={`h-1.5 rounded-full transition-all ${activeFeature === index ? 'w-9 bg-primary-400' : 'w-4 bg-white/20 hover:bg-white/40'}`}
                  aria-label={`Show registration feature ${index + 1}`}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs text-slate-300">
            {['Gmail OTP', 'Face profile', 'Course mapping'].map(item => (
              <div key={item} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">{item}</div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
        <div className="text-center mb-4 sm:mb-5 lg:hidden">
          <motion.div whileHover={{ scale: 1.04, rotate: 1 }} className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-primary-600/20 border border-primary-500/30 mb-2">
            <Scan className="w-5 h-5 text-primary-400" />
          </motion.div>
          <h1 className="font-display text-2xl font-bold text-white">Student Registration</h1>
          <p className="text-sm text-slate-400 mt-1">Create your account to get started</p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {[1, 2].map(s => (
            <React.Fragment key={s}>
              <motion.div layout className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${step >= s ? 'bg-primary-600 text-white' : 'bg-white/10 text-slate-400'}`}>{s}</motion.div>
              {s < 2 && <div className={`h-0.5 w-10 transition-all ${step > s ? 'bg-primary-600' : 'bg-white/10'}`} />}
            </React.Fragment>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="glass-card space-y-4 p-4 sm:p-5">
            <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="personal" initial={{ opacity: 0, x: 28, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: -24, filter: 'blur(4px)' }} transition={{ duration: 0.24 }} className="space-y-3">
                <h2 className="text-base font-semibold text-white">Personal Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Full Name *</label>
                    <input className="input-field" placeholder="John Doe" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label">Student ID *</label>
                    <input className="input-field" placeholder="CS2021001" value={form.studentId} onChange={e => { setForm({ ...form, studentId: e.target.value }); resetOtpVerification(); }} required />
                  </div>
                  <div>
                    <label className="label">Father's Name</label>
                    <input className="input-field" placeholder="Father's full name" value={form.fatherName} onChange={e => setForm({ ...form, fatherName: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Date of Birth</label>
                    <input type="date" className="input-field" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Email Address *</label>
                    <div className="flex gap-2">
                      <input type="email" className="input-field flex-1" placeholder="john@college.edu" value={form.email} onChange={e => handleEmailChange(e.target.value)} required />
                      {form.email.trim() && (
                        <button type="button" onClick={() => sendRegistrationOtp(false)} disabled={otpLoading || otpVerified} className="btn-secondary whitespace-nowrap px-3 sm:px-4">
                          {otpLoading && !otpSent ? <AuthButtonSkeleton className="min-w-16" /> : otpVerified ? 'Verified' : otpSent ? 'Resend' : 'Verify'}
                        </button>
                      )}
                    </div>
                    {!otpSent && !otpVerified && form.email && (
                      <p className="mt-1 text-[11px] text-slate-500">OTP will auto-send 5 seconds after you stop typing.</p>
                    )}
                    {otpSent && !otpVerified && (
                      <div className="mt-2 flex gap-2">
                        <input
                          className="input-field flex-1 text-center tracking-[0.28em]"
                          placeholder="Gmail OTP"
                          value={emailOtp}
                          onChange={e => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                        <button type="button" onClick={verifyRegistrationOtp} disabled={otpLoading || emailOtp.length !== 6} className="btn-primary whitespace-nowrap px-4">
                          {otpLoading ? <AuthButtonSkeleton className="min-w-20" /> : 'Verify OTP'}
                        </button>
                      </div>
                    )}
                    {otpVerified && (
                      <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                        <CheckCircle className="h-3.5 w-3.5" /> Gmail verified
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label">Phone Number</label>
                    <div className="flex min-h-[42px] overflow-hidden rounded-lg border border-white/10 bg-white/5 transition-colors focus-within:border-primary-500">
                      <span className="flex min-w-[3.75rem] shrink-0 items-center justify-center border-r border-white/10 bg-white/5 px-3 text-sm font-semibold leading-none text-primary-200">
                        {INDIA_PHONE_PREFIX}
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        className="input-field min-w-0 flex-1 rounded-none border-0 bg-transparent focus:ring-0"
                        placeholder="98765 43210"
                        value={getIndianMobileDigits(form.phone)}
                        onChange={e => handlePhoneChange(e.target.value)}
                        maxLength={10}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">Course *</label>
                    <select className="input-field" value={form.course} onChange={e => handleCourseChange(e.target.value)} required>
                      <option value="">Select Course</option>
                      {Object.keys(COURSE_OPTIONS).map(course => <option key={course} value={course}>{course}</option>)}
                    </select>
                  </div>
                  {(COURSE_OPTIONS[form.course] || []).length > 0 && (
                    <div>
                      <label className="label">Branch *</label>
                      <select className="input-field" value={form.branch} onChange={e => handleBranchChange(e.target.value)} required>
                        {(COURSE_OPTIONS[form.course] || []).map(branch => <option key={branch} value={branch}>{branch}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="label">Semester *</label>
                    <select className="input-field" value={form.semester} onChange={e => setForm({ ...form, semester: e.target.value })} required>
                      <option value="">Select Semester</option>
                      {(COURSE_SEMESTERS[form.course] || []).map(s => <option key={s} value={s}>Semester {s}</option>)}
                    </select>
                  </div>
                  <div className="relative">
                    <label className="label">Password *</label>
                    <div className="relative">
                      <input type={showPass ? 'text' : 'password'} className="input-field pr-12" placeholder="Min 8 characters" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
                      <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {form.password.length > 0 && (
                      <div className="mt-2 grid gap-1 text-[11px]">
                        {passwordRules.map(rule => (
                          <span key={rule.id} className={rule.test(form.password) ? 'text-emerald-300' : 'text-slate-500'}>
                            {rule.test(form.password) ? '✓' : '•'} {rule.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label">Confirm Password *</label>
                    <input type="password" className="input-field" placeholder="Repeat password" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} required />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Address</label>
                    <textarea className="input-field resize-none" rows={2} placeholder="Your address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                  </div>
                </div>
                <motion.button type="button" onClick={() => {
                  if (!form.name || !form.email || !form.studentId || !form.course || !form.department || !form.semester || !form.password) { toast.error('Please fill all required fields'); return; }
                  if ((COURSE_OPTIONS[form.course] || []).length > 0 && !form.branch) { toast.error('Please select your branch'); return; }
                  if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
                  if (passwordIssues.length) { toast.error(`Password needs: ${passwordIssues.join(', ')}`); return; }
                  if (form.phone && getIndianMobileDigits(form.phone).length !== 10) { toast.error('Enter a valid 10 digit phone number.'); return; }
                  if (!otpVerified) { toast.error('Verify Gmail OTP first'); return; }
                  setStep(2);
                }} className="btn-primary w-full mt-2" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                  Next: Upload Photo →
                </motion.button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="photo" initial={{ opacity: 0, x: 28, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: -24, filter: 'blur(4px)' }} transition={{ duration: 0.24 }} className="space-y-4">
                <h2 className="text-lg font-semibold text-white mb-2">Upload or Capture Passport Photo</h2>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                  <div className="flex gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-300">
                      <p className="font-semibold mb-1">Photo Requirements:</p>
                      <ul className="space-y-1 text-amber-400/80">
                        <li>• Clear, front-facing passport-size photo</li>
                        <li>• Face must be fully visible and centered</li>
                        <li>• Good lighting, no sunglasses or hats</li>
                        <li>• Plain background preferred</li>
                        <li>• Max size: 5MB (JPG, PNG, WEBP)</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary flex items-center justify-center gap-2">
                    <Upload className="w-4 h-4" /> Upload from Gallery
                  </button>
                  <button type="button" onClick={openCamera} className="btn-secondary flex items-center justify-center gap-2">
                    <Camera className="w-4 h-4" /> Take Current Photo
                  </button>
                </div>

                {cameraOpen && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-950">
                      <Webcam
                        key={cameraOpen ? 'registration-camera-open' : 'registration-camera-closed'}
                        ref={webcamRef}
                        audio={false}
                        mirrored
                        screenshotFormat="image/jpeg"
                        screenshotQuality={CAPTURE_QUALITY}
                        videoConstraints={CAMERA_CONSTRAINTS}
                        onUserMedia={() => { setCameraReady(true); setCameraError(''); }}
                        onUserMediaError={handleCameraError}
                        className="h-full w-full object-cover"
                      />
                      {cameraReady && (
                        <DynamicFaceGuide box={detectedFaceBox} videoRef={webcamRef} ready={autoCaptureReady} mirrored />
                      )}
                      {!cameraReady && !cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                          <SkeletonLine className="h-8 w-8 rounded-full" />
                        </div>
                      )}
                      {cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-5 text-center">
                          <div>
                            <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                            <p className="text-white font-medium">{cameraError}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 mt-4">
                      <div className={`sm:order-last text-xs text-center rounded-lg p-2 border sm:flex-[1.2] ${
                        autoCaptureReady
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                          : 'bg-white/5 border-white/10 text-slate-400'
                      }`}>
                        {autoCaptureStatus}
                        {!autoCaptureAvailable && <span className="text-slate-500"> Manual capture remains available.</span>}
                      </div>
                      <button type="button" onClick={closeCamera} className="btn-secondary flex-1">Cancel Camera</button>
                      <button type="button" onClick={openCamera} className="btn-secondary flex-1 flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4" /> Retry
                      </button>
                      <button type="button" onClick={() => capturePhoto(false)} disabled={!cameraReady} className="btn-primary flex-1 flex items-center justify-center gap-2">
                        <Camera className="w-4 h-4" /> Capture
                      </button>
                    </div>
                  </div>
                )}

                <div
                  onClick={() => !photoPreview && fileRef.current?.click()}
                  className="border-2 border-dashed border-white/20 hover:border-primary-500/50 rounded-2xl p-8 text-center cursor-pointer transition-all hover:bg-white/5"
                >
                  {photoPreview ? (
                    <div className="relative inline-block">
                      <img src={photoPreview} alt="Preview" className="w-40 h-48 object-cover rounded-xl mx-auto" />
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (photoPreview) URL.revokeObjectURL(photoPreview);
                          setPhoto(null);
                          setPhotoPreview(null);
                        }}
                        className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 rounded-full flex items-center justify-center"
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                      <p className="text-emerald-400 text-sm mt-3 flex items-center justify-center gap-1">
                        <CheckCircle className="w-4 h-4" /> Photo ready
                      </p>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                      <p className="text-slate-300 font-medium">Upload from gallery or take current photo</p>
                      <p className="text-slate-500 text-sm mt-1">JPG, PNG, WEBP up to 5MB</p>
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setStep(1)} className="btn-secondary flex-1">← Back</button>
                  <motion.button type="submit" disabled={loading || !photo} className={`btn-primary flex-1 ${loading ? 'action-pulse' : ''}`} whileHover={{ scale: loading ? 1 : 1.01 }} whileTap={{ scale: 0.98 }}>
                    {loading ? <AuthButtonSkeleton /> : 'Submit Registration'}
                  </motion.button>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        </form>

        <p className="text-center text-slate-400 text-sm mt-4">
          Already have an account? <Link to="/login" className="text-primary-400 hover:text-primary-300 font-medium">Sign In</Link>
        </p>
        </div>
      </motion.div>
    </div>
  );
}
