import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Search, Filter, CheckCircle, XCircle, UserX, UserCheck, Trash2, ChevronRight, Users, Folder, GraduationCap, ArrowLeft, Building2, ShieldAlert, ShieldOff, Upload, FileSpreadsheet, X } from 'lucide-react';
import { adminAPI, subjectAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import BulkProgressOverlay from '../../components/BulkProgressOverlay';
import { handleDeleteScheduled } from '../../utils/deleteUndo';
import { sortByStudentIdTail } from '../../utils/studentSort';

const STATUS_COLORS = {
  active: 'badge-success', pending: 'badge-warning',
  inactive: 'badge-danger', restricted: 'badge-danger'
};

const BRANCH_IMPORT_CARDS = [
  {
    key: 'btech-cs',
    title: 'Computer Science',
    course: 'B. Tech',
    branch: 'Computer Science',
    semesters: [4, 5, 6],
    defaultSemester: 6,
    iconClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/20'
  },
  {
    key: 'diploma-cs',
    title: 'Diploma CS',
    course: 'Diploma',
    branch: 'Diploma CS',
    semesters: [5, 6],
    defaultSemester: 6,
    iconClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/20'
  }
];

const getSubjectBranch = (subject) => subject?.branch || 'Computer Science';

const updateQuery = (setSearchParams, updates = {}) => {
  setSearchParams(previous => {
    const params = new URLSearchParams(previous);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    return params;
  });
};

export default function AdminStudents() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();
  const [students, setStudents] = useState([]);
  const [pending, setPending] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState(null);
  const [teacherSubjects, setTeacherSubjects] = useState([]);
  const [subjectSelection, setSubjectSelection] = useState({});
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [defaultPassword, setDefaultPassword] = useState('Student@123');
  const [importCourse, setImportCourse] = useState('B. Tech');
  const [importBranch, setImportBranch] = useState('Computer Science');
  const [importSemester, setImportSemester] = useState('6');
  const [importing, setImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const tab = searchParams.get('tab') || 'pending';
  const selectedCourse = searchParams.get('course') || '';
  const selectedBranch = searchParams.get('branch') || '';
  const selectedDepartment = searchParams.get('department') || '';
  const selectedSemester = searchParams.get('semester') || '';
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState(null);

  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isTeacher = user?.role === 'teacher';
  const isDepartmentAdmin = user?.role === 'admin' && !isSuperAdmin;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (isTeacher) {
        const res = await adminAPI.getTeacherStudents({ search, status: filter === 'all' ? undefined : filter });
        const nextStudents = res.data.students || [];
        setStudents(nextStudents);
        setTeacherSubjects(res.data.subjects || []);
        setPending([]);
        setSubjectSelection(prev => {
          const next = { ...prev };
          nextStudents.forEach(student => {
            if (!next[student._id] && student.teacherSubjects?.[0]?._id) next[student._id] = student.teacherSubjects[0]._id;
          });
          return next;
        });
      } else {
        const [allRes, pendRes, subjectRes] = await Promise.all([
          adminAPI.getAll({
            search,
            status: filter === 'all' ? undefined : filter
          }),
          adminAPI.getPending(),
          subjectAPI.getAll({ allSemesters: true })
        ]);
        setStudents(sortByStudentIdTail(allRes.data.students || []));
        setPending(sortByStudentIdTail(pendRes.data.students || []));
        setSubjects(subjectRes.data.subjects || []);
      }
    } catch { toast.error('Failed to fetch students'); }
    finally { setLoading(false); }
  }, [search, filter, isTeacher]);

  useEffect(() => {
    fetchData();
    window.addEventListener('admin-scope:changed', fetchData);
    return () => window.removeEventListener('admin-scope:changed', fetchData);
  }, [fetchData]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('student_profile_changed', fetchData);
    socket.on('student_profile_update_requested', fetchData);
    socket.on('new_registration', fetchData);
    return () => {
      socket.off('student_profile_changed', fetchData);
      socket.off('student_profile_update_requested', fetchData);
      socket.off('new_registration', fetchData);
    };
  }, [socket, fetchData]);

  useEffect(() => {
    if (!isDepartmentAdmin || !selectedCourse || !selectedBranch || !selectedSemester) return;
    setImportCourse(selectedCourse);
    setImportBranch(selectedBranch);
    setImportSemester(String(selectedSemester));
  }, [isDepartmentAdmin, selectedCourse, selectedBranch, selectedSemester]);

  const handleAction = async (action, id, msg) => {
    setActionLoading(id + action);
    try {
      if (action === 'approve') await adminAPI.approve(id);
      else if (action === 'reject') await adminAPI.reject(id);
      else if (action === 'activate') await adminAPI.activate(id);
      else if (action === 'deactivate') await adminAPI.deactivate(id);
      else if (action === 'delete') {
        const res = await adminAPI.delete(id);
        handleDeleteScheduled({ response: res, label: 'Student', refresh: fetchData });
        setDeleteTarget(null);
        return;
      }
      toast.success(msg);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.message || 'Action failed'); }
    finally { setActionLoading(null); }
  };

  const handleTeacherSubjectRestriction = async (student, mode) => {
    const subjectId = subjectSelection[student._id] || student.teacherSubjects?.[0]?._id;
    if (!subjectId) return toast.error('Select a subject first');
    setActionLoading(student._id + mode + subjectId);
    try {
      if (mode === 'restrict') {
        await adminAPI.restrictStudentForSubject(student._id, subjectId, 'Restricted by teacher for this subject');
        toast.success('Student restricted for selected subject');
      } else {
        await adminAPI.unrestrictStudentForSubject(student._id, subjectId);
        toast.success('Student unrestricted for selected subject');
      }
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStudentImport = async (event) => {
    event.preventDefault();
    if (!importFile) return toast.error('Select CSV or Excel file');
    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('defaultPassword', defaultPassword);
    formData.append('course', importCourse);
    formData.append('department', user?.department || 'Computer Science');
    formData.append('branch', importBranch);
    formData.append('semester', importSemester);
    setImporting(true);
    const controller = new AbortController();
    setBulkProgress({ title: 'Importing Students', progress: 0, controller });
    try {
      const res = await adminAPI.importStudents(formData, {
        signal: controller.signal,
        onUploadProgress: event => {
          if (!event.total) return;
          setBulkProgress(current => current ? { ...current, progress: Math.min(92, Math.round((event.loaded * 92) / event.total)) } : current);
        }
      });
      setBulkProgress(current => current ? { ...current, progress: 100 } : current);
      const summary = res.data.summary || {};
      toast.success(`Imported ${(summary.created || 0) + (summary.updated || 0)} students`);
      if (summary.skipped) {
        const reason = summary.errors?.[0]?.message ? ` First issue: ${summary.errors[0].message}` : '';
        toast.error(`${summary.skipped} of ${summary.processed || 'the'} rows skipped.${reason}`);
      }
      setShowImport(false);
      setImportFile(null);
      fetchData();
    } catch (error) {
      toast.error(error.code === 'ERR_CANCELED' ? 'Student import canceled before upload completed' : (error.response?.data?.message || 'Student import failed'));
    } finally {
      setImporting(false);
      window.setTimeout(() => setBulkProgress(null), 350);
    }
  };

  const openPresetImport = (preset) => {
    setImportCourse(preset.course);
    setImportBranch(preset.branch);
    setImportSemester(String(preset.semester || preset.defaultSemester || 6));
    setShowImport(true);
    updateQuery(setSearchParams, {
      tab: 'all',
      course: preset.course,
      branch: preset.branch,
      semester: preset.semester || preset.defaultSemester || 6
    });
  };

  const handleBulkDelete = async () => {
    if (!bulkDeleteTarget) return;
    setActionLoading(`bulk-delete-${bulkDeleteTarget.key}`);
    try {
      const res = await adminAPI.bulkDeleteStudents({
        course: bulkDeleteTarget.course,
        branch: bulkDeleteTarget.branch,
        semester: bulkDeleteTarget.semester,
        status: 'registered'
      });
      toast.success(res.data.message || 'Students scheduled for deletion');
      setBulkDeleteTarget(null);
      fetchData();
      window.dispatchEvent(new Event('pending-deletions:changed'));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Bulk delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  const renderTeacherSubjectAction = (student, compact = false) => {
    const selectedSubjectId = subjectSelection[student._id] || student.teacherSubjects?.[0]?._id || '';
    const studentSubjects = student.teacherSubjects?.length ? student.teacherSubjects : teacherSubjects;
    const selectedSubject = studentSubjects.find(subject => subject._id === selectedSubjectId);
    const restricted = Boolean(selectedSubject?.restricted);
    return (
      <div className={`teacher-subject-action ${compact ? 'teacher-subject-action-mobile' : ''}`}>
        <select
          className="input-field teacher-subject-select"
          value={selectedSubjectId}
          onChange={e => setSubjectSelection(prev => ({ ...prev, [student._id]: e.target.value }))}
          aria-label={`Select subject for ${student.name}`}
        >
          {studentSubjects.map(subject => (
            <option key={subject._id} value={subject._id}>{subject.code || subject.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => handleTeacherSubjectRestriction(student, restricted ? 'unrestrict' : 'restrict')}
          disabled={!selectedSubjectId || actionLoading === student._id + (restricted ? 'unrestrict' : 'restrict') + selectedSubjectId}
          className={`teacher-subject-button ${restricted ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-red-500/20 text-red-300 hover:bg-red-500/30'}`}
          title={restricted ? 'Unrestrict for selected subject' : 'Restrict for selected subject'}
        >
          {restricted ? <ShieldOff className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          <span>{restricted ? 'Unrestrict' : 'Restrict'}</span>
        </button>
      </div>
    );
  };

  const activeTab = isTeacher ? 'all' : tab;
  const sourceStudents = activeTab === 'pending' ? pending : students.filter(s => s.status !== 'pending');
  const selectedBranchCard = BRANCH_IMPORT_CARDS.find(card => (
    card.course === selectedCourse && card.branch === selectedBranch
  ));
  const needsDepartmentScope = isDepartmentAdmin && !isTeacher && !isSuperAdmin;
  const hasStudentScope = !needsDepartmentScope || Boolean(selectedCourse && selectedBranch && selectedSemester);
  const displayStudents = sortByStudentIdTail(sourceStudents.filter(student => (
    (!selectedCourse || student.course === selectedCourse) &&
    (!selectedBranch || student.branch === selectedBranch) &&
    (!selectedDepartment || student.department === selectedDepartment) &&
    (!selectedSemester || Number(student.semester) === Number(selectedSemester))
  )));
  const branchCards = BRANCH_IMPORT_CARDS.map(card => {
    const branchStudents = sourceStudents.filter(student => (
      student.course === card.course &&
      student.branch === card.branch
    ));
    const branchSubjects = subjects.filter(subject => (
      getSubjectBranch(subject) === card.branch &&
      (!subject.department || subject.department === user?.department || user?.department === 'Administration')
    ));
    const semesters = Array.from(new Set(branchSubjects.map(subject => Number(subject.semester)).filter(Boolean))).sort((a, b) => a - b);
    return {
      ...card,
      semesters,
      total: branchStudents.length,
      subjectCount: branchSubjects.length,
      semesterCount: semesters.length,
      active: branchStudents.filter(student => student.status === 'active').length,
      pending: branchStudents.filter(student => student.status === 'pending').length,
      restricted: branchStudents.filter(student => student.status === 'restricted' || student.isRestricted).length
    };
  });
  const branchSemesterFolders = selectedBranchCard
    ? Array.from(new Set(
      subjects
        .filter(subject => getSubjectBranch(subject) === selectedBranch)
        .map(subject => Number(subject.semester))
        .filter(Boolean)
    )).sort((a, b) => a - b).map(semester => {
      const semesterStudents = sourceStudents.filter(student => (
        student.course === selectedCourse &&
        student.branch === selectedBranch &&
        Number(student.semester) === Number(semester)
      ));
      const semesterSubjects = subjects.filter(subject => (
        getSubjectBranch(subject) === selectedBranch &&
        Number(subject.semester) === Number(semester)
      ));
      return {
        semester,
        total: semesterStudents.length,
        subjects: semesterSubjects.length,
        pending: semesterStudents.filter(student => student.status === 'pending').length,
        active: semesterStudents.filter(student => student.status === 'active').length,
        restricted: semesterStudents.filter(student => student.status === 'restricted' || student.isRestricted).length
      };
    })
    : [];
  const departmentFolders = Array.from(new Set(sourceStudents.map(student => student.department).filter(Boolean))).sort()
    .map(department => {
      const departmentStudents = sourceStudents.filter(student => student.department === department);
      return {
        department,
        total: departmentStudents.length,
        pending: departmentStudents.filter(student => student.status === 'pending').length,
        active: departmentStudents.filter(student => student.status === 'active').length,
        restricted: departmentStudents.filter(student => student.isRestricted || student.status === 'restricted').length
      };
    });
  const semesterFolders = Array.from(new Set(
    sourceStudents
      .filter(student => student.department === selectedDepartment)
      .map(student => Number(student.semester))
      .filter(Boolean)
  )).sort((a, b) => a - b)
    .map(semester => {
      const semesterStudents = sourceStudents.filter(student => student.department === selectedDepartment && Number(student.semester) === semester);
      return {
        semester,
        total: semesterStudents.length,
        pending: semesterStudents.filter(student => student.status === 'pending').length,
        active: semesterStudents.filter(student => student.status === 'active').length,
        restricted: semesterStudents.filter(student => student.isRestricted || student.status === 'restricted').length
      };
    });

  const goBack = () => {
    if (needsDepartmentScope && selectedSemester) {
      updateQuery(setSearchParams, { semester: '' });
      return;
    }
    if (needsDepartmentScope && (selectedCourse || selectedBranch)) {
      updateQuery(setSearchParams, { course: '', branch: '', semester: '' });
      return;
    }
    if (selectedSemester) {
      updateQuery(setSearchParams, { semester: '' });
      return;
    }
    if (selectedDepartment) {
      updateQuery(setSearchParams, { department: '' });
    }
  };
  const breadcrumbItems = isTeacher
    ? [{ label: `Semester ${user?.adminSemesterScope || ''} Students` }]
    : isSuperAdmin
    ? [
      { label: 'Departments', onClick: () => updateQuery(setSearchParams, { department: '', semester: '' }) },
      selectedDepartment && { label: selectedDepartment, onClick: () => updateQuery(setSearchParams, { semester: '' }) },
      selectedSemester && { label: `Semester ${selectedSemester}` },
      selectedSemester && { label: tab === 'pending' ? 'Pending Students' : 'Students' }
    ]
    : [
      { label: tab === 'pending' ? 'Pending Students' : 'Students', onClick: selectedCourse || selectedBranch ? () => updateQuery(setSearchParams, { course: '', branch: '', semester: '' }) : undefined },
      selectedBranch && { label: selectedBranch, onClick: selectedSemester ? () => updateQuery(setSearchParams, { semester: '' }) : undefined },
      selectedSemester && { label: `Semester ${selectedSemester}` }
    ];

  return (
    <div className={`space-y-6 admin-students-page ${isTeacher ? 'teacher-students-page' : ''}`}>
      <AppConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Student?"
        message={`This will hide ${deleteTarget?.name || 'this student'} now. Their profile image, captured attendance images, attendance records, and account will be permanently deleted after 15 minutes unless you undo it from the dashboard tray.`}
        confirmLabel="Schedule Delete"
        loading={Boolean(actionLoading?.endsWith('delete'))}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleAction('delete', deleteTarget._id, 'Student delete scheduled')}
      />
      <AppConfirmModal
        open={Boolean(bulkDeleteTarget)}
        title={`Delete ${bulkDeleteTarget?.title || 'Students'}?`}
        message={`This will schedule deletion for all matching ${bulkDeleteTarget?.title || 'student'} records in Semester ${bulkDeleteTarget?.semester || 6}. You can undo this from the dashboard tray for 15 minutes.`}
        confirmLabel="Schedule Delete All"
        loading={Boolean(actionLoading?.startsWith('bulk-delete'))}
        onCancel={() => setBulkDeleteTarget(null)}
        onConfirm={handleBulkDelete}
      />
      <BulkProgressOverlay
        open={Boolean(bulkProgress)}
        title={bulkProgress?.title}
        progress={bulkProgress?.progress}
        message={bulkProgress?.progress >= 100
          ? 'Upload complete. Saving records safely...'
          : bulkProgress?.progress >= 90
            ? `${bulkProgress?.progress || 0}% uploaded. Processing records safely...`
            : `${bulkProgress?.progress || 0}% uploaded`}
        onCancel={bulkProgress?.controller ? () => bulkProgress.controller.abort() : undefined}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white">Students</h1>
          <p className="text-slate-400 mt-1">{isTeacher ? 'Restrict students only for your assigned subjects' : 'Manage student registrations and accounts'}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {isDepartmentAdmin && (selectedCourse || selectedBranch) && (
            <button type="button" onClick={goBack} className="btn-secondary inline-flex items-center gap-2 justify-center">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          {isSuperAdmin && (selectedDepartment || selectedSemester) && (
            <button type="button" onClick={goBack} className="btn-secondary inline-flex items-center gap-2 justify-center">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
        </div>
      </div>

      <AdminBreadcrumb items={breadcrumbItems} />

      {isTeacher && (
        <div className="teacher-student-overview">
          <div className="teacher-student-overview-tile">
            <span>Total</span>
            <strong>{students.length}</strong>
          </div>
          <div className="teacher-student-overview-tile">
            <span>Active</span>
            <strong>{students.filter(student => student.status === 'active').length}</strong>
          </div>
          <div className="teacher-student-overview-tile">
            <span>Restricted</span>
            <strong>{students.filter(student => student.status === 'restricted' || student.isRestricted).length}</strong>
          </div>
          <div className="teacher-student-overview-tile">
            <span>Subjects</span>
            <strong>{teacherSubjects.length}</strong>
          </div>
        </div>
      )}

      {isDepartmentAdmin && selectedCourse && selectedBranch && selectedSemester && showImport && (
        <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} onSubmit={handleStudentImport} className="glass-card">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/20 text-primary-300">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-white">Bulk Import Students</h2>
              <p className="mt-1 text-sm text-slate-400">CSV/Excel can contain only name, enrollment/studentId, and Gmail. Course, branch, semester, and password can be applied here.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_160px_180px_120px_180px_auto]">
            <input
              type="file"
              accept=".csv,.xlsx"
              className="input-field file:mr-3 file:rounded-lg file:border-0 file:bg-primary-500/20 file:px-3 file:py-1 file:text-primary-200"
              onChange={event => setImportFile(event.target.files?.[0] || null)}
              required
            />
            <select className="input-field" value={importCourse} disabled={Boolean(selectedCourse && selectedBranch && selectedSemester)} onChange={event => {
              const course = event.target.value;
              setImportCourse(course);
              setImportBranch(course === 'Diploma' ? 'Diploma CS' : 'Computer Science');
            }}>
              <option value="B. Tech">B. Tech</option>
              <option value="Diploma">Diploma</option>
            </select>
            <select className="input-field" value={importBranch} disabled={Boolean(selectedCourse && selectedBranch && selectedSemester)} onChange={event => setImportBranch(event.target.value)}>
              <option value="Computer Science">Computer Science</option>
              <option value="Diploma CS">Diploma CS</option>
            </select>
            <select className="input-field" value={importSemester} disabled={Boolean(selectedCourse && selectedBranch && selectedSemester)} onChange={event => setImportSemester(event.target.value)}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(semester => <option key={semester} value={semester}>Sem {semester}</option>)}
            </select>
            <input
              className="input-field"
              value={defaultPassword}
              onChange={event => setDefaultPassword(event.target.value)}
              placeholder="Default password"
              minLength={8}
            />
            <button type="submit" disabled={importing} className="btn-primary justify-center">
              {importing ? 'Importing...' : 'Upload'}
            </button>
          </div>
        </motion.form>
      )}

      {/* Tabs */}
      {!isTeacher && <div className="flex gap-2 border-b border-white/10 overflow-x-auto">
        {[
          { id: 'pending', label: 'Pending Approval', count: pending.length },
          { id: 'all', label: 'All Students' }
        ].map(t => (
          <button key={t.id} onClick={() => updateQuery(setSearchParams, { tab: t.id, department: '', course: '', branch: '', semester: '' })}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? 'border-primary-500 text-primary-400' : 'border-transparent text-slate-400 hover:text-white'}`}>
            {t.label}
            {t.count > 0 && <span className="ml-2 badge-warning">{t.count}</span>}
          </button>
        ))}
      </div>}

      {needsDepartmentScope && selectedCourse && selectedBranch && selectedSemester && (
        <div className="glass-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-primary-300">Selected Student Block</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-white">
              {selectedBranchCard?.title || selectedBranch} - Semester {selectedSemester}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Import and manage only this course, branch, and semester.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowImport(value => !value)}
              className="icon-action h-11 w-11 bg-primary-500/20 text-primary-200 hover:bg-primary-500/30"
              title={showImport ? 'Cancel import' : 'Import students'}
              aria-label={showImport ? 'Cancel import' : 'Import students'}
            >
              {showImport ? <X className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setBulkDeleteTarget({
                key: `${selectedCourse}-${selectedBranch}-${selectedSemester}`,
                title: `${selectedBranchCard?.title || selectedBranch} Semester ${selectedSemester}`,
                course: selectedCourse,
                branch: selectedBranch,
                semester: Number(selectedSemester)
              })}
              disabled={activeTab !== 'all' || displayStudents.length === 0}
              className="icon-action h-11 w-11 bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              title={activeTab === 'all' ? 'Schedule deletion for this selected student block' : 'Switch to All Students to delete registered students'}
              aria-label="Delete all students in this block"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Filters (all tab) */}
      {activeTab === 'all' && hasStudentScope && (
        <div className={isTeacher ? 'teacher-student-filter-rail' : 'flex flex-col sm:flex-row gap-3'}>
          <div className={isTeacher ? 'relative min-w-[18rem] flex-1' : 'relative flex-1 min-w-0'}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className="input-field pl-9" placeholder="Search by name, ID, email..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className={isTeacher ? 'input-field min-w-[12rem]' : 'input-field sm:w-auto'} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>
      )}

      {loading ? (
        <PageSkeleton variant={needsDepartmentScope && !selectedBranch ? 'grid' : 'table'} rows={7} cards={4} />
      ) : needsDepartmentScope && !selectedBranch ? (
        <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
          {branchCards.map(card => (
            <motion.button
              key={card.key}
              onClick={() => updateQuery(setSearchParams, { course: card.course, branch: card.branch, semester: '' })}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -3, scale: 1.01 }}
              whileTap={{ scale: 0.985 }}
              className="folder-choice-card group"
            >
              <div className={`folder-choice-icon ${card.iconClass}`}>
                <Folder className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{card.title}</p>
                <p className="mt-1 text-xs text-slate-400">{card.semesterCount} semesters</p>
                <span className="mt-2 inline-flex rounded-full border border-white/10 bg-white/7 px-2.5 py-0.5 text-[11px] text-slate-300">
                  {card.subjectCount} subjects
                </span>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300" />
            </motion.button>
          ))}
        </div>
      ) : needsDepartmentScope && selectedBranch && !selectedSemester ? (
        <div className="space-y-4">
          <div className="glass-card">
            <p className="text-xs uppercase tracking-wider text-primary-300">Selected Branch</p>
            <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedBranchCard?.title || selectedBranch}</h2>
            <p className="text-slate-400 text-sm mt-1">Choose a semester before importing or viewing students.</p>
          </div>
          {branchSemesterFolders.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No subject semesters found for this branch</p>
            </div>
          ) : (
            <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
              {branchSemesterFolders.map(folder => (
                <motion.button
                  key={folder.semester}
                  onClick={() => updateQuery(setSearchParams, { semester: String(folder.semester) })}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className="folder-choice-card group"
                >
                  <div className="folder-choice-icon bg-primary-500/15 text-primary-300 border-primary-400/20">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">Semester {folder.semester}</p>
                    <p className="mt-1 text-xs text-slate-400">{folder.subjects} subjects</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {folder.pending > 0 && <span className="badge badge-warning">{folder.pending} pending</span>}
                      {folder.active > 0 && <span className="badge badge-success">{folder.active} active</span>}
                      {folder.restricted > 0 && <span className="badge badge-danger">{folder.restricted} restricted</span>}
                      {folder.total === 0 && <span className="badge badge-neutral">no students</span>}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300" />
                </motion.button>
              ))}
            </div>
          )}
        </div>
      ) : !isTeacher && isSuperAdmin && !selectedDepartment ? (
        departmentFolders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">{tab === 'pending' ? 'No pending department folders' : 'No department folders found'}</p>
          </div>
        ) : (
          <div className="card-strip sm:grid-cols-2 xl:grid-cols-3">
            {departmentFolders.map(folder => (
              <motion.button
                key={folder.department}
                onClick={() => updateQuery(setSearchParams, { department: folder.department, semester: '' })}
                whileHover={{ y: -3, scale: 1.01 }}
                whileTap={{ scale: 0.985 }}
                className="glass-card compact-card text-left border border-transparent transition-all hover:border-primary-500/40"
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-primary-500/15 text-primary-300">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{folder.department}</p>
                    <p className="text-slate-400 text-sm">{folder.total} students</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {folder.pending > 0 && <span className="badge badge-warning">{folder.pending} pending</span>}
                      {folder.active > 0 && <span className="badge badge-success">{folder.active} active</span>}
                      {folder.restricted > 0 && <span className="badge badge-danger">{folder.restricted} restricted</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                </div>
              </motion.button>
            ))}
          </div>
        )
      ) : !isTeacher && isSuperAdmin && selectedDepartment && !selectedSemester ? (
        semesterFolders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No semester folders found</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="glass-card">
              <p className="text-xs uppercase tracking-wider text-primary-300">Selected Department</p>
              <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedDepartment}</h2>
              <p className="text-slate-400 text-sm mt-1">Choose a semester to view student records.</p>
            </div>
            <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
              {semesterFolders.map(folder => (
                <motion.button
                  key={folder.semester}
                  onClick={() => updateQuery(setSearchParams, { semester: String(folder.semester) })}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className="glass-card compact-card text-left border border-transparent transition-all hover:border-primary-500/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-emerald-500/15 text-emerald-300">
                      <GraduationCap className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white">Semester {folder.semester}</p>
                      <p className="text-slate-400 text-sm">{folder.total} students</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {folder.pending > 0 && <span className="badge badge-warning">{folder.pending} pending</span>}
                        {folder.active > 0 && <span className="badge badge-success">{folder.active} active</span>}
                        {folder.restricted > 0 && <span className="badge badge-danger">{folder.restricted} restricted</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )
      ) : displayStudents.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">{activeTab === 'pending' ? 'No pending registrations' : 'No students found'}</p>
        </div>
      ) : (
        <div className="glass-card p-0 overflow-hidden student-list-block">
          <div className="table-scroll student-list-scroll">
            <table className={`data-table ${isTeacher ? 'teacher-student-table' : ''}`}>
              <colgroup>
                <col className={isTeacher ? 'w-[30%]' : 'w-[32%]'} />
                <col className={isTeacher ? 'w-[21%]' : 'w-[22%]'} />
                <col className={isTeacher ? 'w-[11%]' : 'w-[14%]'} />
                <col className={isTeacher ? 'w-[13%]' : 'w-[15%]'} />
                <col className={isTeacher ? 'w-[25%]' : 'w-[17%]'} />
              </colgroup>
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">Student</th>
                  <th className="text-left py-4 px-4 text-slate-400 font-medium text-sm">ID / Dept</th>
                  <th className="text-left py-4 px-4 text-slate-400 font-medium text-sm">Status</th>
                  <th className="text-left py-4 px-4 text-slate-400 font-medium text-sm">Registered</th>
                  <th className="text-right py-4 px-6 text-slate-400 font-medium text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayStudents.map((s, i) => (
                  <motion.tr key={s._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                          {s.profileImage
                            ? <img src={s.profileImage} alt={s.name} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-slate-400 font-semibold text-sm">{s.name[0]}</div>}
                        </div>
                        <div className="min-w-0 cell-wrap">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="cell-clip font-medium text-white">{s.name}</p>
                            {s.pendingProfileUpdate?.status === 'pending' && (
                              <span className="badge badge-warning">profile changes</span>
                            )}
                          </div>
                          <p className="cell-clip text-slate-500 text-xs">{s.email}</p>
                          {s.pendingProfileUpdate?.status === 'pending' && (
                            <p className="mt-1 text-xs text-amber-200">
                              Student wants to modify their details. Visible until approved or rejected.
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <p className="cell-clip text-slate-300 text-sm font-mono">{s.studentId}</p>
                      <p className="text-slate-500 text-xs">{s.department} · Sem {s.semester}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`badge ${STATUS_COLORS[s.status] || 'badge-neutral'}`}>
                        {s.isRestricted ? 'Restricted' : s.status}
                      </span>
                      {s.pendingProfileUpdate?.status === 'pending' && s.status !== 'pending' && (
                        <span className="mt-1 inline-flex badge badge-warning">profile update</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-slate-400 text-sm">{new Date(s.createdAt).toLocaleDateString()}</td>
                    <td className="py-4 px-6">
                      <div className="row-actions">
                        {isTeacher ? (
                          renderTeacherSubjectAction(s)
                        ) : s.status === 'pending' && (
                          <>
                            <button onClick={() => handleAction('approve', s._id, 'Student approved!')}
                              disabled={actionLoading === s._id + 'approve'}
                              className="icon-action bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400" title="Approve">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleAction('reject', s._id, 'Student rejected')}
                              disabled={actionLoading === s._id + 'reject'}
                              className="icon-action bg-red-500/20 hover:bg-red-500/30 text-red-400" title="Reject">
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {!isTeacher && s.status === 'active' && (
                          <button onClick={() => handleAction('deactivate', s._id, 'Student deactivated')}
                            className="icon-action bg-amber-500/20 hover:bg-amber-500/30 text-amber-400" title="Deactivate">
                            <UserX className="w-4 h-4" />
                          </button>
                        )}
                        {!isTeacher && s.status === 'inactive' && (
                          <button onClick={() => handleAction('activate', s._id, 'Student activated!')}
                            className="icon-action bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400" title="Activate">
                            <UserCheck className="w-4 h-4" />
                          </button>
                        )}
                        {!isTeacher && <Link to={`/admin/students/${s._id}`}
                          className="icon-action bg-primary-500/20 hover:bg-primary-500/30 text-primary-400" title="View">
                          <ChevronRight className="w-4 h-4" />
                        </Link>}
                        {!isTeacher && <button onClick={() => setDeleteTarget(s)}
                          className="icon-action bg-red-500/20 hover:bg-red-500/30 text-red-400" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
