import React from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Download, Printer, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';

const CAMPUS_IMAGE = '/id-assets/original-id-card-reference.jpg';

const formatDob = (value) => {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not provided';
  const day = date.getDate();
  const month = date.toLocaleDateString('en-IN', { month: 'short' });
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
};

const getSession = (createdAt) => {
  const start = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  const end = String(start + 4).slice(-2);
  return `${start}-${end}`;
};

const getClassLabel = (user) => {
  const dept = user?.department || 'Student';
  const compact = dept
    .replace(/Computer Science/i, 'CSE')
    .replace(/Information Technology/i, 'IT')
    .replace(/Electronics/i, 'EC')
    .replace(/Mechanical/i, 'ME')
    .replace(/Electrical/i, 'EE')
    .replace(/Civil/i, 'CE')
    .toUpperCase();
  return `B Tech - ${compact}`;
};

export default function StudentIdCard() {
  const { user } = useAuth();
  const photo = user?.profileImage;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary-400" /> Student Identity Card
          </h1>
          <p className="text-slate-400 mt-1">Generated from your approved registration details</p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-2">
          <Printer className="w-4 h-4" /> Print / Save
        </button>
      </div>

      <AdminBreadcrumb items={[
        { label: user?.department || 'Department' },
        user?.semester && { label: `Semester ${user.semester}` },
        { label: 'ID Card' }
      ]} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,360px)_1fr] gap-6 items-start">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 180, damping: 22 }}
          className="student-id-print-area flex justify-center xl:justify-start"
        >
          <div className="student-id-card">
            <div className="student-id-card__top">
              <p className="student-id-card__college">VITS GROUP OF INSTITUTIONS</p>
              <p className="student-id-card__city">SATNA (M.P.)</p>
            </div>

            <div className="student-id-card__band">IDENTITY CARD</div>

            <div className="student-id-card__photo-row">
              <div className="student-id-card__side">
                <span>BATCH</span>
                <strong>{getSession(user?.createdAt)}</strong>
              </div>
              <div className="student-id-card__photo">
                {photo ? <img src={photo} alt={user?.name || 'Student'} /> : <span>{user?.name?.[0] || 'S'}</span>}
              </div>
              <div className="student-id-card__side student-id-card__side--empty" aria-hidden="true" />
            </div>

            <div className="student-id-card__name">{user?.name || 'Student Name'}</div>

            <div className="student-id-card__details">
              <div><span>F.Name</span><em>:</em><strong>{user?.fatherName || 'Not provided'}</strong></div>
              <div><span>D.O.B.</span><em>:</em><strong>{formatDob(user?.dateOfBirth)}</strong></div>
              <div><span>Course</span><em>:</em><strong>{getClassLabel(user)}</strong></div>
              <div><span>Contact</span><em>:</em><strong>{user?.phone || 'Not provided'}</strong></div>
              <div><span>En. No.</span><em>:</em><strong>{user?.enrollmentNo || user?.studentId || '-'}</strong></div>
            </div>

            <div className="student-id-card__signature">
              <span>Verified</span>
              <strong>C.A.O.</strong>
            </div>

            <div className="student-id-card__campus">
              <img src={CAMPUS_IMAGE} alt="College campus" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-card space-y-5 w-full"
        >
          <div>
            <h2 className="text-lg font-semibold text-white">Profile Information</h2>
            <p className="text-slate-400 text-sm mt-1">These details are used to generate your digital identity card.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              ['Name', user?.name],
              ['Student ID', user?.studentId],
              ['Email', user?.email],
              ['Department', user?.department],
              ['Semester', user?.semester ? `Semester ${user.semester}` : '-'],
              ['Father Name', user?.fatherName || 'Not provided'],
              ['Date of Birth', formatDob(user?.dateOfBirth)],
              ['Contact', user?.phone || 'Not provided'],
              ['Address', user?.address || 'Not provided']
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm text-white mt-1">{value || '-'}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 flex gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-emerald-300 font-medium text-sm">Generated after registration</p>
              <p className="text-emerald-400/80 text-xs mt-1">Your card uses your passport photo and registered student details.</p>
            </div>
          </div>

          <button type="button" onClick={() => window.print()} className="btn-primary inline-flex items-center gap-2">
            <Download className="w-4 h-4" /> Download / Print ID Card
          </button>
        </motion.div>
      </div>
    </div>
  );
}
