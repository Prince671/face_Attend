import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Fingerprint, Scan, ScanFace, ShieldCheck } from 'lucide-react';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../../components/ThemeToggle';
import FaceLoginModal from '../../components/FaceLoginModal';
import {
  BIOMETRIC_CREDENTIAL_KEY,
  isWebAuthnSupported,
  prepareRequestOptions,
  serializeAssertionCredential
} from '../../utils/webauthn';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [faceLoginOpen, setFaceLoginOpen] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const showBiometricLogin = isWebAuthnSupported() && Boolean(localStorage.getItem(BIOMETRIC_CREDENTIAL_KEY));

  const fieldMotion = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authAPI.login(form);
      login(res.data.token, res.data.user);
      if (res.data.requiresAdminScope) sessionStorage.removeItem('adminScopeSelected');
      toast.success(`Welcome back, ${res.data.user.name}!`);
      navigate(res.data.user.role === 'admin' ? '/admin' : '/student');
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
    <div className="auth-login-page min-h-screen flex items-center justify-center relative overflow-hidden">
      <ThemeToggle className="fixed right-4 top-4 z-20" />
      {/* Background */}
      <div className="auth-login-bg absolute inset-0">
        {/* Grid */}
        <div className="auth-login-grid absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        {/* Logo */}
        <motion.div className="text-center mb-8" initial="initial" animate="animate">
          <motion.div
            className="auth-login-logo inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            variants={fieldMotion}
            transition={{ duration: 0.32 }}
            whileHover={{ scale: 1.04, rotate: 1 }}
          >
            <Scan className="w-8 h-8 text-primary-400" />
          </motion.div>
          <motion.h1 className="auth-login-title font-display text-3xl font-bold" variants={fieldMotion} transition={{ duration: 0.32, delay: 0.05 }}>FaceAttend</motion.h1>
          <motion.p className="auth-login-subtitle mt-1" variants={fieldMotion} transition={{ duration: 0.32, delay: 0.1 }}>AI-Powered Attendance Management</motion.p>
        </motion.div>

        {/* Card */}
        <motion.div className="auth-login-card glass-card" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
          <motion.h2 className="auth-login-heading text-xl font-semibold mb-6" {...fieldMotion} transition={{ delay: 0.12 }}>Sign In</motion.h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div {...fieldMotion} transition={{ delay: 0.16 }}>
              <label className="label">Email Address</label>
              <input
                type="text"
                inputMode="email"
                autoComplete="email"
                className="input-field"
                placeholder="you@school.edu"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
              />
            </motion.div>
            <motion.div {...fieldMotion} transition={{ delay: 0.2 }}>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  className="input-field pr-12"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="auth-login-eye absolute right-3 top-1/2 -translate-y-1/2 transition-colors">
                  {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </motion.div>

            <motion.button
              type="submit"
              disabled={loading}
              className={`btn-primary w-full mt-2 ${loading ? 'action-pulse' : ''}`}
              whileHover={{ scale: loading ? 1 : 1.01 }}
              whileTap={{ scale: 0.98 }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign In'}
            </motion.button>

          </form>

          <motion.div className="auth-login-divider mt-6 pt-6" {...fieldMotion} transition={{ delay: 0.24 }}>
            <div className="mb-4 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
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
                {biometricLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Fingerprint className="h-4 w-4" />}
                {biometricLoading ? 'Checking biometric...' : 'Login with Biometric'}
              </button>
            </motion.div>
          )}

          <motion.div className="auth-login-divider mt-6 pt-6 text-center" {...fieldMotion} transition={{ delay: 0.25 }}>
            <p className="auth-login-register text-sm">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
                Register as Student
              </Link>
            </p>
          </motion.div>

          <motion.div className="auth-login-secure mt-4 flex items-center gap-2 rounded-xl p-3" {...fieldMotion} transition={{ delay: 0.3 }}>
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <p className="text-xs">Secured with face recognition & end-to-end encryption</p>
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
