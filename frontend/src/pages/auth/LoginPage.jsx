import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Fingerprint, Scan, ScanFace, ShieldCheck } from 'lucide-react';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../../components/ThemeToggle';
import FaceLoginModal from '../../components/FaceLoginModal';
import { AuthButtonSkeleton } from '../../components/LoadingStates';
import {
  BIOMETRIC_CREDENTIAL_KEY,
  isWebAuthnSupported,
  prepareRequestOptions,
  serializeAssertionCredential
} from '../../utils/webauthn';

const AUTH_FEATURES = [
  {
    title: 'Smart face recognition',
    description: 'Verify students quickly with AI-assisted face matching and liveness-aware attendance flows.'
  },
  {
    title: 'Department-ready controls',
    description: 'Manage subjects, teachers, lectures, timetables, and notifications in one clean academic workspace.'
  },
  {
    title: 'Real-time attendance insight',
    description: 'Track attendance updates, alerts, and reports instantly across student, teacher, and admin dashboards.'
  }
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [faceLoginOpen, setFaceLoginOpen] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  const showBiometricLogin = isWebAuthnSupported() && Boolean(localStorage.getItem(BIOMETRIC_CREDENTIAL_KEY));

  const fieldMotion = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveFeature(previous => (previous + 1) % AUTH_FEATURES.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authAPI.login(form);
      login(res.data.token, res.data.user);
      if (res.data.requiresAdminScope) sessionStorage.removeItem('adminScopeSelected');
      toast.success(`Welcome back, ${res.data.user.name}!`);
      navigate(['admin', 'teacher'].includes(res.data.user.role) ? '/admin' : '/student');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFaceLoginSuccess = (data) => {
    login(data.token, data.user);
    setFaceLoginOpen(false);
    toast.success(data.message || `Welcome back, ${data.user.name}!`);
    navigate('/student');
  };

  const handleBiometricLogin = async () => {
    const credentialId = localStorage.getItem(BIOMETRIC_CREDENTIAL_KEY);
    if (!credentialId) {
      toast.error('Biometric login is not registered on this device.');
      return;
    }

    setBiometricLoading(true);
    try {
      const optionsResponse = await authAPI.beginBiometricLogin({ credentialId });
      const credential = await navigator.credentials.get({
        publicKey: prepareRequestOptions(optionsResponse.data.options)
      });
      if (!credential) throw new Error('Biometric login was cancelled.');

      const verifyResponse = await authAPI.finishBiometricLogin({
        credential: serializeAssertionCredential(credential)
      });
      login(verifyResponse.data.token, verifyResponse.data.user);
      toast.success(verifyResponse.data.message || `Welcome back, ${verifyResponse.data.user.name}!`);
      navigate('/student');
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Biometric login failed.';
      if (err.response?.status === 404) localStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
      toast.error(message);
    } finally {
      setBiometricLoading(false);
    }
  };

  return (
    <div className="auth-login-page min-h-dvh flex items-center justify-center relative overflow-hidden px-3 py-6">
      <ThemeToggle className="fixed right-3 top-3 z-20 scale-90 sm:right-4 sm:top-4 sm:scale-100" />
      <div className="auth-login-bg absolute inset-0">
        <div className="auth-login-grid absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 grid w-full max-w-6xl items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]"
      >
        <motion.div className="glass-card hidden min-h-[520px] overflow-hidden p-8 lg:flex lg:flex-col lg:justify-between" initial="initial" animate="animate">
          <div>
            <motion.div
              className="auth-login-logo mb-7 inline-flex h-16 w-16 items-center justify-center rounded-2xl"
              variants={fieldMotion}
              transition={{ duration: 0.32 }}
              whileHover={{ scale: 1.04, rotate: 1 }}
            >
              <Scan className="h-8 w-8 text-primary-300" />
            </motion.div>
            <motion.h1 className="auth-login-title font-display text-5xl font-bold leading-tight" variants={fieldMotion} transition={{ duration: 0.32, delay: 0.05 }}>StudySphere</motion.h1>
            <motion.p className="auth-login-subtitle mt-3 text-lg" variants={fieldMotion} transition={{ duration: 0.32, delay: 0.1 }}>Attendance, classrooms, and conversations in one place</motion.p>
          </div>

          <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-primary-500/20 blur-3xl" />
            <motion.div
              key={activeFeature}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35 }}
              className="relative"
            >
              <p className="text-xs uppercase tracking-[0.28em] text-primary-300">Feature {activeFeature + 1}</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">{AUTH_FEATURES[activeFeature].title}</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{AUTH_FEATURES[activeFeature].description}</p>
            </motion.div>
            <div className="mt-5 flex gap-2">
              {AUTH_FEATURES.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setActiveFeature(index)}
                  className={`h-1.5 rounded-full transition-all ${activeFeature === index ? 'w-9 bg-primary-400' : 'w-4 bg-white/20 hover:bg-white/40'}`}
                  aria-label={`Show feature ${index + 1}`}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs text-slate-300">
            {['Face ID', 'Biometric', 'Live alerts'].map(item => (
              <div key={item} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">{item}</div>
            ))}
          </div>
        </motion.div>

        <motion.div className="auth-login-card auth-login-compact glass-card mx-auto w-full max-w-sm" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
          <div className="mb-5 text-center lg:hidden">
            <div className="auth-login-logo mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl">
              <Scan className="h-6 w-6 text-primary-400" />
            </div>
            <h1 className="auth-login-title font-display text-2xl font-bold">StudySphere</h1>
            <p className="auth-login-subtitle mt-0.5 text-xs">Campus learning workspace</p>
          </div>
          <motion.h2 className="auth-login-heading mb-4 text-lg font-semibold" {...fieldMotion} transition={{ delay: 0.12 }}>Sign In</motion.h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <motion.div {...fieldMotion} transition={{ delay: 0.16 }}>
              <label className="label">Email Address / Student ID</label>
              <input
                type="text"
                autoComplete="username"
                className="input-field"
                placeholder="abc@gmail.com or 0302xxxx08"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
              />
            </motion.div>
            <motion.div {...fieldMotion} transition={{ delay: 0.2 }}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <label className="label mb-0">Password</label>
                <Link to="/forgot-password" className="text-xs font-medium text-primary-300 transition-colors hover:text-primary-200">
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  className="input-field pr-11"
                  placeholder="********"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="auth-login-eye absolute right-3 top-1/2 -translate-y-1/2 transition-colors">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </motion.div>

            <motion.button
              type="submit"
              disabled={loading}
              className={`btn-primary mt-1 w-full ${loading ? 'action-pulse' : ''}`}
              whileHover={{ scale: loading ? 1 : 1.01 }}
              whileTap={{ scale: 0.98 }}
            >
              {loading ? <AuthButtonSkeleton /> : 'Sign In'}
            </motion.button>
          </form>

          <motion.div className="auth-login-divider mt-4 pt-4" {...fieldMotion} transition={{ delay: 0.24 }}>
            <div className="mb-3 flex items-center gap-3 text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">
              <span className="h-px flex-1 bg-slate-700" />
              <span>Student Face ID</span>
              <span className="h-px flex-1 bg-slate-700" />
            </div>
            <button
              type="button"
              onClick={() => setFaceLoginOpen(true)}
              className="btn-secondary flex w-full items-center justify-center gap-2"
            >
              <ScanFace className="h-4 w-4" /> Login With Face ID
            </button>
          </motion.div>

          {showBiometricLogin && (
            <motion.div className="mt-3" {...fieldMotion} transition={{ delay: 0.26 }}>
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={biometricLoading}
                className={`btn-primary flex w-full items-center justify-center gap-2 ${biometricLoading ? 'action-pulse' : ''}`}
              >
                {biometricLoading ? <AuthButtonSkeleton /> : <><Fingerprint className="h-4 w-4" /> Login with Biometric</>}
              </button>
            </motion.div>
          )}

          <motion.div className="auth-login-divider mt-4 pt-4 text-center" {...fieldMotion} transition={{ delay: 0.25 }}>
            <p className="auth-login-register text-xs sm:text-sm">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
                Register as Student
              </Link>
            </p>
          </motion.div>

          <motion.div className="auth-login-secure mt-3 flex items-center gap-2 rounded-lg p-2.5" {...fieldMotion} transition={{ delay: 0.3 }}>
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
            <p className="text-[11px] sm:text-xs">Secured with face recognition & end-to-end encryption</p>
          </motion.div>
        </motion.div>
      </motion.div>
      <FaceLoginModal
        open={faceLoginOpen}
        onClose={() => setFaceLoginOpen(false)}
        onSuccess={handleFaceLoginSuccess}
      />
    </div>
  );
}
