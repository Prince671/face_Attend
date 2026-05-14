import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Plus, BookOpen, Trash2, X, Folder, GraduationCap, ArrowLeft, Building2, ChevronRight } from 'lucide-react';
import { subjectAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay, PageLoader } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import { handleDeleteScheduled } from '../../utils/deleteUndo';

const DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];

const emptyForm = { name: '', code: '', department: '', semester: '', credits: '3', description: '' };

export default function AdminSubjects() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isDepartmentAdmin = user?.role === 'admin' && user?.department && !isSuperAdmin;
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const fetchSubjects = () => {
    setLoading(true);
    subjectAPI.getAll().then(r => setSubjects(r.data.subjects)).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSubjects();
    window.addEventListener('admin-scope:changed', fetchSubjects);
    return () => window.removeEventListener('admin-scope:changed', fetchSubjects);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await subjectAPI.create(isDepartmentAdmin ? { ...form, department: user.department, semester: user.adminSemesterScope || form.semester } : form);
      toast.success('Subject created!');
      setForm(isDepartmentAdmin ? { ...emptyForm, department: user.department } : emptyForm);
      setShowForm(false);
      fetchSubjects();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget?._id) return;
    try {
      const res = await subjectAPI.delete(deleteTarget._id);
      handleDeleteScheduled({ response: res, label: 'Subject', refresh: fetchSubjects });
      setDeleteTarget(null);
    }
    catch { toast.error('Failed'); }
  };

  const departmentFolders = Array.from(new Set(subjects.map(subject => subject.department).filter(Boolean))).sort()
    .map(department => {
      const departmentSubjects = subjects.filter(subject => subject.department === department);
      const semesters = new Set(departmentSubjects.map(subject => Number(subject.semester)).filter(Boolean));
      return { department, subjects: departmentSubjects.length, semesters: semesters.size };
    });
  const semesterFolders = Array.from(new Set(
    subjects
      .filter(subject => subject.department === selectedDepartment)
      .map(subject => Number(subject.semester))
      .filter(Boolean)
  )).sort((a, b) => a - b)
    .map(semester => ({
      semester,
      subjects: subjects.filter(subject => subject.department === selectedDepartment && Number(subject.semester) === semester).length
    }));
  const visibleSubjects = isSuperAdmin
    ? subjects.filter(subject => (
      (!selectedDepartment || subject.department === selectedDepartment) &&
      (!selectedSemester || Number(subject.semester) === Number(selectedSemester))
    ))
    : subjects;

  const goBack = () => {
    if (selectedSemester) {
      setSelectedSemester('');
      return;
    }
    if (selectedDepartment) {
      setSelectedDepartment('');
    }
  };

  const breadcrumbItems = isSuperAdmin
    ? [
      { label: 'Departments', onClick: () => { setSelectedDepartment(''); setSelectedSemester(''); } },
      selectedDepartment && { label: selectedDepartment, onClick: () => setSelectedSemester('') },
      selectedSemester && { label: `Semester ${selectedSemester}` },
      selectedSemester && { label: 'Subjects' }
    ]
    : [{ label: 'Subjects' }];

  return (
    <div className="space-y-4 sm:space-y-6">
      <AppConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Subject?"
        message={`This will hide ${deleteTarget?.name || 'this subject'} now. Its lectures and attendance records will be permanently deleted after 10 minutes unless you undo it from the dashboard tray.`}
        confirmLabel="Schedule Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white">Subjects</h1>
          <p className="text-slate-400 mt-1">Manage academic subjects</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {isSuperAdmin && (selectedDepartment || selectedSemester) && (
            <button type="button" onClick={goBack} className="btn-secondary inline-flex items-center gap-2 justify-center">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          <button onClick={() => {
            if (!showForm && isDepartmentAdmin) setForm({ ...emptyForm, department: user.department, semester: user.adminSemesterScope || '' });
            if (!showForm && isSuperAdmin && selectedDepartment) setForm({ ...emptyForm, department: selectedDepartment, semester: selectedSemester || '' });
            setShowForm(!showForm);
          }} className="btn-primary flex items-center gap-2 justify-center">
            {showForm ? <><X className="w-4 h-4" /> Cancel</> : <><Plus className="w-4 h-4" /> Add Subject</>}
          </button>
        </div>
      </div>

      <AdminBreadcrumb items={breadcrumbItems} />

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass-card">
          <h2 className="font-semibold text-white mb-4">Create New Subject</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="label">Subject Name *</label>
              <input className="input-field" placeholder="Data Structures" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">Subject Code *</label>
              <input className="input-field" placeholder="CS301" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} required />
            </div>
            <div>
              <label className="label">Department *</label>
              <select className="input-field" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} required disabled={isDepartmentAdmin}>
                <option value="">Select</option>
                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Semester *</label>
              <select className="input-field" value={form.semester} onChange={e => setForm({ ...form, semester: e.target.value })} required>
                <option value="">Select</option>
                {(isDepartmentAdmin && user?.adminSemesterScope ? [user.adminSemesterScope] : [1,2,3,4,5,6,7,8]).map(s => <option key={s} value={s}>Semester {s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Credits</label>
              <input type="number" className="input-field" min={1} max={6} value={form.credits} onChange={e => setForm({ ...form, credits: e.target.value })} />
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input-field" placeholder="Optional" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Creating...' : 'Create Subject'}
              </button>
            </div>
          </form>
        </motion.div>
      )}

      {loading ? (
        <PageLoader label="Loading subjects..." />
      ) : isSuperAdmin && !selectedDepartment ? (
        departmentFolders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No department folders found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
            {departmentFolders.map(folder => (
              <motion.button
                key={folder.department}
                onClick={() => { setSelectedDepartment(folder.department); setSelectedSemester(''); }}
                whileHover={{ y: -3, scale: 1.01 }}
                whileTap={{ scale: 0.985 }}
                className="glass-card text-left border border-transparent transition-all hover:border-primary-500/40"
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-primary-500/15 text-primary-300">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{folder.department}</p>
                    <p className="text-slate-400 text-sm">{folder.semesters} semesters</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="badge badge-neutral">{folder.subjects} subjects</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                </div>
              </motion.button>
            ))}
          </div>
        )
      ) : isSuperAdmin && selectedDepartment && !selectedSemester ? (
        semesterFolders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No semester folders found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="glass-card">
              <p className="text-xs uppercase tracking-wider text-primary-300">Selected Department</p>
              <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedDepartment}</h2>
              <p className="text-slate-400 text-sm mt-1">Choose a semester to view and manage subjects.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
              {semesterFolders.map(folder => (
                <motion.button
                  key={folder.semester}
                  onClick={() => setSelectedSemester(String(folder.semester))}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className="glass-card text-left border border-transparent transition-all hover:border-primary-500/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-emerald-500/15 text-emerald-300">
                      <GraduationCap className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white">Semester {folder.semester}</p>
                      <p className="text-slate-400 text-sm">{folder.subjects} subjects</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="relative">
        <LoadingOverlay show={loading && subjects.length > 0} label="Refreshing subjects..." />
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
          {visibleSubjects.map((sub, i) => (
            <motion.div key={sub._id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="glass-card hover:border-primary-500/20 border border-transparent transition-all">
              <div className="flex items-start justify-between">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-primary-400" />
                </div>
                <button onClick={() => setDeleteTarget(sub)} className="text-slate-600 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <h3 className="line-clamp-2 text-sm font-semibold text-white mt-2 sm:mt-3 sm:text-base">{sub.name}</h3>
              <p className="font-mono text-primary-400 text-xs sm:text-sm">{sub.code}</p>
              <p className="line-clamp-1 text-slate-400 text-xs mt-1 sm:text-sm">{sub.department}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2 sm:gap-2 sm:mt-3">
                <span className="badge-info">Sem {sub.semester}</span>
                <span className="badge-neutral">{sub.credits} Credits</span>
              </div>
            </motion.div>
          ))}
          {visibleSubjects.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3 text-center py-20 text-slate-500">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No subjects yet. Create the first one!</p>
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
}
