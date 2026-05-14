import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Webcam from 'react-webcam';
import toast from 'react-hot-toast';
import { Upload, Camera, CheckCircle, AlertCircle, Scan, X, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { authAPI } from '../../services/api';
import ThemeToggle from '../../components/ThemeToggle';

const DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];
const AUTO_CAPTURE_READY_FRAMES = 2;
const PASSPORT_WIDTH = 480;
const PASSPORT_HEIGHT = 640;
const CAPTURE_QUALITY = 0.9;
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
  const captureInProgress = useRef(false);
  const lastFaceBox = useRef(null);
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    studentId: '', department: '', semester: '', fatherName: '', dateOfBirth: '', phone: '', address: ''
  });
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [autoCaptureStatus, setAutoCaptureStatus] = useState('Open camera and center your face');
  const [autoCaptureReady, setAutoCaptureReady] = useState(false);
  const [autoCaptureAvailable, setAutoCaptureAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [step, setStep] = useState(1); // 1=personal, 2=photo, 3=done

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

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setCameraOpen(false);
    setSelectedPhoto(file, URL.createObjectURL(file));
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
    if (guideProbeInProgress.current) return { pending: true, ready: false };

    const guideFrame = getPassportCropFromVideo();
    if (!guideFrame) return { ready: false, message: 'Camera frame is not ready yet' };

    guideProbeInProgress.current = true;
    try {
      const file = await dataUrlToFile(guideFrame);
      const formData = new FormData();
      formData.append('guideFrame', file);
      const response = await authAPI.detectRegistrationFace(formData);
      return response.data || { ready: false, message: 'Move your face into the oval' };
    } catch (err) {
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
      setAutoCaptureStatus('Move your face into the oval');
    }

    autoCaptureTimer.current = window.setInterval(async () => {
      const video = webcamRef.current?.video;
      if (!video || video.readyState < 2 || photoPreview || captureInProgress.current) return;

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
          capturePhoto(true);
        }
        return;
      }

      try {
        const faces = await detector.detect(video);
        if (faces.length !== 1) {
          autoCaptureFrames.current = 0;
          lastFaceBox.current = null;
          setAutoCaptureReady(false);
          setAutoCaptureStatus(faces.length > 1 ? 'Only one face should be visible' : 'Move your face into the guide');
          return;
        }

        lastFaceBox.current = faces[0].boundingBox;
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
          setAutoCaptureStatus(probe.message || 'Move your face into the oval');
          return;
        }

        autoCaptureFrames.current += 1;
        setAutoCaptureReady(true);
        setAutoCaptureStatus('Face detected inside the oval. Hold still...');
        if (autoCaptureFrames.current >= AUTO_CAPTURE_READY_FRAMES) {
          window.clearInterval(autoCaptureTimer.current);
          autoCaptureTimer.current = null;
          capturePhoto(true);
        }
      }
    }, 650);

    return () => {
      if (autoCaptureTimer.current) window.clearInterval(autoCaptureTimer.current);
      autoCaptureTimer.current = null;
    };
  }, [cameraOpen, cameraReady, capturePhoto, isFaceInsideGuide, photoPreview, probeGuideFaceWithML]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (!photo) { toast.error('Please upload your passport photo'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }

    setLoading(true);
    const formData = new FormData();
    Object.entries(form).forEach(([k, v]) => { if (k !== 'confirmPassword') formData.append(k, v); });
    formData.append('profileImage', photo);

    try {
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
      <div className="min-h-screen flex items-center justify-center bg-slate-950 relative overflow-hidden">
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
    <div className="min-h-screen flex items-center justify-center bg-slate-950 py-10 relative overflow-hidden">
      <ThemeToggle className="fixed right-4 top-4 z-20" />
      <div className="absolute inset-0">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-2xl mx-4">
        <div className="text-center mb-8">
          <motion.div whileHover={{ scale: 1.04, rotate: 1 }} className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-600/20 border border-primary-500/30 mb-3">
            <Scan className="w-7 h-7 text-primary-400" />
          </motion.div>
          <h1 className="font-display text-3xl font-bold text-white">Student Registration</h1>
          <p className="text-slate-400 mt-1">Create your account to get started</p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-3 mb-6">
          {[1, 2].map(s => (
            <React.Fragment key={s}>
              <motion.div layout className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${step >= s ? 'bg-primary-600 text-white' : 'bg-white/10 text-slate-400'}`}>{s}</motion.div>
              {s < 2 && <div className={`h-0.5 w-12 transition-all ${step > s ? 'bg-primary-600' : 'bg-white/10'}`} />}
            </React.Fragment>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="glass-card space-y-5">
            <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="personal" initial={{ opacity: 0, x: 28, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: -24, filter: 'blur(4px)' }} transition={{ duration: 0.24 }} className="space-y-4">
                <h2 className="text-lg font-semibold text-white mb-4">Personal Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Full Name *</label>
                    <input className="input-field" placeholder="John Doe" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label">Student ID *</label>
                    <input className="input-field" placeholder="CS2021001" value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value })} required />
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
                    <input type="email" className="input-field" placeholder="john@college.edu" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
                  </div>
                  <div>
                    <label className="label">Phone Number</label>
                    <input type="tel" className="input-field" placeholder="+91 98765 43210" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Department *</label>
                    <select className="input-field" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} required>
                      <option value="">Select Department</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Semester *</label>
                    <select className="input-field" value={form.semester} onChange={e => setForm({ ...form, semester: e.target.value })} required>
                      <option value="">Select Semester</option>
                      {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Semester {s}</option>)}
                    </select>
                  </div>
                  <div className="relative">
                    <label className="label">Password *</label>
                    <div className="relative">
                      <input type={showPass ? 'text' : 'password'} className="input-field pr-12" placeholder="Min 6 characters" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
                      <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
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
                  if (!form.name || !form.email || !form.studentId || !form.department || !form.semester || !form.password) { toast.error('Please fill all required fields'); return; }
                  if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
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
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className={`h-[72%] aspect-[3/4] rounded-[48%] border-2 transition-all ${
                            autoCaptureReady
                              ? 'border-emerald-400 shadow-[0_0_28px_rgba(16,185,129,0.35)]'
                              : 'border-primary-400/70'
                          }`} />
                        </div>
                      )}
                      {!cameraReady && !cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
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
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Submitting...
                      </span>
                    ) : 'Submit Registration'}
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
      </motion.div>
    </div>
  );
}
