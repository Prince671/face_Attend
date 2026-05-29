import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Eye, EyeOff, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { authAPI } from '../../services/api';
import ThemeToggle from '../../components/ThemeToggle';
import { AuthButtonSkeleton } from '../../components/LoadingStates';
import { getPasswordIssues, passwordRules } from '../../utils/passwordPolicy';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordIssues = getPasswordIssues(password);

  const sendOtp = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      await authAPI.sendForgotPasswordOtp({ email });
      toast.success('OTP sent to your registered email.');
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await authAPI.verifyForgotPasswordOtp({ email, otp });
      setResetToken(res.data.resetToken);
      toast.success('OTP verified.');
      setStep(3);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid OTP.');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    if (passwordIssues.length) {
      toast.error(`Password needs: ${passwordIssues.join(', ')}`);
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await authAPI.resetForgotPassword({ email, resetToken, password });
      toast.success('Password changed. Please sign in.');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-login-page min-h-dvh flex items-center justify-center relative overflow-hidden p-4">
      <ThemeToggle className="fixed right-4 top-4 z-20" />
      <div className="auth-login-bg absolute inset-0">
        <div className="auth-login-grid absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-md">
        <Link to="/login" className="mb-4 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>
        <div className="glass-card">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600/20 ring-1 ring-primary-400/30">
              <KeyRound className="h-7 w-7 text-primary-300" />
            </div>
            <h1 className="font-display text-2xl font-bold text-white">Forgot Password</h1>
            <p className="mt-1 text-sm text-slate-400">Verify your registered email before setting a new password.</p>
          </div>

          {step === 1 && (
            <form onSubmit={sendOtp} className="space-y-4">
              <div>
                <label className="label">Registered Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input className="input-field pl-10" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@college.edu" required />
                </div>
              </div>
              <button className={`btn-primary w-full ${loading ? 'action-pulse' : ''}`} disabled={loading}>
                {loading ? <AuthButtonSkeleton /> : 'Send OTP'}
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={verifyOtp} className="space-y-4">
              <div>
                <label className="label">Email OTP</label>
                <input className="input-field text-center tracking-[0.4em]" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />
              </div>
              <button className={`btn-primary w-full ${loading ? 'action-pulse' : ''}`} disabled={loading || otp.length !== 6}>
                {loading ? <AuthButtonSkeleton /> : 'Verify OTP'}
              </button>
              <button type="button" onClick={sendOtp} className="btn-secondary w-full" disabled={loading}>Resend OTP</button>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={resetPassword} className="space-y-4">
              <div>
                <label className="label">New Password</label>
                <div className="relative">
                  <input className="input-field pr-12" type={showPass ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Strong password" required />
                  <button type="button" onClick={() => setShowPass(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <input className="input-field" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Repeat new password" required />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-300"><ShieldCheck className="h-4 w-4 text-emerald-300" /> Password must include</p>
                <div className="grid gap-1 text-xs">
                  {passwordRules.map(rule => (
                    <span key={rule.id} className={rule.test(password) ? 'text-emerald-300' : 'text-slate-500'}>{rule.test(password) ? '✓' : '•'} {rule.label}</span>
                  ))}
                </div>
              </div>
              <button className={`btn-primary w-full ${loading ? 'action-pulse' : ''}`} disabled={loading}>
                {loading ? <AuthButtonSkeleton /> : 'Reset Password'}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
