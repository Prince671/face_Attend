import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  Calendar,
  Camera,
  CheckCircle,
  Edit3,
  Eye,
  EyeOff,
  Fingerprint,
  GraduationCap,
  KeyRound,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  Upload,
  User,
  X
} from 'lucide-react';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../context/SocketContext';
import { getAcademicBranchLabel, getAcademicLabel, getSemesterLabel } from '../../utils/academicLabels';
import { getPasswordIssues, passwordRules } from '../../utils/passwordPolicy';
import { toDateInputValue } from '../../utils/dateInput';
import {
  BIOMETRIC_CREDENTIAL_KEY,
  isWebAuthnSupported,
  prepareCreationOptions,
  serializeRegistrationCredential
} from '../../utils/webauthn';

const cardMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28 }
};

const formatDateInput = (value) => {
  if (!value) return '';
  return toDateInputValue(value);
};

const normalizePhone = (value = '') => String(value || '').replace(/\s+/g, '').trim();

const InfoItem = ({ icon: Icon, label, value }) => (
  <motion.div
    variants={cardMotion}
    whileHover={{ y: -3, scale: 1.01 }}
    className="rounded-xl border border-white/10 bg-slate-900/70 p-3 transition-colors hover:border-primary-400/30 hover:bg-white/[0.055] sm:p-4"
  >
    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
      <Icon className="h-4 w-4 text-primary-400" />
      {label}
    </div>
    <p className="break-words text-xs font-medium text-white sm:text-sm">{value || '-'}</p>
  </motion.div>
);

export default function StudentProfile() {
  const { user, updateUser } = useAuth();
  const fileInputRef = useRef(null);
  const [registering, setRegistering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [preview, setPreview] = useState(user?.profileImage || '');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [profileForm, setProfileForm] = useState({
    name: '',
    fatherName: '',
    email: '',
    phone: '',
    semester: '',
    address: '',
    dateOfBirth: ''
  });

  const supported = isWebAuthnSupported();
  const academicLabel = getAcademicLabel(user);
  const passwordIssues = getPasswordIssues(passwordForm.newPassword);
  const emailChanged = profileForm.email.trim().toLowerCase() !== String(user?.email || '').toLowerCase();
  const identityFieldsChanged = ['name', 'fatherName', 'phone', 'address'].some(field => (
    String(profileForm[field] || '').trim() !== String(user?.[field] || '').trim()
  )) || String(profileForm.dateOfBirth || '') !== formatDateInput(user?.dateOfBirth);
  const approvalNeeded = identityFieldsChanged || emailChanged;
  const semesterChanged = Number(profileForm.semester) !== Number(user?.semester);
  const semesterLockedUntil = user?.semesterUpdatedAt
    ? new Date(new Date(user.semesterUpdatedAt).getTime() + 24 * 60 * 60 * 1000)
    : null;
  const semesterLocked = semesterChanged && semesterLockedUntil && semesterLockedUntil.getTime() > Date.now();

  useEffect(() => {
    setProfileForm({
      name: user?.name || '',
      fatherName: user?.fatherName || '',
      email: user?.email || '',
      phone: user?.phone || '',
      semester: user?.semester || '',
      address: user?.address || '',
      dateOfBirth: formatDateInput(user?.dateOfBirth)
    });
    setPreview(user?.profileImage || '');
    setEmailOtp('');
    setEmailVerified(false);
    setProfileImage(null);
  }, [user]);

  useRealtimeRefresh(() => {
    authAPI.getMe().then(res => updateUser(res.data.user)).catch(() => {});
  }, ['profile', 'students']);

  const displayDetails = useMemo(() => ([
    { icon: Mail, label: 'Email', value: user?.email },
    { icon: Phone, label: 'Phone', value: user?.phone },
    { icon: User, label: 'Father Name', value: user?.fatherName },
    { icon: Calendar, label: 'Date of Birth', value: user?.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString('en-IN') : '-' },
    { icon: GraduationCap, label: 'Course', value: user?.course },
    { icon: GraduationCap, label: 'Branch', value: getAcademicBranchLabel(user) },
    { icon: MapPin, label: 'Address', value: user?.address }
  ]), [user]);

  const handleRegisterBiometric = async () => {
    if (!supported) {
      toast.error('Biometric login needs HTTPS or localhost and a supported browser.');
      return;
    }

    setRegistering(true);
    try {
      const optionsResponse = await authAPI.beginBiometricRegistration();
      const credential = await navigator.credentials.create({
        publicKey: prepareCreationOptions(optionsResponse.data.options)
      });
      if (!credential) throw new Error('Biometric registration was cancelled.');

      const verifyResponse = await authAPI.finishBiometricRegistration({
        credential: serializeRegistrationCredential(credential),
        deviceName: navigator.userAgent?.slice(0, 80) || 'This device'
      });

      localStorage.setItem(BIOMETRIC_CREDENTIAL_KEY, verifyResponse.data.credentialId);
      updateUser(verifyResponse.data.user);
      toast.success('Biometric login enabled on this device.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not register biometric login.');
    } finally {
      setRegistering(false);
    }
  };

  const sendEmailOtp = async () => {
    const email = profileForm.email.trim().toLowerCase();
    if (!emailChanged) {
      toast.error('Enter a new email first.');
      return;
    }
    setOtpLoading(true);
    try {
      await authAPI.sendProfileEmailOtp({ email });
      setEmailOtp('');
      setEmailVerified(false);
      toast.success('OTP sent to the new email.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send OTP.');
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyEmailOtp = async () => {
    const email = profileForm.email.trim().toLowerCase();
    if (emailOtp.length !== 6) {
      toast.error('Enter the 6-digit OTP.');
      return;
    }
    setOtpLoading(true);
    try {
      await authAPI.verifyProfileEmailOtp({ email, otp: emailOtp });
      setEmailVerified(true);
      toast.success('New email verified.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid OTP.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProfileImage(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    if (emailChanged && !emailVerified) {
      toast.error('Verify OTP on the new email before saving.');
      return;
    }
    if (semesterLocked) {
      toast.error(`Semester can be changed again after ${semesterLockedUntil.toLocaleString()}.`);
      return;
    }

    setSavingProfile(true);
    try {
      const payload = new FormData();
      payload.append('name', profileForm.name.trim());
      payload.append('fatherName', profileForm.fatherName.trim());
      payload.append('email', profileForm.email.trim().toLowerCase());
      payload.append('phone', normalizePhone(profileForm.phone));
      payload.append('semester', profileForm.semester);
      payload.append('address', profileForm.address.trim());
      payload.append('dateOfBirth', profileForm.dateOfBirth || '');
      if (profileImage) payload.append('profileImage', profileImage);

      const res = await authAPI.updateProfile(payload);
      updateUser(res.data.user);
      setEditing(false);
      setEmailOtp('');
      setEmailVerified(false);
      setProfileImage(null);
      toast.success(res.data.message || 'Profile saved.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordUpdate = async (event) => {
    event.preventDefault();
    if (!passwordForm.currentPassword) {
      toast.error('Enter your current password.');
      return;
    }
    if (passwordIssues.length) {
      toast.error(`Password needs: ${passwordIssues.join(', ')}`);
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await authAPI.updateProfile({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
      updateUser(res.data.user);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password updated successfully.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <motion.div className="space-y-4 sm:space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Profile</h1>
          <p className="mt-1 text-sm text-slate-400 sm:text-base">View your student details and manage secure login.</p>
        </div>
        <motion.button
          type="button"
          onClick={() => setEditing(value => !value)}
          className="btn-secondary inline-flex items-center justify-center gap-2"
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.96 }}
        >
          {editing ? <X className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
          {editing ? 'Cancel Edit' : 'Edit Profile'}
        </motion.button>
      </div>

      <motion.section
        {...cardMotion}
        className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 transition-colors hover:border-primary-400/30"
      >
        <div className="flex gap-3 p-3 sm:items-center sm:gap-5 sm:p-5">
          <motion.div whileHover={{ rotate: 1.5, scale: 1.02 }} className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-primary-600/20 ring-1 ring-primary-400/30 sm:h-24 sm:w-24">
            {preview ? (
              <img src={preview} alt={user?.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-primary-300">{user?.name?.[0]}</div>
            )}
            {editing && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-x-1.5 bottom-1.5 flex h-6 items-center justify-center rounded-md bg-black/75 px-1 text-[9px] leading-none text-white backdrop-blur sm:inset-x-2 sm:bottom-2 sm:h-7 sm:text-[10px]"
              >
                <Camera className="mr-1 h-3 w-3" /> Change
              </button>
            )}
          </motion.div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-white">{user?.name}</h2>
            <p className="mt-1 font-mono text-sm text-slate-400">{user?.studentId}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-primary-400/30 bg-primary-500/10 px-3 py-1 text-xs text-primary-200">{academicLabel}</span>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">{getSemesterLabel(user?.semester)}</span>
              <span className="rounded-full border border-slate-500/30 bg-slate-800 px-3 py-1 text-xs text-slate-300">{user?.status}</span>
              {user?.pendingProfileUpdate?.status === 'pending' && (
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">profile request pending</span>
              )}
            </div>
          </div>
        </div>
      </motion.section>

      <AnimatePresence mode="wait">
        {editing ? (
          <motion.form
            key="edit-profile"
            {...cardMotion}
            exit={{ opacity: 0, y: -10 }}
            onSubmit={handleProfileSave}
            className="rounded-2xl border border-white/10 bg-slate-900/60 p-3 sm:p-5"
          >
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100 sm:gap-3 sm:text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="min-w-0">Profile detail changes are sent to your department admin for approval. Semester can be changed only once every 24 hours.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <label className="label">Full Name</label>
                <input className="input-field" value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} />
              </div>
              <div className="min-w-0">
                <label className="label">Father Name</label>
                <input className="input-field" value={profileForm.fatherName} onChange={e => setProfileForm({ ...profileForm, fatherName: e.target.value })} />
              </div>
              <div className="min-w-0">
                <label className="label">Email</label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input className="input-field min-w-0" value={profileForm.email} onChange={e => { setProfileForm({ ...profileForm, email: e.target.value }); setEmailVerified(false); }} />
                  {emailChanged && (
                    <button type="button" onClick={sendEmailOtp} disabled={otpLoading} className="btn-secondary min-w-[7rem] whitespace-nowrap px-3">
                      Send OTP
                    </button>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <label className="label">Phone</label>
                <input className="input-field" value={profileForm.phone} onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })} />
              </div>
              {emailChanged && (
                <div className="min-w-0 md:col-span-2">
                  <label className="label">Verify New Email OTP</label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      className="input-field min-w-0 text-center font-mono text-lg tracking-[0.22em] sm:text-left sm:tracking-[0.3em]"
                      value={emailOtp}
                      maxLength={6}
                      onChange={e => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                    />
                    <button type="button" onClick={verifyEmailOtp} disabled={otpLoading || emailOtp.length !== 6 || emailVerified} className="btn-primary min-w-[7rem] whitespace-nowrap px-4">
                      {emailVerified ? <CheckCircle className="h-4 w-4" /> : 'Verify'}
                    </button>
                  </div>
                </div>
              )}
              <div className="min-w-0">
                <label className="label">Semester</label>
                <select className="input-field" value={profileForm.semester} onChange={e => setProfileForm({ ...profileForm, semester: e.target.value })}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(sem => <option key={sem} value={sem}>Semester {sem}</option>)}
                </select>
                {semesterLocked && (
                  <p className="mt-1 text-xs text-amber-300">You can edit semester again after {semesterLockedUntil.toLocaleString()}.</p>
                )}
              </div>
              <div className="min-w-0">
                <label className="label">Date of Birth</label>
                <input
                  type="date"
                  className="input-field"
                  value={profileForm.dateOfBirth}
                  onChange={e => setProfileForm({ ...profileForm, dateOfBirth: e.target.value })}
                />
              </div>
              <div className="min-w-0 md:col-span-2">
                <label className="label">Address</label>
                <textarea className="input-field min-h-[88px]" value={profileForm.address} onChange={e => setProfileForm({ ...profileForm, address: e.target.value })} />
              </div>
            </div>

            {profileImage && (
              <div className="mt-4 rounded-xl border border-primary-400/20 bg-primary-500/10 p-3 text-sm text-primary-100">
                <Upload className="mr-2 inline h-4 w-4" />
                New profile image will be checked by ML for front-facing quality and face match before saving.
              </div>
            )}

            <button type="submit" disabled={savingProfile || (emailChanged && !emailVerified)} className={`btn-primary mt-4 inline-flex items-center gap-2 ${savingProfile ? 'action-pulse' : ''}`}>
              <Save className="h-4 w-4" />
              {savingProfile ? 'Saving...' : approvalNeeded ? 'Submit Request' : 'Save Profile'}
            </button>
          </motion.form>
        ) : (
          <motion.section key="read-profile" className="card-strip sm:grid-cols-2 xl:grid-cols-3" initial="initial" animate="animate">
            {displayDetails.map(item => <InfoItem key={item.label} {...item} />)}
          </motion.section>
        )}
      </AnimatePresence>

      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-3 transition-colors hover:border-primary-400/30 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-2xl bg-primary-500/10 p-3 ring-1 ring-primary-400/20">
            <KeyRound className="h-6 w-6 text-primary-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Password</h2>
            <p className="mt-1 text-sm text-slate-400">Update your password while logged in. OTP is not required here.</p>
          </div>
        </div>
        <form onSubmit={handlePasswordUpdate} className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="label">Current Password</label>
            <div className="relative">
              <input
                type={showPasswords ? 'text' : 'password'}
                className="input-field pr-10"
                value={passwordForm.currentPassword}
                onChange={event => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
                placeholder="Enter current password"
              />
              <button type="button" onClick={() => setShowPasswords(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">New Password</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              className="input-field"
              value={passwordForm.newPassword}
              onChange={event => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
              placeholder="Strong password"
            />
          </div>
          <div>
            <label className="label">Confirm Password</label>
            <input
              type={showPasswords ? 'text' : 'password'}
              className="input-field"
              value={passwordForm.confirmPassword}
              onChange={event => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
              placeholder="Repeat new password"
            />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 md:col-span-2">
            <div className="grid gap-1 text-xs sm:grid-cols-2">
              {passwordRules.map(rule => (
                <span key={rule.id} className={rule.test(passwordForm.newPassword) ? 'text-emerald-300' : 'text-slate-500'}>
                  {rule.test(passwordForm.newPassword) ? 'OK' : '-'} {rule.label}
                </span>
              ))}
            </div>
          </div>
          <button type="submit" disabled={passwordSaving} className={`btn-primary md:self-start ${passwordSaving ? 'action-pulse' : ''}`}>
            {passwordSaving ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-3 transition-colors hover:border-emerald-400/30 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-emerald-500/10 p-3 ring-1 ring-emerald-400/20">
              <Fingerprint className="h-6 w-6 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Biometric Login</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Register this phone or laptop to sign in with fingerprint, face unlock, PIN, or screen lock. Your biometric data stays on your device.
              </p>
              {user?.hasBiometric && (
                <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" /> Biometric login is enabled
                </p>
              )}
            </div>
          </div>

          <motion.button
            type="button"
            onClick={handleRegisterBiometric}
            disabled={registering || !supported}
            className={`btn-primary flex items-center justify-center gap-2 ${registering ? 'action-pulse' : ''}`}
            whileHover={{ scale: registering ? 1 : 1.01 }}
            whileTap={{ scale: 0.98 }}
          >
            {registering ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Fingerprint className="h-4 w-4" />}
            {user?.hasBiometric ? 'Update Biometric' : 'Register Your Biometric'}
          </motion.button>
        </div>
        {!supported && (
          <p className="mt-3 text-sm text-amber-300">Open the app on localhost or HTTPS in a modern mobile browser to register phone biometrics.</p>
        )}
      </section>
    </motion.div>
  );
}
