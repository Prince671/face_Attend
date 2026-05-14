import React, { useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Fingerprint, Mail, Phone, MapPin, GraduationCap, ShieldCheck, User, Calendar } from 'lucide-react';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  BIOMETRIC_CREDENTIAL_KEY,
  isWebAuthnSupported,
  prepareCreationOptions,
  serializeRegistrationCredential
} from '../../utils/webauthn';

const InfoItem = ({ icon: Icon, label, value }) => (
  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3 sm:p-4">
    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
      <Icon className="h-4 w-4 text-primary-400" />
      {label}
    </div>
    <p className="break-words text-xs font-medium text-white sm:text-sm">{value || '-'}</p>
  </div>
);

export default function StudentProfile() {
  const { user, updateUser } = useAuth();
  const [registering, setRegistering] = useState(false);
  const supported = isWebAuthnSupported();

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

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Profile</h1>
        <p className="mt-1 text-sm text-slate-400 sm:text-base">View your student details and manage secure login.</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
        <div className="flex gap-3 p-3 sm:gap-5 sm:p-5 sm:items-center">
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-primary-600/20 ring-1 ring-primary-400/30 sm:h-24 sm:w-24">
            {user?.profileImage ? (
              <img src={user.profileImage} alt={user.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-primary-300">{user?.name?.[0]}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-white">{user?.name}</h2>
            <p className="mt-1 font-mono text-sm text-slate-400">{user?.studentId}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-primary-400/30 bg-primary-500/10 px-3 py-1 text-xs text-primary-200">{user?.department}</span>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">Semester {user?.semester}</span>
              <span className="rounded-full border border-slate-500/30 bg-slate-800 px-3 py-1 text-xs text-slate-300">{user?.status}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-3">
        <InfoItem icon={Mail} label="Email" value={user?.email} />
        <InfoItem icon={Phone} label="Phone" value={user?.phone} />
        <InfoItem icon={User} label="Father Name" value={user?.fatherName} />
        <InfoItem icon={Calendar} label="Date of Birth" value={user?.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString('en-IN') : '-'} />
        <InfoItem icon={GraduationCap} label="Department" value={user?.department} />
        <InfoItem icon={MapPin} label="Address" value={user?.address} />
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-3 sm:p-5">
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
    </div>
  );
}
