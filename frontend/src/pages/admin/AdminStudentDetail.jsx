import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, UserX, UserCheck, Trash2, Shield, ShieldOff, BookOpen, ArrowLeft, Clock } from 'lucide-react';
import { adminAPI, subjectAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import { handleDeleteScheduled } from '../../utils/deleteUndo';
import { getAcademicBranchLabel, getAcademicLabel, getSemesterLabel } from '../../utils/academicLabels';
import { useSocket } from '../../context/SocketContext';

const normalizeBranch = (value) => {
  const branch = String(value || '').trim();
  return /^(general|unassigned branch)$/i.test(branch) ? '' : branch;
};

const isComputerScienceDepartment = (department) => /computer|cse|cs/i.test(String(department || ''));

const subjectMatchesStudent = (subject, student) => {
  if (!subject || !student) return false;
  if (subject.department !== student.department) return false;
  if (Number(subject.semester) !== Number(student.semester)) return false;
  if (!isComputerScienceDepartment(subject.department)) return true;
  const studentBranch = normalizeBranch(student.branch) || 'Computer Science';
  const subjectBranch = normalizeBranch(subject.branch) || 'Computer Science';
  return studentBranch === subjectBranch;
};

export default function AdminStudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [student, setStudent] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [enrolled, setEnrolled] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const loadStudent = useCallback(() => {
    setLoading(true);
    Promise.all([adminAPI.getById(id), subjectAPI.getAll()])
      .then(([s, sub]) => {
        setStudent(s.data.student);
        setSubjects(sub.data.subjects);
        setEnrolled(s.data.student.enrolledSubjects?.map(e => e._id || e) || []);
      }).catch(() => toast.error('Failed to load student'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadStudent();
  }, [loadStudent]);

  useEffect(() => {
    if (!socket) return undefined;
    const refreshIfCurrentStudent = (data = {}) => {
      if (!data.studentId || String(data.studentId) === String(id)) loadStudent();
    };
    socket.on('student_profile_changed', refreshIfCurrentStudent);
    return () => socket.off('student_profile_changed', refreshIfCurrentStudent);
  }, [socket, id, loadStudent]);

  const handleAction = async (action) => {
    try {
      if (action === 'approve') { await adminAPI.approve(id); toast.success('Approved!'); }
      else if (action === 'activate') { await adminAPI.activate(id); toast.success('Activated!'); }
      else if (action === 'deactivate') { await adminAPI.deactivate(id); toast.success('Deactivated'); }
      else if (action === 'restrict') { await adminAPI.restrict(id, 'Manually restricted by admin'); toast.success('Restricted'); }
      else if (action === 'unrestrict') { await adminAPI.unrestrict(id); toast.success('Unrestricted'); }
      else if (action === 'delete') {
        const res = await adminAPI.delete(id);
        handleDeleteScheduled({ response: res, label: 'Student' });
        setDeleteModalOpen(false);
        navigate('/admin/students');
        return;
      }
      const res = await adminAPI.getById(id);
      setStudent(res.data.student);
    } catch (e) { toast.error(e.response?.data?.message || 'Action failed'); }
  };

  const handleEnroll = async () => {
    setSaving(true);
    try {
      await adminAPI.enroll(id, enrolled);
      toast.success('Subjects updated!');
    } catch { toast.error('Failed to update subjects'); }
    finally { setSaving(false); }
  };

  const handleProfileUpdateReview = async (status) => {
    try {
      if (status === 'approved') {
        await adminAPI.approveProfileUpdate(id);
        toast.success('Profile update approved.');
      } else {
        await adminAPI.rejectProfileUpdate(id, 'Rejected by department admin');
        toast.success('Profile update rejected.');
      }
      const res = await adminAPI.getById(id);
      setStudent(res.data.student);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not review profile update.');
    }
  };

  if (loading) return <PageSkeleton variant="detail" rows={5} />;
  if (!student) return <div className="text-center py-20 text-slate-400">Student not found</div>;
  const academicLabel = getAcademicLabel(student);
  const matchingSubjects = subjects.filter(subject => subjectMatchesStudent(subject, student));

  return (
    <div className="space-y-6 max-w-4xl">
      <AppConfirmModal
        open={deleteModalOpen}
        title="Delete Student?"
        message={`This will hide ${student.name} now. Their profile image, attendance captures, attendance records, and account will be permanently deleted after 10 minutes unless you undo it from the dashboard tray.`}
        confirmLabel="Schedule Delete"
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={() => handleAction('delete')}
      />
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Students
      </button>

      <AdminBreadcrumb items={[
        { label: 'Departments', onClick: () => navigate('/admin/students') },
        { label: academicLabel },
        student.semester && { label: getSemesterLabel(student.semester) },
        { label: student.name }
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile */}
        <div className="glass-card text-center">
          <div className="w-32 h-36 rounded-2xl overflow-hidden mx-auto mb-4 border-2 border-white/10">
            {student.profileImage
              ? <img src={student.profileImage} alt={student.name} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-white/10 flex items-center justify-center text-4xl font-bold text-slate-300">{student.name[0]}</div>}
          </div>
          <h2 className="font-display text-xl font-bold text-white">{student.name}</h2>
          <p className="text-slate-400 text-sm">{student.email}</p>
          <p className="font-mono text-primary-400 text-sm mt-1">{student.studentId}</p>

          <div className="mt-4 space-y-2 text-sm text-left">
            {[
              ['Course', student.course || '-'],
              ['Branch', getAcademicBranchLabel(student)],
              ['Department', student.department],
              ['Semester', getSemesterLabel(student.semester)],
              ['Phone', student.phone || '—'],
              ['Joined', new Date(student.createdAt).toLocaleDateString()],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <span className="text-slate-500">{l}</span>
                <span className="text-slate-300">{v}</span>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <span className={`badge ${
              student.status === 'active' ? 'badge-success' :
              student.status === 'pending' ? 'badge-warning' :
              student.status === 'restricted' ? 'badge-danger' : 'badge-neutral'
            }`}>
              {student.isRestricted ? '🚫 Restricted' : student.status}
            </span>
          </div>
        </div>

        {/* Actions + Subjects */}
        <div className="lg:col-span-2 space-y-6">
          {student.pendingProfileUpdate?.status === 'pending' && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card border-amber-400/30"
            >
              <div className="mb-4 flex items-start gap-3">
                <div className="rounded-xl bg-amber-500/10 p-3 text-amber-300">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Pending Profile Update</h3>
                  <p className="mt-1 text-sm text-slate-400">Review the requested student identity changes before they are applied.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(student.pendingProfileUpdate.requestedFields || {}).map(([field, value]) => (
                  <div key={field} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{field}</p>
                    <p className="mt-1 text-sm font-medium text-white">{String(value || '-')}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => handleProfileUpdateReview('approved')} className="btn-success inline-flex items-center justify-center gap-2">
                  <CheckCircle className="h-4 w-4" /> Approve Changes
                </button>
                <button type="button" onClick={() => handleProfileUpdateReview('rejected')} className="btn-danger inline-flex items-center justify-center gap-2">
                  <XCircle className="h-4 w-4" /> Reject Changes
                </button>
              </div>
            </motion.div>
          )}

          {/* Actions */}
          <div className="glass-card">
            <h3 className="font-semibold text-white mb-4">Account Actions</h3>
            <div className="flex flex-wrap gap-3">
              {student.status === 'pending' && (
                <>
                  <button onClick={() => handleAction('approve')} className="btn-success flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" /> Approve
                  </button>
                  <button onClick={() => setDeleteModalOpen(true)} className="btn-danger flex items-center gap-2">
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                </>
              )}
              {student.status === 'active' && (
                <>
                  <button onClick={() => handleAction('deactivate')} className="btn-secondary flex items-center gap-2">
                    <UserX className="w-4 h-4" /> Deactivate
                  </button>
                  {!student.isRestricted && (
                    <button onClick={() => handleAction('restrict')} className="btn-danger flex items-center gap-2">
                      <Shield className="w-4 h-4" /> Mark Restricted
                    </button>
                  )}
                </>
              )}
              {student.status === 'inactive' && (
                <button onClick={() => handleAction('activate')} className="btn-success flex items-center gap-2">
                  <UserCheck className="w-4 h-4" /> Activate
                </button>
              )}
              {student.isRestricted && (
                <button onClick={() => handleAction('unrestrict')} className="btn-success flex items-center gap-2">
                  <ShieldOff className="w-4 h-4" /> Unrestrict Profile
                </button>
              )}
              <button onClick={() => setDeleteModalOpen(true)} className="btn-danger flex items-center gap-2 ml-auto">
                <Trash2 className="w-4 h-4" /> Delete Student
              </button>
            </div>
          </div>

          {/* Enroll in subjects */}
          {student.status === 'active' && (
            <div className="glass-card">
              <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary-400" /> Enrolled Subjects
              </h3>
              <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                {matchingSubjects.map(sub => (
                  <label key={sub._id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 cursor-pointer group">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary-500 rounded"
                      checked={enrolled.includes(sub._id)}
                      onChange={e => setEnrolled(prev => e.target.checked ? [...prev, sub._id] : prev.filter(x => x !== sub._id))}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{sub.name}</p>
                      <p className="text-xs text-slate-500">{sub.code} - {sub.branch || sub.department}</p>
                    </div>
                  </label>
                ))}
                {matchingSubjects.length === 0 && (
                  <p className="text-slate-500 text-sm text-center py-4">No subjects for Semester {student.semester}</p>
                )}
              </div>
              <button onClick={handleEnroll} disabled={saving} className="btn-primary w-full">
                {saving ? 'Saving...' : 'Save Enrollment'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
