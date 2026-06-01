import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Plus, BookOpen, Trash2, X, Folder, GraduationCap, ArrowLeft, Building2, ChevronRight, PauseCircle, PlayCircle, Settings, Upload, FileSpreadsheet, Search, MessageSquare, CheckCircle, XCircle, Calendar, Eye, RefreshCw, Filter, Percent } from 'lucide-react';
import { adminAPI, subjectAPI, attendanceAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh, useSocket } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay, PageSkeleton, SkeletonLine } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import BulkProgressOverlay from '../../components/BulkProgressOverlay';
import { handleDeleteScheduled } from '../../utils/deleteUndo';
import { buildAcademicOptions, findAcademicBranch, subjectMatchesAcademicBranch } from '../../utils/academicStructure';
import { hydrateLmsActivity, lmsActivityBucketForType, lmsActivityEventName, markLmsActivity, readLmsActivity } from '../../utils/lmsActivity';
import { useSmoothBulkProgress } from '../../utils/smoothBulkProgress';

const DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];
const CSE_BRANCHES = ['Computer Science', 'Diploma CS'];

const emptyForm = { name: '', code: '', department: '', branch: '', semester: '', credits: '3', description: '' };
const emptyAcademicForm = { course: '', branchName: '', department: '', subjectBranch: '', semesters: '1,2,3,4,5,6,7,8' };

const isComputerScienceDepartment = (department) => /computer|cse|cs/i.test(String(department || ''));
const getSubjectBranch = (subject) => {
  const explicit = String(subject?.branch || subject?.program || '').trim();
  if (explicit) return explicit;
  if (!isComputerScienceDepartment(subject?.department)) return 'General';
  return 'Computer Science';
};
const branchForApi = (branch) => /^(unassigned branch|general)$/i.test(String(branch || '').trim())
  ? ''
  : String(branch || '').trim();

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

export default function AdminSubjects() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isDepartmentAdmin = user?.role === 'admin' && user?.department && !isSuperAdmin;
  const isTeacher = user?.role === 'teacher';
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState('');
  const selectedCourse = isSuperAdmin ? (searchParams.get('course') || '') : '';
  const selectedBranch = searchParams.get('branch') || '';
  const [academicStructures, setAcademicStructures] = useState([]);
  const [showAcademicForm, setShowAcademicForm] = useState(false);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [academicForm, setAcademicForm] = useState(emptyAcademicForm);
  const [academicDeleteTarget, setAcademicDeleteTarget] = useState(null);
  const [attendanceImportSubject, setAttendanceImportSubject] = useState(null);
  const [attendanceDeleteSubject, setAttendanceDeleteSubject] = useState(null);
  const [attendanceImportFile, setAttendanceImportFile] = useState(null);
  const [attendanceImporting, setAttendanceImporting] = useState(false);
  const [attendanceDeleteRange, setAttendanceDeleteRange] = useState({ startDate: '', endDate: '' });
  const [attendanceDeleting, setAttendanceDeleting] = useState(false);
  const {
    bulkProgress,
    startBulkProgress,
    markBulkUploadProgress,
    markBulkProcessing,
    completeBulkProgress,
    clearBulkProgress
  } = useSmoothBulkProgress();
  const [lmsActivity, setLmsActivity] = useState(() => readLmsActivity(user?._id));
  const academicOptions = buildAcademicOptions(academicStructures, subjects);
  const selectedAcademicBranch = isSuperAdmin ? findAcademicBranch(academicOptions, selectedCourse, selectedBranch) : null;
  const selectedDepartment = isDepartmentAdmin ? user.department : (isSuperAdmin ? (selectedAcademicBranch?.department || '') : (searchParams.get('department') || ''));
  const selectedBranchFilter = isSuperAdmin ? (selectedAcademicBranch?.subjectBranch || '') : selectedBranch;
  const selectedSemester = searchParams.get('semester') || '';
  const selectedSubjectId = searchParams.get('subjectId') || '';
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [historyRange, setHistoryRange] = useState({ startDate: '', endDate: '' });
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState('');
  const [historySortMenuOpen, setHistorySortMenuOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [resolvingDisputeId, setResolvingDisputeId] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [criteriaFormOpen, setCriteriaFormOpen] = useState(false);
  const [criteriaSaving, setCriteriaSaving] = useState(false);
  const [attendanceCriteria, setAttendanceCriteria] = useState(null);
  const [criteriaValue, setCriteriaValue] = useState('75');

  const fetchSubjects = () => {
    setLoading(true);
    Promise.all([
      subjectAPI.getAll({ allSemesters: true }),
      isSuperAdmin ? adminAPI.getAcademicStructure() : Promise.resolve({ data: { structures: [] } })
    ])
      .then(([subjectRes, structureRes]) => {
        setSubjects(subjectRes.data.subjects);
        setAcademicStructures(structureRes.data.structures || []);
      })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSubjects();
    window.addEventListener('admin-scope:changed', fetchSubjects);
    return () => window.removeEventListener('admin-scope:changed', fetchSubjects);
  }, []);

  useRealtimeRefresh(fetchSubjects, ['subjects', 'academic', 'teachers', 'attendance', 'pending-deletions']);

  const criteriaScope = {
    course: selectedCourse || selectedDepartment || '',
    department: selectedDepartment,
    branch: branchForApi(selectedBranchFilter),
    semester: selectedSemester
  };

  const loadAttendanceCriteria = async () => {
    if (!criteriaScope.department || !criteriaScope.semester || isTeacher) return;
    try {
      const res = await adminAPI.getAttendanceCriteria(criteriaScope);
      const nextCriteria = res.data.criteria || null;
      setAttendanceCriteria(nextCriteria);
      setCriteriaValue(String(nextCriteria?.minimumPercentage || 75));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load attendance criteria');
    }
  };

  useEffect(() => {
    setCriteriaFormOpen(false);
    setAttendanceCriteria(null);
    setCriteriaValue('75');
    loadAttendanceCriteria();
  }, [criteriaScope.department, criteriaScope.branch, criteriaScope.semester, isTeacher]);

  useEffect(() => {
    if (!socket) return undefined;
    const handleCriteriaUpdate = (payload = {}) => {
      const criteria = payload.criteria || {};
      if (
        String(criteria.department || '') === String(criteriaScope.department || '') &&
        String(criteria.branch || '') === String(criteriaScope.branch || '') &&
        Number(criteria.semester || 0) === Number(criteriaScope.semester || 0)
      ) {
        setAttendanceCriteria(criteria);
        setCriteriaValue(String(criteria.minimumPercentage || 75));
      }
    };
    socket.on('attendance_criteria_updated', handleCriteriaUpdate);
    return () => socket.off('attendance_criteria_updated', handleCriteriaUpdate);
  }, [socket, criteriaScope.department, criteriaScope.branch, criteriaScope.semester]);

  const saveAttendanceCriteria = async (event) => {
    event.preventDefault();
    if (!criteriaScope.department || !criteriaScope.semester) return toast.error('Open a semester first');
    const minimumPercentage = Number(criteriaValue);
    if (!Number.isFinite(minimumPercentage) || minimumPercentage < 1 || minimumPercentage > 100) {
      return toast.error('Enter a percentage between 1 and 100');
    }
    setCriteriaSaving(true);
    try {
      const res = await adminAPI.updateAttendanceCriteria({ ...criteriaScope, minimumPercentage });
      setAttendanceCriteria(res.data.criteria);
      setCriteriaFormOpen(false);
      toast.success('Minimum attendance criteria updated');
      fetchSubjects();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update criteria');
    } finally {
      setCriteriaSaving(false);
    }
  };

  useEffect(() => {
    setLmsActivity(readLmsActivity(user?._id));
    hydrateLmsActivity(user?._id).then(setLmsActivity);
  }, [user?._id]);

  useEffect(() => {
    const syncActivity = () => setLmsActivity(readLmsActivity(user?._id));
    window.addEventListener(lmsActivityEventName, syncActivity);
    return () => window.removeEventListener(lmsActivityEventName, syncActivity);
  }, [user?._id]);

  useEffect(() => {
    if (!socket) return undefined;
    const handleLmsChange = (payload = {}) => {
      const bucket = lmsActivityBucketForType(payload.type);
      if (!payload.subjectId || !bucket) return;
      markLmsActivity(user?._id, String(payload.subjectId), bucket);
    };
    socket.on('lms_changed', handleLmsChange);
    return () => socket.off('lms_changed', handleLmsChange);
  }, [socket, user?._id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = isSuperAdmin && selectedAcademicBranch ? {
        ...form,
        department: selectedAcademicBranch.department,
        branch: branchForApi(selectedAcademicBranch.subjectBranch),
        semester: selectedSemester
      } : isDepartmentAdmin ? {
        ...form,
        department: user.department,
        branch: branchForApi(form.branch || selectedBranchFilter),
        semester: selectedSemester || form.semester
      } : form;
      await subjectAPI.create(payload);
      toast.success('Subject created!');
      setForm(isSuperAdmin && selectedAcademicBranch
        ? { ...emptyForm, department: selectedAcademicBranch.department, branch: branchForApi(selectedAcademicBranch.subjectBranch), semester: selectedSemester }
        : isDepartmentAdmin
          ? { ...emptyForm, department: user.department }
          : emptyForm);
      setShowForm(false);
      fetchSubjects();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const closeAttendanceImport = () => {
    setAttendanceImportSubject(null);
    setAttendanceImportFile(null);
  };

  const closeAttendanceDelete = () => {
    setAttendanceDeleteSubject(null);
    setAttendanceDeleteRange({ startDate: '', endDate: '' });
  };

  const handleAttendanceImport = async (event) => {
    event.preventDefault();
    if (!attendanceImportSubject || !attendanceImportFile) {
      return toast.error('Select a spreadsheet file');
    }
    const formData = new FormData();
    formData.append('file', attendanceImportFile);
    setAttendanceImporting(true);
    const controller = new AbortController();
    startBulkProgress({ title: 'Importing Attendance', controller, message: 'Preparing attendance spreadsheet...' });
    try {
      const res = await attendanceAPI.importSubjectAttendance(attendanceImportSubject._id, formData, {
        signal: controller.signal,
        onUploadProgress: event => {
          markBulkUploadProgress(event);
          if (event.total && event.loaded >= event.total) markBulkProcessing('Upload complete. Processing attendance records...');
        }
      });
      completeBulkProgress('Attendance import completed.');
      const summary = res.data.importSummary;
      toast.success(`Imported ${summary?.imported || 0} records across ${summary?.lectures || 0} date${summary?.lectures === 1 ? '' : 's'}`);
      if (summary?.skipped) {
        const issue = summary.warnings?.[0]?.message || summary.errors?.[0]?.message || '';
        const reason = issue ? ` First warning: ${issue}` : '';
        toast(`${summary.skipped} rows skipped.${reason}`);
      }
      if (summary?.warnings?.length) {
        toast(`${summary.warnings.length} import warning${summary.warnings.length === 1 ? '' : 's'} recorded. Attendance was still imported where possible.`);
      }
      closeAttendanceImport();
      fetchSubjects();
    } catch (error) {
      const timedOut = error.code === 'ECONNABORTED' || /timeout/i.test(String(error.message || ''));
      toast.error(error.code === 'ERR_CANCELED'
        ? 'Attendance import canceled before upload completed'
        : timedOut
          ? 'Attendance import is taking longer than expected. Please refresh attendance before retrying.'
          : (error.response?.data?.message || 'Attendance import failed'));
    } finally {
      setAttendanceImporting(false);
      clearBulkProgress();
    }
  };

  const handleImportedAttendanceDelete = async () => {
    if (!attendanceDeleteSubject) return;
    if (!attendanceDeleteRange.startDate) {
      return toast.error('Select a start date for delete.');
    }
    setAttendanceDeleting(true);
    try {
      const res = await attendanceAPI.deleteImportedSubjectAttendance(attendanceDeleteSubject._id, attendanceDeleteRange);
      toast.success(res.data.message || 'Imported attendance delete scheduled');
      window.dispatchEvent(new Event('pending-deletions:changed'));
      closeAttendanceDelete();
      fetchSubjects();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not schedule imported attendance deletion');
    } finally {
      setAttendanceDeleting(false);
    }
  };

  const saveAcademicSetup = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await adminAPI.addAcademicCourse({ course: academicForm.course });
      toast.success('Course added');
      setAcademicForm(emptyAcademicForm);
      setShowAcademicForm(false);
      fetchSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save academic setup');
    } finally {
      setSaving(false);
    }
  };

  const saveBranchSetup = async (event) => {
    event.preventDefault();
    if (!selectedCourse) return toast.error('Select a course first');
    setSaving(true);
    try {
      await adminAPI.addAcademicBranch({
        course: selectedCourse,
        name: academicForm.branchName,
        department: academicForm.department,
        subjectBranch: academicForm.subjectBranch,
        semesters: academicForm.semesters
      });
      toast.success('Branch added');
      setAcademicForm(emptyAcademicForm);
      setShowBranchForm(false);
      fetchSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add branch');
    } finally {
      setSaving(false);
    }
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

  const handleAcademicDelete = async () => {
    if (!academicDeleteTarget) return;
    setSaving(true);
    try {
      if (academicDeleteTarget.type === 'course') {
        await adminAPI.deleteAcademicCourse(academicDeleteTarget.course);
        if (selectedCourse === academicDeleteTarget.course) updateQuery(setSearchParams, { course: '', branch: '', semester: '' });
      } else {
        await adminAPI.deleteAcademicBranch(academicDeleteTarget.course, academicDeleteTarget.branch);
        if (selectedCourse === academicDeleteTarget.course && selectedBranch === academicDeleteTarget.branch) {
          updateQuery(setSearchParams, { branch: '', semester: '' });
        }
      }
      toast.success(`${academicDeleteTarget.type === 'course' ? 'Course' : 'Branch'} deleted`);
      setAcademicDeleteTarget(null);
      fetchSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete');
    } finally {
      setSaving(false);
    }
  };

  const toggleSubjectClasses = async (subject) => {
    setStatusSavingId(subject._id);
    try {
      const nextStopped = !subject.classesStopped;
      await subjectAPI.update(subject._id, {
        classesStopped: nextStopped,
        classesStoppedReason: nextStopped ? 'Syllabus completed' : ''
      });
      toast.success(nextStopped ? 'Subject classes stopped' : 'Subject classes resumed');
      fetchSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update subject status');
    } finally {
      setStatusSavingId('');
    }
  };

  const departmentFolders = Array.from(new Set(subjects.map(subject => subject.department).filter(Boolean))).sort()
    .map(department => {
      const departmentSubjects = subjects.filter(subject => subject.department === department);
      const semesters = new Set(departmentSubjects.map(subject => Number(subject.semester)).filter(Boolean));
      return { department, subjects: departmentSubjects.length, semesters: semesters.size };
    });
  const semesterFolders = Array.from(new Set([
    ...((isSuperAdmin && selectedAcademicBranch?.semesters) ? selectedAcademicBranch.semesters : []),
    ...subjects
      .filter(subject => subject.department === selectedDepartment)
      .filter(subject => !selectedBranchFilter || getSubjectBranch(subject) === selectedBranchFilter)
      .map(subject => Number(subject.semester))
      .filter(Boolean)
  ])).sort((a, b) => a - b)
    .map(semester => ({
      semester,
      subjects: subjects.filter(subject => (
        subject.department === selectedDepartment &&
        (!selectedBranchFilter || getSubjectBranch(subject) === selectedBranchFilter) &&
        Number(subject.semester) === semester
      )).length
    }));
  const branchFolders = (isComputerScienceDepartment(selectedDepartment)
    ? CSE_BRANCHES
    : (Array.from(new Set(subjects.filter(subject => subject.department === selectedDepartment).map(getSubjectBranch))).length
      ? Array.from(new Set(subjects.filter(subject => subject.department === selectedDepartment).map(getSubjectBranch)))
      : ['General'])
  ).map(branch => {
    const branchSubjects = subjects.filter(subject => subject.department === selectedDepartment && getSubjectBranch(subject) === branch);
    const semesters = new Set(branchSubjects.map(subject => Number(subject.semester)).filter(Boolean));
    return { branch, subjects: branchSubjects.length, semesters: semesters.size };
  });
  const visibleSubjects = isTeacher
    ? subjects
    : isSuperAdmin
    ? subjects.filter(subject => (
      (!selectedAcademicBranch || subjectMatchesAcademicBranch(subject, selectedAcademicBranch)) &&
      (!selectedSemester || Number(subject.semester) === Number(selectedSemester))
    ))
    : subjects.filter(subject => (
      subject.department === selectedDepartment &&
      (!selectedBranchFilter || getSubjectBranch(subject) === selectedBranchFilter) &&
      (!selectedSemester || Number(subject.semester) === Number(selectedSemester))
    ));
  const selectedTeacherSubject = isTeacher && selectedSubjectId
    ? subjects.find(subject => String(subject._id) === String(selectedSubjectId))
    : null;
  const historyStudents = historyData?.students || [];
  const sortedHistoryStudents = historySort
    ? [...historyStudents].sort((a, b) => {
      const first = Number(a.percentage || 0);
      const second = Number(b.percentage || 0);
      return historySort === 'desc' ? second - first : first - second;
    })
    : historyStudents;
  const applyHistorySort = (sort) => {
    setHistorySort(sort);
    setHistorySortMenuOpen(false);
  };

  const fetchTeacherSubjectHistory = async (subject = selectedTeacherSubject) => {
    if (!subject?._id) return;
    if (!historyRange.startDate || !historyRange.endDate) {
      toast.error('Select a start and end date first');
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await attendanceAPI.getSubjectHistory(subject._id, {
        startDate: historyRange.startDate,
        endDate: historyRange.endDate,
        search: historySearch || undefined
      });
      setHistoryData(res.data);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load attendance history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchTeacherSubjectDisputes = async (subject = selectedTeacherSubject) => {
    if (!subject?._id) return;
    setDisputeLoading(true);
    try {
      const res = await attendanceAPI.getDisputes({
        subjectId: subject._id
      });
      setDisputes(res.data.disputes || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load disputes');
    } finally {
      setDisputeLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedTeacherSubject) {
      setHistoryData(null);
      setDisputes([]);
      return;
    }
    setHistoryRange({ startDate: '', endDate: '' });
    setHistorySearch('');
    setHistorySort('');
    setHistorySortMenuOpen(false);
    setHistoryData(null);
    fetchTeacherSubjectDisputes(selectedTeacherSubject);
  }, [selectedTeacherSubject?._id]);

  const resolveSubjectDispute = async (dispute, status, attendanceStatus) => {
    setResolvingDisputeId(dispute._id);
    try {
      await attendanceAPI.resolveDispute(dispute._id, {
        status,
        attendanceStatus,
        note: resolutionNotes[dispute._id] || ''
      });
      toast.success(status === 'approved' ? 'Dispute resolved and attendance updated' : 'Dispute rejected');
      setResolutionNotes(current => ({ ...current, [dispute._id]: '' }));
      fetchTeacherSubjectDisputes();
      if (historyData) fetchTeacherSubjectHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not resolve dispute');
    } finally {
      setResolvingDisputeId('');
    }
  };

  const goBack = () => {
    if (selectedSemester) {
      updateQuery(setSearchParams, { semester: '', subjectId: '' });
      return;
    }
    if (selectedBranch) {
      updateQuery(setSearchParams, { branch: '' });
      return;
    }
    if (selectedCourse) {
      updateQuery(setSearchParams, { course: '' });
      return;
    }
    if (selectedDepartment) {
      updateQuery(setSearchParams, { department: '' });
    }
  };

  const openSubjectForm = () => {
    if (showForm) {
      setShowForm(false);
      return;
    }
    if (isSuperAdmin && selectedAcademicBranch) {
      setForm({
        ...emptyForm,
        department: selectedAcademicBranch.department,
        branch: branchForApi(selectedAcademicBranch.subjectBranch),
        semester: selectedSemester || ''
      });
    } else if (isDepartmentAdmin) {
      setForm({
        ...emptyForm,
        department: user.department,
        branch: branchForApi(selectedBranchFilter),
        semester: selectedSemester || ''
      });
    }
    setShowForm(true);
  };

  const openCourseSetup = () => {
    setShowBranchForm(false);
    setAcademicForm(emptyAcademicForm);
    setShowAcademicForm(value => !value);
  };

  const openBranchSetup = () => {
    setShowAcademicForm(false);
    setAcademicForm({ ...emptyAcademicForm, course: selectedCourse });
    setShowBranchForm(value => !value);
  };

  const breadcrumbItems = isSuperAdmin
    ? [
      { label: 'Courses', onClick: () => updateQuery(setSearchParams, { course: '', branch: '', semester: '' }) },
      selectedCourse && { label: selectedCourse, onClick: () => updateQuery(setSearchParams, { branch: '', semester: '' }) },
      selectedBranch && { label: selectedBranch, onClick: () => updateQuery(setSearchParams, { semester: '' }) },
      selectedSemester && { label: `Semester ${selectedSemester}` },
      selectedSemester && { label: 'Subjects' }
    ]
    : [
      { label: selectedDepartment || 'Department' },
      selectedBranch && { label: selectedBranch, onClick: selectedSemester ? () => updateQuery(setSearchParams, { semester: '' }) : undefined },
      selectedSemester && { label: `Semester ${selectedSemester}` },
      selectedTeacherSubject && { label: 'Subjects', onClick: () => updateQuery(setSearchParams, { subjectId: '' }) },
      selectedTeacherSubject && { label: selectedTeacherSubject.name },
      selectedSemester && !selectedTeacherSubject && { label: 'Subjects' }
    ];

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
      <AppConfirmModal
        open={Boolean(academicDeleteTarget)}
        title={`Delete ${academicDeleteTarget?.type === 'course' ? 'Course' : 'Branch'}?`}
        message={academicDeleteTarget?.type === 'course'
          ? `Delete course "${academicDeleteTarget?.course}"? This is allowed only when no students or subjects are linked to it.`
          : `Delete branch "${academicDeleteTarget?.branch}" from ${academicDeleteTarget?.course}? This is allowed only when no students or subjects are linked to it.`}
        confirmLabel="Delete"
        loading={saving}
        onCancel={() => setAcademicDeleteTarget(null)}
        onConfirm={handleAcademicDelete}
      />
      <BulkProgressOverlay
        open={Boolean(bulkProgress)}
        title={bulkProgress?.title}
        progress={bulkProgress?.progress}
        message={bulkProgress?.message || (bulkProgress?.phase === 'processing'
          ? 'Processing attendance safely...'
          : `${bulkProgress?.progress || 0}% uploaded`)}
        onCancel={bulkProgress?.controller ? () => bulkProgress.controller.abort() : undefined}
      />
      {attendanceImportSubject && typeof document !== 'undefined' && createPortal(
        <div className="app-modal-backdrop">
          <motion.form
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            onSubmit={handleAttendanceImport}
            className="glass-card w-full max-w-lg border border-primary-500/25"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/20 text-primary-300">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h2 className="truncate text-lg font-semibold text-white">Import Attendance</h2>
                <p className="mt-1 text-sm text-slate-400">{attendanceImportSubject.code} - {attendanceImportSubject.name}</p>
              </div>
              <button type="button" onClick={closeAttendanceImport} className="icon-action bg-white/5 text-slate-300 hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4">
              <div>
                <label className="label flex items-center gap-2"><Upload className="h-4 w-4" /> CSV / Excel File *</label>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  className="input-field file:mr-3 file:rounded-lg file:border-0 file:bg-primary-500/20 file:px-3 file:py-1 file:text-primary-200"
                  onChange={event => setAttendanceImportFile(event.target.files?.[0] || null)}
                  required
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Supports normal sheets with date, studentId/email, status columns and attendance-register sheets with dates across columns.
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  TRUE/P/Present means present. FALSE/A/Absent means absent. The system creates or updates each date automatically.
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-200">
                  Missing enrollment, restricted profiles, different semesters, or new student IDs are handled as warnings. Valid attendance rows are still saved.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeAttendanceImport} className="btn-secondary justify-center">Cancel</button>
              <button type="submit" disabled={attendanceImporting} className="btn-primary justify-center">
                {attendanceImporting ? 'Importing...' : 'Import Attendance'}
              </button>
            </div>
          </motion.form>
        </div>
      , document.body)}
      {attendanceDeleteSubject && typeof document !== 'undefined' && createPortal(
        <div className="app-modal-backdrop">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="glass-card w-full max-w-md border border-red-400/25"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15 text-red-300">
                  <Trash2 className="h-5 w-5" />
                </div>
                <h2 className="truncate text-lg font-semibold text-white">Delete Attendance</h2>
                <p className="mt-1 text-sm text-slate-400">{attendanceDeleteSubject.code} - {attendanceDeleteSubject.name}</p>
              </div>
              <button type="button" onClick={closeAttendanceDelete} className="icon-action bg-white/5 text-slate-300 hover:bg-white/10" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3">
              <p className="text-sm leading-6 text-slate-400">
                Select the date range to schedule deletion for imported previous attendance. One grouped Undo All request will recover the full delete process.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="date"
                  className="input-field"
                  value={attendanceDeleteRange.startDate}
                  onChange={event => setAttendanceDeleteRange(current => ({ ...current, startDate: event.target.value }))}
                  aria-label="Delete start date"
                />
                <input
                  type="date"
                  className="input-field"
                  value={attendanceDeleteRange.endDate}
                  onChange={event => setAttendanceDeleteRange(current => ({ ...current, endDate: event.target.value }))}
                  aria-label="Delete end date"
                />
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeAttendanceDelete} className="btn-secondary justify-center">Cancel</button>
              <button type="button" onClick={handleImportedAttendanceDelete} disabled={attendanceDeleting} className="btn-danger justify-center">
                {attendanceDeleting ? 'Scheduling...' : 'Delete Attendance'}
              </button>
            </div>
          </motion.div>
        </div>
      , document.body)}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white">Subjects</h1>
          <p className="text-slate-400 mt-1">{isTeacher ? 'Your assigned semester subjects' : 'Manage academic subjects'}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {((isSuperAdmin && (selectedCourse || selectedBranch || selectedSemester)) || (!isSuperAdmin && (selectedBranch || selectedSemester))) && (
            <button type="button" onClick={goBack} className="btn-secondary inline-flex items-center gap-2 justify-center">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          {!isTeacher && selectedSemester && <button onClick={openSubjectForm} className="btn-primary flex items-center gap-2 justify-center">
            {showForm ? <><X className="w-4 h-4" /> Cancel</> : <><Plus className="w-4 h-4" /> Add Subject</>}
          </button>}
          {isSuperAdmin && selectedCourse && !selectedBranch && (
            <button type="button" onClick={openBranchSetup} className="btn-primary flex items-center gap-2 justify-center">
              {showBranchForm ? <><X className="w-4 h-4" /> Cancel</> : <><Plus className="w-4 h-4" /> Add Branch</>}
            </button>
          )}
          {isSuperAdmin && (
            <button type="button" onClick={openCourseSetup} className="btn-secondary flex items-center gap-2 justify-center">
              <Settings className="w-4 h-4" /> {showAcademicForm ? 'Close Setup' : 'Academic Setup'}
            </button>
          )}
        </div>
      </div>

      <AdminBreadcrumb items={breadcrumbItems} />

      {showAcademicForm && (
        <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} onSubmit={saveAcademicSetup} className="glass-card">
          <div className="flex flex-col gap-1 mb-4">
            <h2 className="font-semibold text-white">Add Course</h2>
            <p className="text-sm text-slate-400">Create the course first. After selecting it, you can add branches and semesters inside that course.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <input className="input-field" placeholder="Course name" value={academicForm.course} onChange={e => setAcademicForm({ ...academicForm, course: e.target.value })} required />
            <button disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Create Course'}</button>
          </div>
        </motion.form>
      )}

      {showBranchForm && selectedCourse && (
        <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} onSubmit={saveBranchSetup} className="glass-card">
          <div className="flex flex-col gap-1 mb-4">
            <h2 className="font-semibold text-white">Add Branch in {selectedCourse}</h2>
            <p className="text-sm text-slate-400">Map the branch to a department and define the semester folders available in it.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <input className="input-field" placeholder="Branch name" value={academicForm.branchName} onChange={e => setAcademicForm({ ...academicForm, branchName: e.target.value })} required />
            <input className="input-field" placeholder="Mapped department" value={academicForm.department} onChange={e => setAcademicForm({ ...academicForm, department: e.target.value })} required />
            <input className="input-field" placeholder="Subject branch value" value={academicForm.subjectBranch} onChange={e => setAcademicForm({ ...academicForm, subjectBranch: e.target.value })} />
            <input className="input-field" placeholder="Semesters e.g. 1,2,3,4" value={academicForm.semesters} onChange={e => setAcademicForm({ ...academicForm, semesters: e.target.value })} required />
          </div>
          <button disabled={saving} className="btn-primary mt-3">{saving ? 'Saving...' : 'Create Branch'}</button>
        </motion.form>
      )}

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
              {isSuperAdmin && selectedAcademicBranch ? (
                <input className="input-field" value={form.department} disabled readOnly />
              ) : (
                <select className="input-field" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} required disabled={isDepartmentAdmin}>
                  <option value="">Select</option>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label">Branch</label>
              {isSuperAdmin && selectedAcademicBranch ? (
                <input className="input-field" value={selectedAcademicBranch.name} disabled readOnly />
              ) : (
                <select className="input-field" value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })}>
                  <option value="">General</option>
                  {isComputerScienceDepartment(form.department || selectedDepartment) && CSE_BRANCHES.map(branch => <option key={branch}>{branch}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label">Semester *</label>
              {selectedSemester ? (
                <input className="input-field" value={`Semester ${selectedSemester}`} disabled readOnly />
              ) : (
                <select className="input-field" value={form.semester} onChange={e => setForm({ ...form, semester: e.target.value })} required>
                  <option value="">Select</option>
                  {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Semester {s}</option>)}
                </select>
              )}
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

      {selectedTeacherSubject ? (
        <div className="space-y-4">
          <div className="glass-card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <button type="button" onClick={() => updateQuery(setSearchParams, { subjectId: '' })} className="mb-3 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
                  <ArrowLeft className="h-4 w-4" /> Back to subjects
                </button>
                <h2 className="font-display text-2xl font-bold text-white">{selectedTeacherSubject.name}</h2>
                <p className="mt-1 font-mono text-sm text-primary-300">{selectedTeacherSubject.code} - Semester {selectedTeacherSubject.semester}</p>
                <p className="mt-1 text-sm text-slate-400">{selectedTeacherSubject.department}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setAttendanceImportSubject(selectedTeacherSubject)} className="icon-action bg-primary-500 text-white hover:bg-primary-600" title="Import attendance" aria-label="Import attendance">
                  <Upload className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setAttendanceDeleteSubject(selectedTeacherSubject)} className="icon-action bg-white/10 text-red-200 hover:bg-red-500/20" title="Delete attendance" aria-label="Delete attendance">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => fetchTeacherSubjectDisputes()} className="icon-action bg-white/10 text-amber-200 hover:bg-white/15" title="Refresh disputes" aria-label="Refresh disputes">
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="glass-card">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  <Calendar className="h-5 w-5 text-primary-300" /> Attendance History
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {historySort
                    ? `Students are sorted by attendance percentage ${historySort === 'desc' ? 'high to low' : 'low to high'}.`
                    : 'Students are sorted by the numeric series in their student ID.'}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_auto_minmax(220px,1fr)_auto]">
                <input className="input-field" type="date" value={historyRange.startDate} onChange={e => setHistoryRange({ ...historyRange, startDate: e.target.value })} />
                <input className="input-field" type="date" value={historyRange.endDate} onChange={e => setHistoryRange({ ...historyRange, endDate: e.target.value })} />
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input className="input-field pl-9" placeholder="Search name, ID, or email" value={historySearch} onChange={e => setHistorySearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchTeacherSubjectHistory(); }} />
                </div>
                <button type="button" onClick={() => fetchTeacherSubjectHistory()} disabled={historyLoading} className="icon-action bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60" title="View history" aria-label="View history">
                  {historyLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {historyLoading ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => <SkeletonLine key={index} className="h-16 rounded-xl" />)}
                </div>
                <div className="mt-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, index) => <SkeletonLine key={index} className="h-10 rounded-lg" />)}
                </div>
              </div>
            ) : historyData ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Lectures</p><p className="text-xl font-bold text-white">{historyData.summary.totalLectures}</p></div>
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Students</p><p className="text-xl font-bold text-white">{historyData.summary.totalStudents}</p></div>
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Present Marks</p><p className="text-xl font-bold text-emerald-300">{historyData.summary.totalPresent}</p></div>
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Average</p><p className="text-xl font-bold text-primary-300">{historyData.summary.percentage}%</p></div>
                </div>
                <div className="table-scroll max-h-[24rem] overflow-y-auto rounded-xl border border-white/10">
                  <table className="data-table text-sm">
                    <thead className="bg-white/5 text-left text-xs uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-3">Student</th>
                        <th className="px-3 py-3">ID</th>
                        <th className="px-3 py-3">Present</th>
                        <th className="px-3 py-3">Absent</th>
                        <th className="px-3 py-3">
                          <div className="relative flex w-full min-w-[88px] items-center justify-between gap-2">
                            <span>%</span>
                            <button
                              type="button"
                              onClick={() => setHistorySortMenuOpen(open => !open)}
                              className={`grid h-7 w-7 place-items-center rounded-lg border transition-colors ${historySort ? 'border-primary-400/40 bg-primary-500/20 text-primary-100' : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:bg-white/10 hover:text-white'}`}
                              title="Sort attendance percentage"
                              aria-label="Sort attendance percentage"
                            >
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                            {historySortMenuOpen && (
                              <div className="absolute right-0 top-9 z-20 flex w-48 flex-col gap-1 rounded-xl border border-white/10 bg-slate-950/95 p-2 text-xs normal-case shadow-2xl shadow-black/30 backdrop-blur">
                                <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Sort by %</p>
                                <button type="button" onClick={() => applyHistorySort('desc')} className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${historySort === 'desc' ? 'bg-primary-500/20 text-primary-100' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
                                  High to low
                                </button>
                                <button type="button" onClick={() => applyHistorySort('asc')} className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${historySort === 'asc' ? 'bg-primary-500/20 text-primary-100' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
                                  Low to high
                                </button>
                                <button type="button" onClick={() => applyHistorySort('')} className={`mt-1 w-full rounded-lg px-3 py-2 text-left transition-colors ${!historySort ? 'bg-primary-500/20 text-primary-100' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
                                  Default ID order
                                </button>
                              </div>
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {sortedHistoryStudents.map(row => (
                        <tr key={row.student._id} className="hover:bg-white/5">
                          <td className="px-3 py-3 text-white"><span className="cell-clip">{row.student.name}</span></td>
                          <td className="px-3 py-3 text-slate-400"><span className="cell-clip">{row.student.studentId}</span></td>
                          <td className="px-3 py-3 text-emerald-300">{row.present}/{row.total}</td>
                          <td className="px-3 py-3 text-red-300">{row.absent}</td>
                          <td className="px-3 py-3 text-primary-300">{row.percentage}%</td>
                        </tr>
                      ))}
                      {historyData.students.length === 0 && (
                        <tr><td colSpan="5" className="px-3 py-8 text-center text-slate-500">No matching students found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-500">Select a date range and press View.</div>
            )}
          </div>

          <div className="glass-card">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  <MessageSquare className="h-5 w-5 text-amber-300" /> Disputes
                </h3>
                <p className="mt-1 text-sm text-slate-400">Student complaints appear here directly with their date and issue.</p>
              </div>
              <button type="button" onClick={fetchTeacherSubjectDisputes} disabled={disputeLoading} className="icon-action bg-white/10 text-slate-200 hover:bg-white/15 disabled:opacity-60" title="Refresh disputes" aria-label="Refresh disputes">
                <RefreshCw className={`h-4 w-4 ${disputeLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="space-y-3">
              {disputes.map(dispute => (
                <div key={dispute._id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-white">{dispute.student?.name} <span className="font-mono text-xs text-slate-500">{dispute.student?.studentId}</span></p>
                      <p className="mt-1 text-xs text-slate-500">{new Date(dispute.lecture?.date).toLocaleDateString()} - {dispute.lecture?.title}</p>
                      <p className="mt-2 text-sm text-slate-300">{dispute.reason}</p>
                      <span className={`mt-2 inline-flex ${dispute.status === 'approved' ? 'badge-success' : dispute.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>{dispute.status}</span>
                    </div>
                    {dispute.status === 'pending' ? (
                      <div className="w-full space-y-2 lg:max-w-sm">
                        <textarea
                          className="input-field min-h-20"
                          placeholder="Resolution note to student"
                          value={resolutionNotes[dispute._id] || ''}
                          onChange={event => setResolutionNotes(current => ({ ...current, [dispute._id]: event.target.value }))}
                        />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <button type="button" className="icon-action bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60" title="Mark present" aria-label="Mark present" disabled={resolvingDisputeId === dispute._id} onClick={() => resolveSubjectDispute(dispute, 'approved', 'present')}>
                            <CheckCircle className="h-4 w-4" />
                          </button>
                          <button type="button" className="icon-action bg-white/10 text-red-200 hover:bg-white/15 disabled:opacity-60" title="Keep absent" aria-label="Keep absent" disabled={resolvingDisputeId === dispute._id} onClick={() => resolveSubjectDispute(dispute, 'approved', 'absent')}>
                            <XCircle className="h-4 w-4" />
                          </button>
                          <button type="button" className="icon-action bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-60" title="Reject dispute" aria-label="Reject dispute" disabled={resolvingDisputeId === dispute._id} onClick={() => resolveSubjectDispute(dispute, 'rejected')}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="max-w-sm text-sm text-slate-400">{dispute.resolutionNote || 'No resolution note added.'}</p>
                    )}
                  </div>
                </div>
              ))}
              {!disputes.length && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-500">No disputes found for this subject.</div>
              )}
            </div>
          </div>
        </div>
      ) : loading ? (
        <PageSkeleton variant={selectedSemester ? 'grid' : 'grid'} cards={6} />
      ) : isSuperAdmin && !selectedCourse ? (
        academicOptions.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No course folders found.</p>
          </div>
        ) : (
          <div className="card-strip sm:grid-cols-2 xl:grid-cols-3">
            {academicOptions.map(folder => (
              <motion.div
                key={folder.course}
                role="button"
                tabIndex={0}
                onClick={() => updateQuery(setSearchParams, { course: folder.course, branch: '', semester: '' })}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') updateQuery(setSearchParams, { course: folder.course, branch: '', semester: '' });
                }}
                className="glass-card compact-card cursor-pointer text-left border border-transparent transition-all hover:border-primary-500/40"
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-primary-500/15 text-primary-300">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{folder.course}</p>
                    <p className="text-slate-400 text-sm">{folder.branches.length} branches</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="badge badge-neutral">{folder.subjects} subjects</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={(event) => { event.stopPropagation(); setAcademicDeleteTarget({ type: 'course', course: folder.course }); }} className="text-slate-500 hover:text-red-300" title="Delete course">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); updateQuery(setSearchParams, { course: folder.course, branch: '', semester: '' }); }} className="text-slate-500 hover:text-white" title="Open course">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )
      ) : isSuperAdmin && selectedCourse && !selectedBranch ? (
        (academicOptions.find(item => item.course === selectedCourse)?.branches || []).length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No branch folders found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="glass-card">
              <p className="text-xs uppercase tracking-wider text-primary-300">Selected Course</p>
              <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedCourse}</h2>
              <p className="text-slate-400 text-sm mt-1">Choose a branch to view its semesters and subjects.</p>
            </div>
            <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
              {(academicOptions.find(item => item.course === selectedCourse)?.branches || []).map(folder => (
                <motion.div
                  key={folder.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => updateQuery(setSearchParams, { branch: folder.name, semester: '' })}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') updateQuery(setSearchParams, { branch: folder.name, semester: '' });
                  }}
                  className="glass-card compact-card cursor-pointer text-left border border-transparent transition-all hover:border-primary-500/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-cyan-500/15 text-cyan-300">
                      <Folder className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{folder.name}</p>
                      <p className="text-slate-400 text-sm">{folder.semesters?.length || 0} semesters</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="badge badge-neutral">{folder.subjects} subjects</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={(event) => { event.stopPropagation(); setAcademicDeleteTarget({ type: 'branch', course: selectedCourse, branch: folder.name }); }} className="text-slate-500 hover:text-red-300" title="Delete branch">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); updateQuery(setSearchParams, { branch: folder.name, semester: '' }); }} className="text-slate-500 hover:text-white" title="Open branch">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )
      ) : !isSuperAdmin && selectedDepartment && !selectedBranch ? (
        branchFolders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No branch folders found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="glass-card">
              <p className="text-xs uppercase tracking-wider text-primary-300">Selected Department</p>
              <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedDepartment}</h2>
              <p className="text-slate-400 text-sm mt-1">Choose a branch first, then open its semester folders.</p>
            </div>
            <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
              {branchFolders.map(folder => (
                <motion.button
                  key={folder.branch}
                  onClick={() => updateQuery(setSearchParams, { branch: folder.branch, semester: '' })}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className="glass-card compact-card text-left border border-transparent transition-all hover:border-primary-500/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-cyan-500/15 text-cyan-300">
                      <Folder className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{folder.branch}</p>
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
          </div>
        )
      ) : ((isSuperAdmin && selectedCourse && selectedBranch) || (!isSuperAdmin && selectedDepartment && selectedBranch)) && !selectedSemester ? (
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
              <p className="text-slate-400 text-sm mt-1">{selectedBranch} - choose a semester to view and manage subjects.</p>
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
        {!isTeacher && selectedSemester && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card mb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary-300">
                  <Percent className="h-4 w-4" /> Minimum Attendance Criteria
                </p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {attendanceCriteria?.minimumPercentage || 75}% required for Semester {selectedSemester}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  {selectedCourse ? `${selectedCourse} - ` : ''}{selectedBranch || selectedBranchFilter || selectedDepartment}. Students and teachers are notified instantly after changes.
                </p>
              </div>
              <button type="button" onClick={() => setCriteriaFormOpen(open => !open)} className="btn-secondary justify-center">
                {criteriaFormOpen ? <><X className="h-4 w-4" /> Close</> : <><Settings className="h-4 w-4" /> Update Criteria</>}
              </button>
            </div>
            {criteriaFormOpen && (
              <form onSubmit={saveAttendanceCriteria} className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <input className="input-field" value={selectedCourse || selectedDepartment || 'Current course'} disabled readOnly aria-label="Course" />
                <input className="input-field" value={`${selectedBranch || selectedBranchFilter || selectedDepartment} - Sem ${selectedSemester}`} disabled readOnly aria-label="Semester scope" />
                <label className="relative">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="0.1"
                    className="input-field pr-10"
                    value={criteriaValue}
                    onChange={event => setCriteriaValue(event.target.value)}
                    aria-label="Minimum attendance percentage"
                    required
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">%</span>
                </label>
                <button type="submit" disabled={criteriaSaving} className="btn-primary justify-center">
                  {criteriaSaving ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving</> : 'Save'}
                </button>
              </form>
            )}
          </motion.div>
        )}
        <div className="three-card-grid">
          {visibleSubjects.map((sub, i) => (
            <motion.div key={sub._id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/admin/subjects/${sub._id}/classroom`)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') navigate(`/admin/subjects/${sub._id}/classroom`);
              }}
              className="subject-card glass-card compact-card relative cursor-pointer hover:border-primary-500/20 border border-transparent transition-all hover:border-primary-500/40">
              {Object.values(lmsActivity[String(sub._id)] || {}).some(Boolean) && (
                <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.14)]" aria-label="New classroom activity" />
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="subject-card-icon w-7 h-7 sm:w-10 sm:h-10 rounded-xl bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-primary-400" />
                </div>
                {!isTeacher && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={statusSavingId === sub._id}
                      onClick={() => toggleSubjectClasses(sub)}
                      className={`${sub.classesStopped ? 'text-emerald-300 hover:text-emerald-200' : 'text-amber-300 hover:text-amber-200'} transition-colors disabled:opacity-50`}
                      title={sub.classesStopped ? 'Resume classes' : 'Stop classes'}
                    >
                      {sub.classesStopped ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
                    </button>
                    <button onClick={() => setDeleteTarget(sub)} className="text-slate-600 hover:text-red-400 transition-colors" title="Delete subject">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <h3 className="subject-card-title line-clamp-2 text-[11px] font-semibold text-white mt-2 sm:mt-3 sm:text-base">{sub.name}</h3>
              <p className="truncate font-mono text-[10px] text-primary-400 sm:text-sm">{sub.code}</p>
              <p className="line-clamp-1 text-slate-400 text-[10px] mt-1 sm:text-sm">{sub.department}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2 sm:gap-2 sm:mt-3">
                <span className="badge-info">Sem {sub.semester}</span>
                <span className="badge-neutral">{sub.credits} Credits</span>
                {sub.classesStopped && <span className="badge-danger">Stopped</span>}
                {lmsActivity[String(sub._id)]?.materials && <span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-200"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Material</span>}
                {lmsActivity[String(sub._id)]?.assignments && <span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-200"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Assignment</span>}
                {lmsActivity[String(sub._id)]?.quizzes && <span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-200"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Quiz</span>}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-primary-300">
                <Link
                  to={`/admin/subjects/${sub._id}/classroom`}
                  onClick={event => event.stopPropagation()}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary-400/20 px-2 py-1 text-primary-200 hover:bg-primary-500/10"
                  title="Open LMS classroom"
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Classroom</span>
                </Link>
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
