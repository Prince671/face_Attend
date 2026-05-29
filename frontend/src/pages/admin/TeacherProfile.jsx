import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Bell, BookOpen, Camera, Eye, EyeOff, Fingerprint, Lock, Mail, Phone, Pencil, Save, ShieldCheck, User, X } from 'lucide-react';
import { authAPI, subjectAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../context/SocketContext';
import { SkeletonLine } from '../../components/LoadingStates';
import {
  BIOMETRIC_CREDENTIAL_KEY,
  isWebAuthnSupported,
  prepareCreationOptions,
  serializeRegistrationCredential
} from '../../utils/webauthn';

const initialsFor = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'T';
  return [parts[0], parts[Math.floor(parts.length / 2)], parts[parts.length - 1]]
    .filter(Boolean)
    .filter((part, index, arr) => arr.indexOf(part) === index)
    .map(part => part[0]?.toUpperCase())
    .join('')
    .slice(0, 3);
};

export default function TeacherProfile() {
  const { user, updateUser } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: user?.address || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [profileImage, setProfileImage] = useState(null);
  const [preview, setPreview] = useState(user?.profileImage || '');
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false
  });
  const supported = isWebAuthnSupported();
  const initials = useMemo(() => initialsFor(form.name || user?.name), [form.name, user?.name]);
  const scopedSemester = Number(user?.adminSemesterScope || user?.semester || 0);
  const semesterSubjects = useMemo(() => (
    subjects.filter(subject => !scopedSemester || Number(subject.semester) === scopedSemester)
  ), [subjects, scopedSemester]);

  useEffect(() => {
    let mounted = true;
    const loadSubjects = async () => {
      setSubjectsLoading(true);
      try {
        const res = await subjectAPI.getMine();
        if (mounted) setSubjects(res.data.subjects || []);
      } catch (_) {
        if (mounted) setSubjects([]);
      } finally {
        if (mounted) setSubjectsLoading(false);
      }
    };
    loadSubjects();
    return () => { mounted = false; };
  }, []);

  useRealtimeRefresh(() => {
    authAPI.getMe().then(res => updateUser(res.data.user)).catch(() => {});
    subjectAPI.getMine().then(res => setSubjects(res.data.subjects || [])).catch(() => {});
  }, ['profile', 'teachers', 'subjects']);

  const togglePassword = (field) => {
    setVisiblePasswords(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const PasswordInput = ({ field, label, placeholder }) => (
    <label className="block">
      <span className="label flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> {label}</span>
      <div className="relative">
        <input
          type={visiblePasswords[field] ? 'text' : 'password'}
          className="input-field pr-12"
          value={form[field]}
          onChange={e => setForm({ ...form, [field]: e.target.value })}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => togglePassword(field)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          aria-label={visiblePasswords[field] ? `Hide ${label}` : `Show ${label}`}
        >
          {visiblePasswords[field] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );

  const onImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProfileImage(file);
    setPreview(URL.createObjectURL(file));
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = new FormData();
      payload.append('name', form.name);
      payload.append('email', form.email);
      payload.append('phone', form.phone);
      payload.append('address', form.address);
      if (profileImage) payload.append('profileImage', profileImage);
      const res = await authAPI.updateProfile(payload);
      updateUser(res.data.user);
      setProfileImage(null);
      setPreview(res.data.user.profileImage || '');
      setEditingProfile(false);
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    if (!form.currentPassword || !form.newPassword) {
      toast.error('Current and new password are required');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      toast.error('New password and confirmation do not match');
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await authAPI.updateProfile({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      updateUser(res.data.user);
      setForm(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
      toast.success('Password updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update password');
    } finally {
      setPasswordSaving(false);
    }
  };

  const registerBiometric = async () => {
    if (!supported) {
      toast.error('Biometric setup needs HTTPS or localhost and a supported browser.');
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
      toast.success('Biometric login enabled');
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not register biometric login.');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Teacher Profile</h1>
          <p className="mt-1 text-sm text-slate-400">Only your name and Gmail are public to other teachers. Contact, address, password, and biometric details stay private.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditingProfile(value => !value)}
          className="mobile-icon-btn rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
          title={editingProfile ? 'Cancel editing' : 'Edit profile'}
        >
          {editingProfile ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </button>
      </div>

      <form onSubmit={saveProfile} className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <section className="glass-card overflow-hidden">
          <div className="flex flex-col items-center text-center">
            <div className="relative h-28 w-28 overflow-hidden rounded-3xl bg-primary-500/15 ring-1 ring-primary-400/30">
              {preview ? (
                <img src={preview} alt={form.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-primary-200">{initials}</div>
              )}
              {editingProfile && (
                <label className="absolute bottom-2 right-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-slate-950/90 text-primary-200 ring-1 ring-white/10 hover:bg-primary-600">
                  <Camera className="h-4 w-4" />
                  <input type="file" accept="image/*" className="hidden" onChange={onImageChange} />
                </label>
              )}
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">{user?.name}</h2>
            <p className="text-sm text-primary-300">{user?.email}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {(user?.departments || [user?.department]).filter(Boolean).map(department => <span key={department} className="badge-neutral">{department}</span>)}
              {user?.adminSemesterScope && <span className="badge-info">Semester {user.adminSemesterScope}</span>}
            </div>
          </div>
        </section>

        <section className="glass-card space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label flex items-center gap-2"><User className="h-3.5 w-3.5" /> Public Name</span>
              <input className="input-field disabled:opacity-75" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required disabled={!editingProfile} />
            </label>
            <label className="block">
              <span className="label flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> Gmail</span>
              <input type="email" className="input-field disabled:opacity-75" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required disabled={!editingProfile} />
            </label>
            <label className="block">
              <span className="label flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> Private Contact</span>
              <input className="input-field disabled:opacity-75" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone number" disabled={!editingProfile} />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">Private Address</span>
              <input className="input-field disabled:opacity-75" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address" disabled={!editingProfile} />
            </label>
          </div>
          {editingProfile && (
            <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2">
              {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          )}
        </section>
      </form>

      <form onSubmit={updatePassword} className="glass-card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Update Password</h2>
          <p className="mt-1 text-sm text-slate-400">Password changes are separate from profile details.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PasswordInput field="currentPassword" label="Current Password" placeholder="Current password" />
          <PasswordInput field="newPassword" label="New Password" placeholder="New password" />
          <PasswordInput field="confirmPassword" label="Confirm Password" placeholder="Confirm new password" />
        </div>
        <button type="submit" disabled={passwordSaving} className="btn-secondary inline-flex items-center gap-2">
          {passwordSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Lock className="h-4 w-4" />}
          {passwordSaving ? 'Updating...' : 'Update Password'}
        </button>
      </form>

      <section className="glass-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-primary-500/10 p-3 ring-1 ring-primary-400/20">
              <Bell className="h-6 w-6 text-primary-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Semester Assignment Notice</h2>
              <p className="mt-1 text-sm text-slate-400">
                {scopedSemester
                  ? `Subjects assigned to you for Semester ${scopedSemester} are shown here and also sent to your notifications.`
                  : 'Subjects assigned to you are shown here and also sent to your notifications.'}
              </p>
            </div>
          </div>
          <span className="badge-info whitespace-nowrap">
            {subjectsLoading ? 'Checking assignments' : `${semesterSubjects.length} assigned`}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {subjectsLoading ? (
            [0, 1, 2].map(item => <SkeletonLine key={item} className="h-20 rounded-2xl" />)
          ) : semesterSubjects.length ? (
            semesterSubjects.map(subject => (
              <div key={subject._id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-primary-500/10 p-2 text-primary-300">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{subject.name}</p>
                    <p className="text-xs text-primary-300">{subject.code}</p>
                    <p className="mt-1 text-xs text-slate-500">{subject.branch || subject.department} - Semester {subject.semester}</p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400 sm:col-span-2 xl:col-span-3">
              No subjects are assigned for this semester yet.
            </div>
          )}
        </div>
      </section>

      <section className="glass-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-emerald-500/10 p-3 ring-1 ring-emerald-400/20">
              <Fingerprint className="h-6 w-6 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Biometric Login</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">Register this device to sign in using fingerprint, face unlock, PIN, or screen lock. Biometric data never leaves your device.</p>
              {user?.hasBiometric && (
                <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" /> Biometric login is enabled
                </p>
              )}
            </div>
          </div>
          <motion.button type="button" onClick={registerBiometric} disabled={registering || !supported} className="btn-primary flex items-center justify-center gap-2">
            {registering ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Fingerprint className="h-4 w-4" />}
            {user?.hasBiometric ? 'Update Biometric' : 'Register Biometric'}
          </motion.button>
        </div>
        {!supported && <p className="mt-3 text-sm text-amber-300">Use HTTPS or localhost in a modern browser to register biometrics.</p>}
      </section>

    </div>
  );
}
