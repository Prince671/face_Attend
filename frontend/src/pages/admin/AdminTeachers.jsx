import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { BookOpen, ChevronRight, Eye, FileSpreadsheet, Folder, GraduationCap, GripVertical, Mail, Save, Search, Trash2, Upload, UserPlus, Users, X } from 'lucide-react';
import { adminAPI, subjectAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay, PageSkeleton } from '../../components/LoadingStates';
import { buildAcademicOptions, findAcademicBranch, subjectMatchesAcademicBranch } from '../../utils/academicStructure';
import AppConfirmModal from '../../components/AppConfirmModal';
import BulkProgressOverlay from '../../components/BulkProgressOverlay';
import { handleDeleteScheduled } from '../../utils/deleteUndo';
import { useSmoothBulkProgress } from '../../utils/smoothBulkProgress';

const DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];
const CSE_BRANCHES = ['Computer Science', 'Diploma CS'];
const emptyTeacher = { name: '', email: '', phone: '', departments: '', defaultPassword: 'Teacher@123' };

const isComputerScienceDepartment = (department) => /computer|cse|cs/i.test(String(department || ''));
const getSubjectBranch = (subject) => {
  const explicit = String(subject?.branch || '').trim();
  if (explicit) return explicit;
  if (!isComputerScienceDepartment(subject?.department)) return 'General';
  return 'Unassigned Branch';
};

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

export default function AdminTeachers() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isDepartmentAdmin = user?.role === 'admin' && user?.department && !isSuperAdmin;
  const selectedCourse = isSuperAdmin ? (searchParams.get('course') || '') : '';
  const selectedBranch = searchParams.get('branch') || '';
  const [academicStructures, setAcademicStructures] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [allSubjects, setAllSubjects] = useState([]);
  const academicOptions = buildAcademicOptions(academicStructures, allSubjects);
  const selectedAcademicBranch = isSuperAdmin ? findAcademicBranch(academicOptions, selectedCourse, selectedBranch) : null;
  const selectedDepartment = isDepartmentAdmin ? user.department : (isSuperAdmin ? (selectedAcademicBranch?.department || '') : (searchParams.get('department') || ''));
  const selectedSemester = searchParams.get('semester') || '';
  const [teacherForm, setTeacherForm] = useState(emptyTeacher);
  const [csvFile, setCsvFile] = useState(null);
  const [csvPassword, setCsvPassword] = useState('Teacher@123');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allocationSaving, setAllocationSaving] = useState(false);
  const [selectedMap, setSelectedMap] = useState({});
  const [dirtyTeachers, setDirtyTeachers] = useState({});
  const [activePanel, setActivePanel] = useState('');
  const [showTeacherList, setShowTeacherList] = useState(false);
  const [dragSubjectId, setDragSubjectId] = useState('');
  const [deleteTeacherTarget, setDeleteTeacherTarget] = useState(null);
  const {
    bulkProgress,
    startBulkProgress,
    markBulkUploadProgress,
    markBulkProcessing,
    completeBulkProgress,
    clearBulkProgress
  } = useSmoothBulkProgress();

  const canShowAllocation = selectedDepartment && selectedBranch && selectedSemester;

  const breadcrumbItems = [
    !isDepartmentAdmin && { label: 'Courses', onClick: () => updateQuery(setSearchParams, { course: '', branch: '', semester: '' }) },
    selectedCourse && { label: selectedCourse, onClick: () => updateQuery(setSearchParams, { branch: '', semester: '' }) },
    !isSuperAdmin && selectedDepartment && { label: selectedDepartment, onClick: () => updateQuery(setSearchParams, { branch: '', semester: '' }) },
    selectedBranch && { label: selectedBranch, onClick: () => updateQuery(setSearchParams, { semester: '' }) },
    selectedSemester && { label: `Semester ${selectedSemester}` },
    selectedDepartment && selectedBranch && selectedSemester && { label: 'Subject Allocation' }
  ].filter(Boolean);

  const fetchTeachers = async () => {
    const params = {};
    if (selectedDepartment) params.department = selectedDepartment;
    if (search) params.search = search;
    const res = await adminAPI.getTeachers(params);
    setTeachers(res.data.teachers || []);
  };

  const fetchAllocation = async () => {
    if (!canShowAllocation) {
      setSubjects([]);
      setSelectedMap({});
      return;
    }
    const res = await adminAPI.getTeacherAllocation({ department: selectedDepartment, semester: selectedSemester, branch: selectedBranch });
    const nextSubjects = (res.data.subjects || []).filter(subject => (
      isSuperAdmin && selectedAcademicBranch
        ? subjectMatchesAcademicBranch(subject, selectedAcademicBranch)
        : getSubjectBranch(subject) === selectedBranch
    ));
    setSubjects(nextSubjects);
    setTeachers(res.data.teachers || []);
    const nextMap = {};
    (res.data.teachers || []).forEach(teacher => {
      nextMap[teacher._id] = nextSubjects
        .filter(subject => (subject.assignedTeachers || []).some(item => item._id === teacher._id || item === teacher._id))
        .map(subject => subject._id);
    });
    setSelectedMap(nextMap);
    setDirtyTeachers({});
  };

  const load = async () => {
    setLoading(true);
    try {
      const [, , , structureRes] = await Promise.all([
        fetchTeachers(),
        fetchAllocation(),
        subjectAPI.getAll({ allSemesters: true }).then(res => setAllSubjects(res.data.subjects || [])),
        isSuperAdmin ? adminAPI.getAcademicStructure() : Promise.resolve({ data: { structures: [] } })
      ]);
      setAcademicStructures(structureRes.data.structures || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load teachers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepartment, selectedBranch, selectedSemester, search]);

  useRealtimeRefresh(load, ['teachers', 'subjects', 'academic', 'pending-deletions'], [selectedDepartment, selectedBranch, selectedSemester, search]);

  const visibleDepartments = isDepartmentAdmin ? [user.department] : DEPARTMENTS;
  const filteredTeachers = useMemo(() => teachers.filter(teacher => (
    !selectedDepartment || (teacher.departments || []).includes(selectedDepartment)
  )), [teachers, selectedDepartment]);
  const branchFolders = isSuperAdmin && selectedCourse
    ? (academicOptions.find(item => item.course === selectedCourse)?.branches || [])
      .map(branch => ({ ...branch, semesters: branch.semesters || [] }))
    : (isComputerScienceDepartment(selectedDepartment)
      ? [...CSE_BRANCHES, 'Unassigned Branch']
      : Array.from(new Set(allSubjects.filter(subject => subject.department === selectedDepartment).map(getSubjectBranch)))
    ).filter(Boolean).map(branch => {
      const semesterValues = [...new Set(allSubjects
        .filter(subject => subject.department === selectedDepartment && getSubjectBranch(subject) === branch)
        .map(subject => Number(subject.semester))
        .filter(Boolean)
      )].sort((a, b) => a - b);
      return { name: branch, semesters: semesterValues };
    }).filter(branch => branch.semesters.length > 0);
  const availableSemesters = [...new Set(allSubjects
    .filter(subject => (
      isSuperAdmin && selectedAcademicBranch
        ? subjectMatchesAcademicBranch(subject, selectedAcademicBranch)
        : subject.department === selectedDepartment && (!selectedBranch || getSubjectBranch(subject) === selectedBranch)
    ))
    .map(subject => Number(subject.semester))
    .filter(Boolean)
  )].sort((a, b) => a - b);

  const submitTeacher = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const departments = isDepartmentAdmin ? [user.department] : teacherForm.departments.split(',').map(item => item.trim()).filter(Boolean);
      await adminAPI.createTeacher({ ...teacherForm, departments });
      toast.success('Teacher added');
      setTeacherForm(emptyTeacher);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add teacher');
    } finally {
      setSaving(false);
    }
  };

  const importCsv = async (event) => {
    event.preventDefault();
    if (!csvFile) return toast.error('Choose a CSV file first');
    setSaving(true);
    const controller = new AbortController();
    startBulkProgress({ title: 'Importing Teachers', controller, message: 'Preparing spreadsheet upload...' });
    try {
      const form = new FormData();
      form.append('file', csvFile);
      form.append('defaultPassword', csvPassword);
      const res = await adminAPI.importTeachers(form, {
        signal: controller.signal,
        onUploadProgress: event => {
          markBulkUploadProgress(event);
          if (event.total && event.loaded >= event.total) markBulkProcessing('Upload complete. Creating teacher accounts safely...');
        }
      });
      completeBulkProgress('Teacher import completed.');
      toast.success(`Imported ${res.data.imported} teacher${res.data.imported === 1 ? '' : 's'}`);
      if (res.data.failed) toast(`${res.data.failed} row${res.data.failed === 1 ? '' : 's'} failed`);
      setCsvFile(null);
      await load();
    } catch (err) {
      const timedOut = err.code === 'ECONNABORTED' || /timeout/i.test(String(err.message || ''));
      toast.error(err.code === 'ERR_CANCELED'
        ? 'Teacher import canceled before upload completed'
        : timedOut
          ? 'Teacher import is taking longer than expected. Please refresh the list before retrying.'
          : (err.response?.data?.message || 'Could not import CSV'));
    } finally {
      setSaving(false);
      clearBulkProgress();
    }
  };

  const handleTeacherDelete = async () => {
    if (!deleteTeacherTarget?._id) return;
    setSaving(true);
    try {
      const res = await adminAPI.deleteTeacher(deleteTeacherTarget._id);
      handleDeleteScheduled({ response: res, label: 'Teacher', refresh: load });
      setDeleteTeacherTarget(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete teacher');
    } finally {
      setSaving(false);
    }
  };

  const toggleSubject = (teacherId, subjectId) => {
    setSelectedMap(previous => {
      const selected = new Set(previous[teacherId] || []);
      if (selected.has(subjectId)) selected.delete(subjectId);
      else selected.add(subjectId);
      return { ...previous, [teacherId]: [...selected] };
    });
    setDirtyTeachers(previous => ({ ...previous, [teacherId]: true }));
  };

  const assignSubjectToTeacher = (teacherId, subjectId) => {
    if (!teacherId || !subjectId) return;
    setSelectedMap(previous => {
      const selected = new Set(previous[teacherId] || []);
      selected.add(subjectId);
      return { ...previous, [teacherId]: [...selected] };
    });
    setDirtyTeachers(previous => ({ ...previous, [teacherId]: true }));
  };

  const handleSubjectDrop = (event, teacherId) => {
    event.preventDefault();
    const subjectId = event.dataTransfer.getData('text/plain') || dragSubjectId;
    assignSubjectToTeacher(teacherId, subjectId);
    setDragSubjectId('');
  };

  const saveAllAllocations = async () => {
    if (!canShowAllocation) return toast.error('Select department and semester first');
    const allocations = filteredTeachers.map(teacher => ({
      teacherId: teacher._id,
      subjectIds: selectedMap[teacher._id] || []
    }));
    setAllocationSaving(true);
    try {
      await adminAPI.saveTeacherAllocation({
        allocations,
        department: selectedDepartment,
        branch: selectedBranch,
        semester: selectedSemester
      });
      toast.success('Teacher subject allocation saved');
      setSelectedMap({});
      setDirtyTeachers({});
      setActivePanel('');
      setShowTeacherList(false);
      updateQuery(setSearchParams, {
        course: '',
        department: '',
        branch: '',
        semester: ''
      });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save allocation');
    } finally {
      setAllocationSaving(false);
    }
  };

  const dirtyCount = Object.values(dirtyTeachers).filter(Boolean).length;

  const teacherActionButtons = (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
      {[
        { id: 'add', label: 'Add', full: 'Add Teacher', icon: UserPlus, tone: 'emerald' },
        { id: 'import', label: 'CSV', full: 'Import CSV', icon: FileSpreadsheet, tone: 'sky' },
        { id: 'list', label: 'Teachers', full: 'View Teachers', icon: Eye, tone: 'primary' }
      ].map(action => {
        const Icon = action.icon;
        const active = action.id === 'list' ? showTeacherList : activePanel === action.id;
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => {
              if (action.id === 'list') setShowTeacherList(value => !value);
              else setActivePanel(activePanel === action.id ? '' : action.id);
            }}
            className={`rounded-xl border px-3 py-3 text-left transition-all sm:px-4 ${active ? 'border-primary-400/50 bg-primary-500/15' : 'border-white/10 bg-white/[0.03] hover:border-white/20'}`}
          >
            <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
              action.tone === 'emerald'
                ? 'bg-emerald-500/15 text-emerald-300'
                : action.tone === 'sky'
                  ? 'bg-sky-500/15 text-sky-300'
                  : 'bg-primary-500/15 text-primary-300'
            }`}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="block text-sm font-semibold text-white sm:hidden">{action.label}</span>
            <span className="hidden text-sm font-semibold text-white sm:block">{action.full}</span>
            <span className="mt-0.5 hidden text-xs text-slate-500 sm:block">
              {action.id === 'add' ? 'Single teacher' : action.id === 'import' ? 'Bulk upload' : `${filteredTeachers.length} found`}
            </span>
          </button>
        );
      })}
    </div>
  );

  const teacherForms = (
    <div className="space-y-3">
      {teacherActionButtons}
      {activePanel === 'add' && (
        <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} onSubmit={submitTeacher} className="glass-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center">
                <UserPlus className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Add Teacher</h2>
                <p className="text-xs text-slate-500">Default password is shared with the new teacher</p>
              </div>
            </div>
            <button type="button" onClick={() => setActivePanel('')} className="icon-btn"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="input-field" placeholder="Teacher name" value={teacherForm.name} onChange={event => setTeacherForm({ ...teacherForm, name: event.target.value })} required />
            <input type="email" className="input-field" placeholder="Gmail address" value={teacherForm.email} onChange={event => setTeacherForm({ ...teacherForm, email: event.target.value })} required />
            <input className="input-field" placeholder="Phone optional" value={teacherForm.phone} onChange={event => setTeacherForm({ ...teacherForm, phone: event.target.value })} />
            <input className="input-field" placeholder="Default password" value={teacherForm.defaultPassword} onChange={event => setTeacherForm({ ...teacherForm, defaultPassword: event.target.value })} required />
            {!isDepartmentAdmin && (
              <input className="input-field sm:col-span-2" placeholder="Departments, comma separated" value={teacherForm.departments} onChange={event => setTeacherForm({ ...teacherForm, departments: event.target.value })} required />
            )}
          </div>
          <button disabled={saving} className="btn-primary inline-flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> {saving ? 'Saving...' : 'Add Teacher'}
          </button>
        </motion.form>
      )}
      {activePanel === 'import' && (
        <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} onSubmit={importCsv} className="glass-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center">
                <Upload className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Import CSV</h2>
                <p className="text-xs text-slate-500">Columns: name,email,phone,department</p>
              </div>
            </div>
            <button type="button" onClick={() => setActivePanel('')} className="icon-btn"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="input-field text-xs sm:text-sm" type="file" accept=".csv" onChange={event => setCsvFile(event.target.files?.[0] || null)} />
            <input className="input-field" placeholder="Default password" value={csvPassword} onChange={event => setCsvPassword(event.target.value)} />
          </div>
          <button disabled={saving} className="btn-secondary inline-flex items-center gap-2">
            <Upload className="h-4 w-4" /> {saving ? 'Importing...' : 'Upload Teachers'}
          </button>
        </motion.form>
      )}
    </div>
  );

  const teacherList = showTeacherList && (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-strip sm:grid-cols-2 xl:grid-cols-3">
      {filteredTeachers.map(teacher => (
        <div key={teacher._id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white sm:text-base">{teacher.name}</p>
              <p className="mt-1 truncate text-xs text-primary-300 sm:text-sm">{teacher.email}</p>
            </div>
            <button type="button" onClick={() => setDeleteTeacherTarget(teacher)} className="text-slate-500 transition-colors hover:text-red-300" title="Delete teacher">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(teacher.departments || []).map(department => <span key={department} className="badge-neutral">{department}</span>)}
          </div>
        </div>
      ))}
      {filteredTeachers.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
          No teachers found.
        </div>
      )}
    </motion.div>
  );

  if (loading) return <PageSkeleton variant={canShowAllocation ? 'table' : 'grid'} rows={6} cards={6} />;

  return (
    <div className="space-y-5">
      <AppConfirmModal
        open={Boolean(deleteTeacherTarget)}
        title="Delete Teacher?"
        message={`This will hide ${deleteTeacherTarget?.name || 'this teacher'} now and permanently delete the teacher after 10 minutes unless you undo it from the dashboard tray.`}
        confirmLabel="Schedule Delete"
        loading={saving}
        onCancel={() => setDeleteTeacherTarget(null)}
        onConfirm={handleTeacherDelete}
      />
      <BulkProgressOverlay
        open={Boolean(bulkProgress)}
        title={bulkProgress?.title}
        progress={bulkProgress?.progress}
        message={bulkProgress?.message || (bulkProgress?.phase === 'processing'
          ? 'Processing teacher accounts safely...'
          : `${bulkProgress?.progress || 0}% uploaded`)}
        onCancel={bulkProgress?.controller ? () => bulkProgress.controller.abort() : undefined}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Teachers</h1>
          <p className="text-slate-400 mt-1">Add department teachers and assign semester subjects</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input-field pl-9" placeholder="Search teachers" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
      </div>

      <AdminBreadcrumb items={breadcrumbItems} />

      {!isDepartmentAdmin && isSuperAdmin && !selectedCourse ? (
        <div className="card-strip sm:grid-cols-3 xl:grid-cols-4">
          {academicOptions.map(course => (
            <motion.button key={course.course} whileHover={{ y: -3 }} onClick={() => updateQuery(setSearchParams, { course: course.course, branch: '', semester: '' })} className="glass-card compact-card text-left">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary-500/15 text-primary-300 flex items-center justify-center">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{course.course}</p>
                  <p className="text-xs text-slate-500">{course.branches.length} branch folders</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </div>
            </motion.button>
          ))}
        </div>
      ) : !isDepartmentAdmin && !isSuperAdmin && !selectedDepartment ? (
        <div className="card-strip sm:grid-cols-3 xl:grid-cols-4">
          {visibleDepartments.map(department => (
            <motion.button key={department} whileHover={{ y: -3 }} onClick={() => updateQuery(setSearchParams, { department, semester: '' })} className="glass-card compact-card text-left">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary-500/15 text-primary-300 flex items-center justify-center">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{department}</p>
                  <p className="text-xs text-slate-500">Teacher folder</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </div>
            </motion.button>
          ))}
        </div>
      ) : ((isSuperAdmin && selectedCourse) || selectedDepartment) && !selectedBranch ? (
        <div className="space-y-4">
          {teacherForms}

          <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
            {branchFolders.map(branch => (
              <motion.button key={branch.name} whileHover={{ y: -3 }} onClick={() => updateQuery(setSearchParams, { branch: branch.name, semester: '' })} className="glass-card compact-card text-left">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center">
                    <Folder className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{branch.name}</p>
                    <p className="text-xs text-slate-500">{branch.semesters?.length || 0} semesters</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </div>
              </motion.button>
            ))}
          </div>

          {teacherList}
        </div>
      ) : (
        <>
          {teacherForms}

          <div className="glass-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-white">Subject Allocation</h2>
                <p className="text-sm text-slate-400">
                  {isSuperAdmin ? selectedCourse : selectedDepartment} - {selectedBranch} {selectedSemester ? `- Semester ${selectedSemester}` : ''}
                  {dirtyCount > 0 ? ` - ${dirtyCount} unsaved teacher${dirtyCount === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select className="input-field w-full sm:w-48" value={selectedSemester} onChange={event => updateQuery(setSearchParams, { semester: event.target.value })}>
                  <option value="">Select semester</option>
                  {availableSemesters.map(semester => <option key={semester} value={semester}>Semester {semester}</option>)}
                </select>
                <button
                  type="button"
                  disabled={!selectedSemester || !subjects.length || allocationSaving || dirtyCount === 0}
                  onClick={saveAllAllocations}
                  className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" /> {allocationSaving ? 'Saving...' : 'Save Allocation'}
                </button>
              </div>
            </div>

            <div className="relative mt-4">
              <LoadingOverlay show={allocationSaving} label="Saving allocation..." />
              {!selectedSemester ? (
                <div className="py-12 text-center text-slate-500">
                  <GraduationCap className="mx-auto mb-3 h-10 w-10 opacity-40" />
                  <p>Select a semester to assign subjects.</p>
                </div>
              ) : filteredTeachers.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  <Users className="mx-auto mb-3 h-10 w-10 opacity-40" />
                  <p>No teachers found for this department.</p>
                </div>
              ) : subjects.length === 0 ? (
                <div className="py-12 text-center text-slate-500">
                  <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-40" />
                  <p>No subjects found in this semester.</p>
                </div>
              ) : (
                <div className="card-strip lg:block lg:space-y-3">
                  {filteredTeachers.map(teacher => (
                    <div
                      key={teacher._id}
                      onDragOver={event => event.preventDefault()}
                      onDrop={event => handleSubjectDrop(event, teacher._id)}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary-400/30 sm:p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                        <div className="lg:w-64">
                          <p className="font-semibold text-white">{teacher.name}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Mail className="h-3.5 w-3.5" /> {teacher.email}</p>
                        </div>
                        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {subjects.map(subject => {
                            const checked = (selectedMap[teacher._id] || []).includes(subject._id);
                            return (
                              <label
                                key={subject._id}
                                draggable
                                onDragStart={event => {
                                  setDragSubjectId(subject._id);
                                  event.dataTransfer.setData('text/plain', subject._id);
                                }}
                                className={`flex cursor-grab items-start gap-2 rounded-lg border p-2 text-sm transition-colors active:cursor-grabbing ${checked ? 'border-primary-400/50 bg-primary-500/15 text-white' : 'border-white/10 bg-slate-950/30 text-slate-300 hover:border-white/20'}`}
                              >
                                <GripVertical className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
                                <input type="checkbox" className="mt-1 accent-primary-500" checked={checked} onChange={() => toggleSubject(teacher._id, subject._id)} />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">{subject.name}</span>
                                  <span className="block text-xs text-slate-500">{subject.code}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {teacherList}
        </>
      )}
    </div>
  );
}
