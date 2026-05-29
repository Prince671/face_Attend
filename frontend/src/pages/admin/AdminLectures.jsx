import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Plus, Video, Play, Square, ChevronRight, Calendar, Folder, FolderOpen, Download, ArrowLeft, Monitor, Building2, GraduationCap, Search, X, Filter, Eye } from 'lucide-react';
import { adminAPI, lectureAPI, subjectAPI, attendanceAPI, holidayAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton } from '../../components/LoadingStates';
import { buildAcademicOptions, findAcademicBranch, subjectMatchesAcademicBranch } from '../../utils/academicStructure';

const DEFAULT_LECTURE_DURATION = 60;

const pad = (value) => String(value).padStart(2, '0');
const toDateInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toTimeInput = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const toLocalLectureDate = (value) => {
  if (!value) return new Date();
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(value);
};

const getEndTime = (dateValue, startTime, duration) => {
  if (!dateValue || !startTime || !duration) return '';
  const [hours, minutes] = startTime.split(':').map(Number);
  const next = new Date(dateValue);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  next.setMinutes(next.getMinutes() + Number(duration || DEFAULT_LECTURE_DURATION));
  return toTimeInput(next);
};

const getDuration = (dateValue, startTime, endTime) => {
  if (!dateValue || !startTime || !endTime) return String(DEFAULT_LECTURE_DURATION);
  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  const start = new Date(dateValue);
  const end = new Date(dateValue);
  start.setHours(startHours || 0, startMinutes || 0, 0, 0);
  end.setHours(endHours || 0, endMinutes || 0, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1);
  return String(Math.max(1, Math.round((end - start) / 60000)));
};

const createDefaultForm = () => {
  const now = new Date();
  const date = toDateInput(now);
  const startTime = toTimeInput(now);
  const duration = String(DEFAULT_LECTURE_DURATION);
  return {
    subjectId: '',
    title: '',
    description: '',
    date,
    startTime,
    endTime: getEndTime(date, startTime, duration),
    duration,
    isLab: false,
    labNumber: 'LAB1'
  };
};

const sortLecturesByDateAsc = (items = []) => [...items].sort((a, b) => {
  const dateDiff = toLocalLectureDate(a.date).getTime() - toLocalLectureDate(b.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

const getWeekRange = (baseDate = new Date()) => {
  const start = new Date(baseDate);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 5);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const isInRange = (date, start, end) => {
  const value = toLocalLectureDate(date).getTime();
  return value >= start.getTime() && value <= end.getTime();
};

const startOfDay = (date = new Date()) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const isSameLocalDay = (value, date = new Date()) => startOfDay(toLocalLectureDate(value)).getTime() === startOfDay(date).getTime();
const isDateInsideHoliday = (holiday, date = new Date()) => {
  const value = startOfDay(date).getTime();
  const start = startOfDay(toLocalLectureDate(holiday.date)).getTime();
  const end = startOfDay(toLocalLectureDate(holiday.endDate || holiday.date)).getTime();
  return value >= start && value <= end;
};

const sortWeeklyLectures = (items = []) => {
  const { start, end } = getWeekRange();
  const today = startOfDay();
  return [...items].sort((a, b) => {
    const aCurrent = isInRange(a.date, start, end);
    const bCurrent = isInRange(b.date, start, end);
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    const aDate = startOfDay(toLocalLectureDate(a.date));
    const bDate = startOfDay(toLocalLectureDate(b.date));
    const aPast = aDate < today;
    const bPast = bDate < today;
    if (aPast !== bPast) return aPast ? 1 : -1;
    const aDone = a.status === 'completed';
    const bDone = b.status === 'completed';
    if (aCurrent && aDone !== bDone) return aDone ? 1 : -1;
    const dateDiff = aDate.getTime() - bDate.getTime();
    if (dateDiff !== 0) return dateDiff;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });
};

const defaultHistoryRange = () => {
  const { start } = getWeekRange();
  const previousStart = new Date(start);
  previousStart.setDate(previousStart.getDate() - 7);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 2);
  return { startDate: toDateInput(previousStart), endDate: toDateInput(previousEnd) };
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

const CSE_BRANCHES = ['Computer Science', 'Diploma CS'];
const isComputerScienceDepartment = (department) => /computer|cse|cs/i.test(String(department || ''));
const getSubjectBranch = (subject) => {
  const explicit = String(subject?.branch || subject?.program || '').trim();
  if (explicit) return explicit;
  if (!isComputerScienceDepartment(subject?.department)) return 'General';
  return 'Unassigned Branch';
};

export default function AdminLectures() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lectures, setLectures] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(createDefaultForm);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [filterSubject, setFilterSubject] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [downloading, setDownloading] = useState(false);
  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isDepartmentAdmin = user?.role === 'admin' && user?.department && !isSuperAdmin;
  const isTeacher = user?.role === 'teacher';
  const selectedCourse = isSuperAdmin ? (searchParams.get('course') || '') : '';
  const selectedBranch = searchParams.get('branch') || '';
  const [academicStructures, setAcademicStructures] = useState([]);
  const academicOptions = buildAcademicOptions(academicStructures, subjects);
  const selectedAcademicBranch = isSuperAdmin ? findAcademicBranch(academicOptions, selectedCourse, selectedBranch) : null;
  const selectedDepartment = isDepartmentAdmin ? user.department : (isSuperAdmin ? (selectedAcademicBranch?.department || '') : (searchParams.get('department') || ''));
  const selectedBranchFilter = isSuperAdmin ? (selectedAcademicBranch?.subjectBranch || '') : selectedBranch;
  const selectedSemester = searchParams.get('semester') || '';
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRange, setHistoryRange] = useState(defaultHistoryRange);
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState('');
  const [historySortMenuOpen, setHistorySortMenuOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState(null);

  const fetchLectures = () => {
    setLoading(true);
    const params = filterSubject ? { subjectId: filterSubject, allSemesters: true } : { allSemesters: true };
    lectureAPI.getAll(params).then(r => setLectures(sortLecturesByDateAsc(r.data.lectures))).catch(() => toast.error('Failed')).finally(() => setLoading(false));
  };

  const fetchHolidays = () => {
    if (isTeacher) return Promise.resolve();
    return holidayAPI.getAll().then(r => setHolidays(r.data.holidays || [])).catch(() => {});
  };

  useEffect(() => {
    Promise.all([
      subjectAPI.getAll({ allSemesters: true }),
      isSuperAdmin ? adminAPI.getAcademicStructure() : Promise.resolve({ data: { structures: [] } }),
      isTeacher ? Promise.resolve({ data: { holidays: [] } }) : holidayAPI.getAll()
    ]).then(([subjectRes, structureRes, holidayRes]) => {
      setSubjects(subjectRes.data.subjects);
      setAcademicStructures(structureRes.data.structures || []);
      setHolidays(holidayRes.data.holidays || []);
    });
    fetchLectures();
    window.addEventListener('admin-scope:changed', fetchLectures);
    const refreshSubjects = () => subjectAPI.getAll({ allSemesters: true }).then(r => setSubjects(r.data.subjects));
    window.addEventListener('admin-scope:changed', refreshSubjects);
    window.addEventListener('admin-scope:changed', fetchHolidays);
    return () => {
      window.removeEventListener('admin-scope:changed', fetchLectures);
      window.removeEventListener('admin-scope:changed', refreshSubjects);
      window.removeEventListener('admin-scope:changed', fetchHolidays);
    };
  }, []);
  useEffect(() => {
    setSelectedSubject(filterSubject);
    fetchLectures();
  }, [filterSubject]);

  useEffect(() => {
    if (!socket) return undefined;

    const refreshLectureData = () => {
      fetchLectures();
      subjectAPI.getAll({ allSemesters: true }).then(r => setSubjects(r.data.subjects)).catch(() => {});
      fetchHolidays();
    };

    socket.on('new_lecture', refreshLectureData);
    socket.on('lecture_updated', refreshLectureData);
    socket.on('lectures_changed', refreshLectureData);
    socket.on('subject_updated', refreshLectureData);
    socket.on('attendance_opened', refreshLectureData);
    socket.on('attendance_closed', refreshLectureData);
    socket.on('holiday_changed', refreshLectureData);

    return () => {
      socket.off('new_lecture', refreshLectureData);
      socket.off('lecture_updated', refreshLectureData);
      socket.off('lectures_changed', refreshLectureData);
      socket.off('subject_updated', refreshLectureData);
      socket.off('attendance_opened', refreshLectureData);
      socket.off('attendance_closed', refreshLectureData);
      socket.off('holiday_changed', refreshLectureData);
    };
  }, [socket, filterSubject]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await lectureAPI.create(form);
      toast.success(res.data?.holiday ? (res.data.message || 'Lecture created as cancelled because today is a holiday.') : 'Lecture created!');
      setForm(createDefaultForm());
      setShowForm(false);
      fetchLectures();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAttendance = async (id, action, options = {}) => {
    setActionLoading(id + action);
    try {
      if (action === 'start') {
        const res = await lectureAPI.startAttendance(id, options);
        toast.success(`Attendance opened! Code: ${res.data.code}`, { duration: 10000 });
      } else {
        await lectureAPI.stopAttendance(id);
        toast.success('Attendance closed');
      }
      fetchLectures();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setActionLoading(null); }
  };

  const statusColor = { scheduled: 'badge-neutral', ongoing: 'badge-success', completed: 'badge-info', cancelled: 'badge-danger' };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(new Blob([blob]));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const getDownloadError = async (error) => {
    const data = error.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text);
        return parsed.message || 'Download failed';
      } catch {
        return 'Download failed';
      }
    }
    return data?.message || 'Download failed';
  };

  const handleSessionDownload = async () => {
    setDownloading(true);
    try {
      const res = await attendanceAPI.downloadSessionExcel();
      downloadBlob(res.data, `Session_Attendance_${Date.now()}.xlsx`);
      toast.success('Session attendance downloaded');
    } catch (e) {
      toast.error(await getDownloadError(e));
    } finally {
      setDownloading(false);
    }
  };

  const handleSubjectDownload = async (folder) => {
    if (!folder?.subject?._id) return;
    setDownloading(folder.subject._id);
    try {
      const res = await attendanceAPI.downloadSessionExcel({ subjectId: folder.subject._id });
      downloadBlob(res.data, `Subject_Attendance_${folder.subject.code || 'subject'}_${Date.now()}.xlsx`);
      toast.success(`${folder.subject.name} attendance downloaded`);
    } catch (e) {
      toast.error(await getDownloadError(e));
    } finally {
      setDownloading(false);
    }
  };

  const openLectureForm = (subjectId = '') => {
    const nextForm = createDefaultForm();
    nextForm.subjectId = subjectId;
    setForm(nextForm);
    setShowForm(true);
  };

  const openFolderLectureForm = (folder) => {
    openLectureForm(folder.subject._id);
  };

  const closeSelectedFolder = () => {
    setSelectedSubject('');
    if (showForm) {
      setShowForm(false);
      setForm(createDefaultForm());
    }
  };

  const selectDepartment = (department) => {
    updateQuery(setSearchParams, { department, branch: '', semester: '' });
    setSelectedSubject('');
    setFilterSubject('');
    setShowForm(false);
  };

  const selectCourse = (course) => {
    updateQuery(setSearchParams, { course, branch: '', department: '', semester: '' });
    setSelectedSubject('');
    setFilterSubject('');
    setShowForm(false);
  };

  const selectBranch = (branch) => {
    updateQuery(setSearchParams, { branch, semester: '' });
    setSelectedSubject('');
    setFilterSubject('');
    setShowForm(false);
  };

  const selectSemester = (semester) => {
    updateQuery(setSearchParams, { semester: String(semester) });
    setSelectedSubject('');
    setFilterSubject('');
    setShowForm(false);
  };

  const goBack = () => {
    if (selectedSubject) {
      closeSelectedFolder();
      return;
    }
    if (selectedSemester) {
      updateQuery(setSearchParams, { semester: '' });
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

  const handleSubjectSelect = (subjectId) => {
    setSelectedSubject(subjectId);
    if (showForm) {
      setForm(current => ({ ...current, subjectId }));
    }
  };

  const handleFilterSubject = (value) => {
    setFilterSubject(value);
    if (showForm) {
      setForm(current => ({ ...current, subjectId: value || current.subjectId }));
    }
  };

  const handleSubjectChange = (value) => {
    setForm({ ...form, subjectId: value });
  };

  const isSubjectDownloadActive = (folder) => downloading === folder.subject._id;

  const isSessionDownloading = downloading === true;

  const openHistory = async (folder) => {
    if (!folder?.subject?._id) return;
    setHistoryOpen(true);
    setHistoryData(null);
    setHistorySearch('');
    setHistorySort('');
    setHistorySortMenuOpen(false);
    setHistoryRange(defaultHistoryRange());
  };

  const fetchHistory = async () => {
    if (!selectedFolder?.subject?._id) return;
    setHistoryLoading(true);
    try {
      const res = await attendanceAPI.getSubjectHistory(selectedFolder.subject._id, {
        startDate: historyRange.startDate,
        endDate: historyRange.endDate,
        search: historySearch || undefined
      });
      setHistoryData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load attendance history');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!historyOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [historyOpen]);

  const updateDate = (date) => {
    setForm(current => ({
      ...current,
      date,
      endTime: getEndTime(date, current.startTime, current.duration)
    }));
  };

  const updateStartTime = (startTime) => {
    setForm(current => ({
      ...current,
      startTime,
      endTime: getEndTime(current.date, startTime, current.duration)
    }));
  };

  const updateEndTime = (endTime) => {
    setForm(current => ({
      ...current,
      endTime,
      duration: getDuration(current.date, current.startTime, endTime)
    }));
  };

  const updateDuration = (duration) => {
    setForm(current => ({
      ...current,
      duration,
      endTime: getEndTime(current.date, current.startTime, duration)
    }));
  };

  const folders = subjects
    .map(subject => ({
      subject,
      lectures: sortLecturesByDateAsc(lectures.filter(lecture => lecture.subject?._id === subject._id))
    }))
    .filter(folder => !filterSubject || folder.subject._id === filterSubject)
    .filter(folder => (
      (isSuperAdmin
        ? (!selectedAcademicBranch || subjectMatchesAcademicBranch(folder.subject, selectedAcademicBranch))
        : ((!selectedDepartment || folder.subject.department === selectedDepartment) && (!selectedBranchFilter || getSubjectBranch(folder.subject) === selectedBranchFilter))) &&
      (!selectedSemester || Number(folder.subject.semester) === Number(selectedSemester))
    ));

  const selectedFolder = folders.find(folder => folder.subject._id === selectedSubject) || null;
  const visibleFolders = selectedFolder ? [selectedFolder] : folders;
  const visibleLectures = sortWeeklyLectures(selectedFolder?.lectures || []);
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
  const { start: currentWeekStart, end: currentWeekEnd } = getWeekRange();
  const today = startOfDay();
  const todayHolidays = holidays.filter(holiday => isDateInsideHoliday(holiday, today));
  const cancelledTodayCount = lectures.filter(lecture => isSameLocalDay(lecture.date, today) && lecture.status === 'cancelled' && lecture.cancelledByHoliday).length;
  const todayLectures = visibleLectures.filter(lecture => isSameLocalDay(lecture.date, today));
  const previousLectures = visibleLectures.filter(lecture => startOfDay(toLocalLectureDate(lecture.date)) < today);
  const displayLectures = selectedFolder ? todayLectures : [];
  const courseFolders = academicOptions.map(course => {
      const courseSubjects = subjects.filter(subject => course.branches.some(branch => subjectMatchesAcademicBranch(subject, branch)));
      const subjectIds = new Set(courseSubjects.map(subject => subject._id));
      const courseLectures = lectures.filter(lecture => subjectIds.has(lecture.subject?._id));
      return {
        course: course.course,
        branches: course.branches.length,
        subjects: courseSubjects.length,
        lectures: courseLectures.length,
        open: courseLectures.filter(lecture => lecture.attendanceOpen).length,
        completed: courseLectures.filter(lecture => lecture.status === 'completed').length
      };
    });
  const branchFolders = isSuperAdmin && selectedCourse
    ? (academicOptions.find(item => item.course === selectedCourse)?.branches || []).map(branch => {
      const branchSubjects = subjects.filter(subject => subjectMatchesAcademicBranch(subject, branch));
      const subjectIds = new Set(branchSubjects.map(subject => subject._id));
      const branchLectures = lectures.filter(lecture => subjectIds.has(lecture.subject?._id));
      return {
        branch: branch.name,
        subjects: branchSubjects.length,
        semesters: branch.semesters?.length || 0,
        lectures: branchLectures.length,
        open: branchLectures.filter(lecture => lecture.attendanceOpen).length,
        completed: branchLectures.filter(lecture => lecture.status === 'completed').length
      };
    })
    : (isComputerScienceDepartment(selectedDepartment)
    ? [...CSE_BRANCHES, 'Unassigned Branch']
    : Array.from(new Set(subjects.filter(subject => subject.department === selectedDepartment).map(getSubjectBranch)))
  ).map(branch => {
    const branchSubjects = subjects.filter(subject => subject.department === selectedDepartment && getSubjectBranch(subject) === branch);
    const subjectIds = new Set(branchSubjects.map(subject => subject._id));
    const branchLectures = lectures.filter(lecture => subjectIds.has(lecture.subject?._id));
    return {
      branch,
      subjects: branchSubjects.length,
      semesters: new Set(branchSubjects.map(subject => Number(subject.semester)).filter(Boolean)).size,
      lectures: branchLectures.length,
      open: branchLectures.filter(lecture => lecture.attendanceOpen).length,
      completed: branchLectures.filter(lecture => lecture.status === 'completed').length
    };
  }).filter(folder => folder.subjects > 0);
  const semesterFolders = Array.from(new Set([
    ...((isSuperAdmin && selectedAcademicBranch?.semesters) ? selectedAcademicBranch.semesters : []),
    ...(
    subjects
      .filter(subject => subject.department === selectedDepartment)
      .filter(subject => !selectedBranchFilter || getSubjectBranch(subject) === selectedBranchFilter)
      .map(subject => Number(subject.semester))
      .filter(Boolean)
    )
  ])).sort((a, b) => a - b)
    .map(semester => {
      const semesterSubjects = subjects.filter(subject => (
        subject.department === selectedDepartment &&
        (!selectedBranchFilter || getSubjectBranch(subject) === selectedBranchFilter) &&
        Number(subject.semester) === semester
      ));
      const subjectIds = new Set(semesterSubjects.map(subject => subject._id));
      const semesterLectures = lectures.filter(lecture => subjectIds.has(lecture.subject?._id));
      return {
        semester,
        subjects: semesterSubjects.length,
        lectures: semesterLectures.length,
        open: semesterLectures.filter(lecture => lecture.attendanceOpen).length,
        completed: semesterLectures.filter(lecture => lecture.status === 'completed').length
      };
    });
  const showSubjectFolders = isTeacher || (selectedDepartment && selectedBranch && selectedSemester);
  const formTitle = selectedFolder
    ? `Create New Lecture for ${selectedFolder.subject.name} (${selectedFolder.subject.code})`
    : 'Create New Lecture';
  const breadcrumbItems = isTeacher
    ? [
      { label: 'Assigned Subjects', onClick: selectedFolder ? () => setSelectedSubject('') : undefined },
      selectedFolder && { label: selectedFolder.subject.name },
      selectedFolder && { label: 'Lectures' }
    ]
    : isSuperAdmin
    ? [
      { label: 'Courses', onClick: () => { updateQuery(setSearchParams, { course: '', branch: '', semester: '' }); setSelectedSubject(''); } },
      selectedCourse && { label: selectedCourse, onClick: () => { updateQuery(setSearchParams, { branch: '', semester: '' }); setSelectedSubject(''); } },
      selectedBranch && { label: selectedBranch, onClick: () => { updateQuery(setSearchParams, { semester: '' }); setSelectedSubject(''); } },
      selectedSemester && { label: `Semester ${selectedSemester}`, onClick: selectedFolder ? () => setSelectedSubject('') : undefined },
      selectedFolder && { label: selectedFolder.subject.name },
      (selectedDepartment && selectedBranch && selectedSemester && !selectedFolder) && { label: 'Subjects' },
      selectedFolder && { label: 'Lectures' }
    ]
    : [
      { label: selectedDepartment || 'Department' },
      selectedBranch && { label: selectedBranch, onClick: () => { updateQuery(setSearchParams, { semester: '' }); setSelectedSubject(''); } },
      selectedSemester && { label: `Semester ${selectedSemester}`, onClick: selectedFolder ? () => setSelectedSubject('') : undefined },
      selectedFolder && { label: selectedFolder.subject.name },
      selectedFolder && { label: 'Lectures' }
    ];

  const historyModal = (
    <AnimatePresence>
      {historyOpen && selectedFolder && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="app-modal-backdrop sm:p-5"
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            className="glass-card flex max-h-[min(88dvh,760px)] w-full max-w-5xl flex-col overflow-hidden p-0 shadow-2xl"
          >
            <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-white/10 p-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-white">Attendance History</h2>
                <p className="text-sm text-slate-400">{selectedFolder.subject.name} - {selectedFolder.subject.code}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {historySort
                    ? `Sorted by attendance percentage ${historySort === 'desc' ? 'high to low' : 'low to high'}.`
                    : 'Students are sorted by the numeric series in their student ID.'}
                </p>
              </div>
              <button onClick={() => setHistoryOpen(false)} className="btn-secondary p-2" aria-label="Close history">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div className="attendance-history-controls grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-[1fr_1fr_1.5fr_auto]">
                <input className="input-field attendance-history-date min-w-0" type="date" value={historyRange.startDate} onChange={e => setHistoryRange({ ...historyRange, startDate: e.target.value })} />
                <input className="input-field attendance-history-date min-w-0" type="date" value={historyRange.endDate} onChange={e => setHistoryRange({ ...historyRange, endDate: e.target.value })} />
                <div className="attendance-history-search relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input className="input-field pl-9" placeholder="Search student name, ID, or email" value={historySearch} onChange={e => setHistorySearch(e.target.value)} />
                </div>
                <button onClick={fetchHistory} disabled={historyLoading} className={`btn-primary attendance-history-view whitespace-nowrap ${historyLoading ? 'action-pulse' : ''}`} title="View attendance history" aria-label="View attendance history">
                  {historyLoading ? <span className="hidden sm:inline">Loading...</span> : <><Eye className="h-4 w-4" /><span className="hidden sm:inline">View</span></>}
                </button>
              </div>

              {historyData && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Lectures</p><p className="text-xl font-bold text-white">{historyData.summary.totalLectures}</p></div>
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Students</p><p className="text-xl font-bold text-white">{historyData.summary.totalStudents}</p></div>
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Present Marks</p><p className="text-xl font-bold text-emerald-300">{historyData.summary.totalPresent}</p></div>
                    <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Average</p><p className="text-xl font-bold text-primary-300">{historyData.summary.percentage}%</p></div>
                  </div>

                  <div className="table-scroll rounded-xl border border-white/10">
                    <table className="data-table divide-y divide-white/10 text-sm">
                      <colgroup>
                        <col className="w-[34%]" />
                        <col className="w-[20%]" />
                        <col className="w-[16%]" />
                        <col className="w-[16%]" />
                        <col className="w-[14%]" />
                      </colgroup>
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
                          <tr><td colSpan="5" className="px-3 py-8 text-center text-slate-500">No matching attendance records found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-2">
                    <h3 className="font-semibold text-white">Lecture Summary</h3>
                    {historyData.lectures.map(item => (
                      <div key={item.lecture._id} className="flex flex-col gap-2 rounded-xl bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">{item.lecture.title}</p>
                          <p className="text-xs text-slate-500">{new Date(item.lecture.date).toLocaleDateString()} - {item.lecture.startTime}</p>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <span className="badge badge-success">{item.present} present</span>
                          <span className="badge badge-danger">{item.absent} absent</span>
                          <span className="badge badge-info">{item.percentage}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {!historyData && !historyLoading && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-500">
                  Select a date range and press View to load previous attendance.
                </div>
              )}

              <button type="button" onClick={() => setHistoryOpen(false)} className="btn-secondary w-full justify-center">
                Close Attendance History
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {typeof document !== 'undefined' ? createPortal(historyModal, document.body) : null}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white">Lectures</h1>
          <p className="text-slate-400 mt-1">Manage lectures and attendance sessions</p>
        </div>
        {((isSuperAdmin && (selectedCourse || selectedBranch || selectedSemester || selectedSubject)) || (!isSuperAdmin && (selectedBranch || selectedSemester || selectedSubject))) && (
          <button type="button" onClick={goBack} className="btn-secondary inline-flex items-center gap-2 justify-center" title="Back">
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
          </button>
        )}
      </div>
      <AdminBreadcrumb items={breadcrumbItems} />
      {todayHolidays.length > 0 && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-amber-50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-semibold text-amber-100">
                <Calendar className="h-5 w-5" /> Today is marked as {todayHolidays[0].type}: {todayHolidays[0].title}
              </p>
              <p className="mt-1 text-sm text-amber-100/80">
                Lectures matching this holiday's audience are automatically cancelled and attendance cannot be started for them.
              </p>
              {todayHolidays.length > 1 && (
                <p className="mt-1 text-xs text-amber-100/70">
                  Also active today: {todayHolidays.slice(1).map(item => item.title).join(', ')}
                </p>
              )}
            </div>
            <span className="w-fit rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
              {cancelledTodayCount} lecture{cancelledTodayCount === 1 ? '' : 's'} cancelled today
            </span>
          </div>
        </div>
      )}
      {!selectedFolder && (
      <div className="flex sm:justify-end">
        <button onClick={handleSessionDownload} disabled={downloading} className="btn-secondary flex items-center gap-2" title="Download session attendance">
          <Download className={`w-4 h-4 ${isSessionDownloading ? 'animate-bounce' : ''}`} />
          <span className="hidden sm:inline">{isSessionDownloading ? 'Downloading...' : 'Download Session Attendance'}</span>
        </button>
      </div>
      )}

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -14, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -10, height: 0 }} transition={{ duration: 0.24 }} className="glass-card overflow-hidden">
          <h2 className="font-semibold text-white mb-4">{formTitle}</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="label">Subject *</label>
              <select className="input-field" value={form.subjectId} onChange={e => handleSubjectChange(e.target.value)} disabled={Boolean(selectedFolder)} required>
                <option value="">Select Subject</option>
                {subjects.map(s => <option key={s._id} value={s._id}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Lecture Title *</label>
              <input className="input-field" placeholder="Introduction to Arrays" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input-field" value={form.date} onChange={e => updateDate(e.target.value)} required />
            </div>
            <div>
              <label className="label">Start Time *</label>
              <input type="time" className="input-field" value={form.startTime} onChange={e => updateStartTime(e.target.value)} required />
            </div>
            <div>
              <label className="label">End Time *</label>
              <input type="time" className="input-field" value={form.endTime} onChange={e => updateEndTime(e.target.value)} required />
            </div>
            <div>
              <label className="label">Duration (minutes) *</label>
              <input type="number" min="1" className="input-field" placeholder="60" value={form.duration} onChange={e => updateDuration(e.target.value)} required />
            </div>
            <div className="md:col-span-2 lg:col-span-3 rounded-lg border border-white/10 bg-white/5 p-3">
              <label className="flex items-center gap-3 text-sm text-white">
                <input
                  type="checkbox"
                  checked={form.isLab}
                  onChange={e => setForm({ ...form, isLab: e.target.checked, labNumber: e.target.checked ? form.labNumber : 'LAB1' })}
                />
                <span className="flex items-center gap-2"><Monitor className="w-4 h-4 text-primary-300" /> Lab lecture</span>
              </label>
              {form.isLab && (
                <div className="flex flex-wrap gap-3 mt-3">
                  {['LAB1', 'LAB2', 'LAB3'].map(option => (
                    <label key={option} className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="radio"
                        name="labNumber"
                        value={option}
                        checked={form.labNumber === option}
                        onChange={e => setForm({ ...form, labNumber: e.target.value })}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className="label">Description</label>
              <textarea className="input-field resize-none" rows={2} placeholder="Optional notes..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <motion.button type="submit" disabled={saving} className={`btn-primary ${saving ? 'action-pulse' : ''}`} whileHover={{ scale: saving ? 1 : 1.01 }} whileTap={{ scale: 0.98 }}>
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : 'Create Lecture'}
              </motion.button>
            </div>
          </form>
        </motion.div>
      )}

      {/* Filter */}
      {!selectedFolder && !isSuperAdmin && (isTeacher || (selectedBranch && selectedSemester)) && (
      <div className="flex items-center gap-3">
        <select className="input-field sm:w-auto" value={filterSubject} onChange={e => handleFilterSubject(e.target.value)}>
          <option value="">All Subjects</option>
          {subjects.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
      </div>
      )}

      {loading ? (
        <PageSkeleton variant={selectedSemester ? 'table' : 'grid'} rows={6} cards={6} />
      ) : (
        <div className="space-y-5">
          {isSuperAdmin && !selectedCourse && (
            <div className="card-strip sm:grid-cols-2 xl:grid-cols-3">
              {courseFolders.map(folder => (
                <motion.button
                  key={folder.course}
                  onClick={() => selectCourse(folder.course)}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className="glass-card compact-card text-left border border-transparent transition-all hover:border-primary-500/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-primary-500/15 text-primary-300">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{folder.course}</p>
                      <p className="text-slate-400 text-sm">{folder.branches} branches - {folder.subjects} subjects</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="badge badge-neutral">{folder.lectures} lectures</span>
                        {folder.open > 0 && <span className="badge badge-success">{folder.open} open</span>}
                        {folder.completed > 0 && <span className="badge badge-info">{folder.completed} completed</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          {!isTeacher && ((isSuperAdmin && selectedCourse) || selectedDepartment) && !selectedBranch && (
            <div className="space-y-4">
              <div className="glass-card">
                <p className="text-xs uppercase tracking-wider text-primary-300">{isSuperAdmin ? 'Selected Course' : 'Selected Department'}</p>
                <h2 className="font-display text-xl font-semibold text-white mt-1">{isSuperAdmin ? selectedCourse : selectedDepartment}</h2>
                <p className="text-slate-400 text-sm mt-1">Choose a branch to view semester folders and lectures.</p>
              </div>
              <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
                {branchFolders.map(folder => (
                  <motion.button
                    key={folder.branch}
                    onClick={() => selectBranch(folder.branch)}
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
                          <span className="badge badge-neutral">{folder.lectures} lectures</span>
                          {folder.open > 0 && <span className="badge badge-success">{folder.open} open</span>}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {!isTeacher && selectedDepartment && selectedBranch && !selectedSemester && (
            <div className="space-y-4">
              <div className="glass-card">
                <p className="text-xs uppercase tracking-wider text-primary-300">{isSuperAdmin ? selectedCourse : 'Selected Department'}</p>
                <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedBranch}</h2>
                <p className="text-slate-400 text-sm mt-1">{selectedBranch} - choose a semester to view subject folders and lectures.</p>
              </div>
              <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
                {semesterFolders.map(folder => (
                  <motion.button
                    key={folder.semester}
                    onClick={() => selectSemester(folder.semester)}
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
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="badge badge-neutral">{folder.lectures} lectures</span>
                          {folder.open > 0 && <span className="badge badge-success">{folder.open} open</span>}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {showSubjectFolders && (
          <div className="three-card-grid">
            {visibleFolders.map(folder => {
              const isSelected = folder.subject._id === selectedSubject;
              const openCount = folder.lectures.filter(lecture => lecture.attendanceOpen).length;
              return (
                <motion.button
                  key={folder.subject._id}
                  onClick={() => handleSubjectSelect(folder.subject._id)}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className={`glass-card compact-card text-left border transition-all hover:border-primary-500/40 ${isSelected ? 'border-primary-500/50 bg-primary-500/10' : 'border-transparent'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${isSelected ? 'bg-primary-500/20 text-primary-300' : 'bg-white/5 text-slate-400'}`}>
                      {isSelected ? <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" /> : <Folder className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white line-clamp-2 text-[11px] sm:text-base">{folder.subject.name}</p>
                      <p className="text-slate-400 text-sm">{folder.subject.code} · Semester {folder.subject.semester}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 sm:gap-2">
                        <span className="badge badge-neutral">{folder.lectures.length} lectures</span>
                        {openCount > 0 && <span className="badge badge-success">{openCount} open</span>}
                      </div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
          )}

          {selectedFolder && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-white">{selectedFolder.subject.name}</h2>
                <p className="text-slate-500 text-sm">{visibleLectures.length} lectures in this subject folder</p>
              </div>
              <div className="grid w-full grid-cols-4 gap-2 sm:flex sm:w-auto sm:flex-row">
                <motion.button
                  type="button"
                  onClick={() => openFolderLectureForm(selectedFolder)}
                  className="btn-primary inline-flex h-11 min-w-0 items-center justify-center gap-2 px-0 sm:h-auto sm:px-5"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  title="New lecture"
                  aria-label="New lecture"
                >
                  <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Lecture</span>
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => openHistory(selectedFolder)}
                  className="btn-secondary inline-flex h-11 min-w-0 items-center justify-center gap-2 px-0 sm:h-auto sm:px-5"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  title="Date range attendance"
                  aria-label="Date range attendance"
                >
                  <Calendar className="w-4 h-4" /> <span className="hidden sm:inline">Date Range Attendance</span>
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => handleSubjectDownload(selectedFolder)}
                  disabled={isSubjectDownloadActive(selectedFolder)}
                  className={`btn-secondary inline-flex h-11 min-w-0 items-center justify-center gap-2 px-0 sm:h-auto sm:px-5 ${isSubjectDownloadActive(selectedFolder) ? 'action-pulse' : ''}`}
                  whileHover={{ scale: isSubjectDownloadActive(selectedFolder) ? 1 : 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  title="Download attendance"
                  aria-label="Download attendance"
                >
                  <Download className={`w-4 h-4 ${isSubjectDownloadActive(selectedFolder) ? 'animate-bounce' : ''}`} />
                  <span className="hidden sm:inline">{isSubjectDownloadActive(selectedFolder) ? 'Downloading...' : 'Download Attendance'}</span>
                </motion.button>
                <motion.button
                  type="button"
                  onClick={closeSelectedFolder}
                  className="btn-secondary inline-flex h-11 min-w-0 items-center justify-center gap-2 px-0 sm:h-auto sm:px-5"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  title="Back"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
                </motion.button>
              </div>
            </div>
          )}

          {selectedFolder && (
            <div className="glass-card border border-primary-500/20 bg-primary-500/5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-white">Today's Lectures</p>
                  <p className="text-sm text-slate-400">
                    {currentWeekStart.toLocaleDateString()} - {currentWeekEnd.toLocaleDateString()} · showing today's lecture cards only.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Completed lectures remain visible only for their lecture day. After 12:00 AM, the next day's scheduled cards appear automatically.
                  </p>
                </div>
                {previousLectures.length > 0 && (
                  <button type="button" onClick={() => openHistory(selectedFolder)} className="btn-secondary inline-flex items-center gap-2 justify-center">
                    <Calendar className="w-4 h-4" /> {previousLectures.length} previous
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedFolder && (
            <div className="three-card-list lecture-today-list">
            {displayLectures.map((lec, i) => (
            <motion.div key={lec._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="glass-card compact-card min-h-[9.5rem] hover:border-white/10 border border-transparent transition-all lg:min-h-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className={`h-1 w-full sm:w-2 sm:h-14 rounded-full flex-shrink-0 ${lec.attendanceOpen ? 'bg-emerald-500' : lec.status === 'completed' ? 'bg-primary-500' : lec.status === 'cancelled' ? 'bg-red-500' : 'bg-slate-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap sm:gap-2">
                    <h3 className="line-clamp-2 text-[11px] font-semibold text-white sm:text-base">{lec.title}</h3>
                    {lec.isLab && (
                      <span className="badge badge-info flex items-center gap-1">
                        <Monitor className="w-3 h-3" /> {lec.labNumber || 'LAB'}
                      </span>
                    )}
                    <span className={`badge ${statusColor[lec.status]}`}>{lec.status}</span>
                    {lec.attendanceOpen && (
                      <span className="badge badge-success animate-pulse">🟢 Attendance Open</span>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm mt-0.5">{lec.subject?.name} · {lec.subject?.code}</p>
                  <p className="text-slate-500 text-xs mt-0.5">
                    <Calendar className="w-3 h-3 inline mr-1" />
                    {toLocalLectureDate(lec.date).toLocaleDateString()} · {lec.startTime} - {lec.endTime} ({lec.duration} min)
                  </p>
                  {lec.status === 'cancelled' && lec.cancellationReason && (
                    <p className="mt-1 rounded-lg border border-red-400/20 bg-red-500/10 px-2 py-1 text-xs text-red-100">
                      Cancelled because of {lec.cancellationReason}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-auto sm:flex-row sm:items-center sm:gap-2">
                  {!lec.attendanceOpen && !['completed', 'cancelled'].includes(lec.status) && (
                    <button onClick={() => handleAttendance(lec._id, 'start')}
                      disabled={actionLoading === lec._id + 'start'}
                      className="btn-success flex items-center gap-1 py-2 px-3 text-sm">
                      <Play className="w-3.5 h-3.5" /> Start
                    </button>
                  )}
                  {lec.attendanceOpen && (
                    <button onClick={() => handleAttendance(lec._id, 'stop')}
                      disabled={actionLoading === lec._id + 'stop'}
                      className="btn-danger flex items-center gap-1 py-2 px-3 text-sm">
                      <Square className="w-3.5 h-3.5" /> Stop
                    </button>
                  )}
                  <Link to={`/admin/lectures/${lec._id}`}
                    className="btn-secondary flex items-center gap-1 py-2 px-3 text-sm">
                    View <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </motion.div>
          ))}
            </div>
          )}
          {selectedFolder && displayLectures.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No lectures scheduled for today.</p>
              <p className="text-xs mt-1">Previous lectures are available from Date Range Attendance.</p>
            </div>
          )}
          {!selectedFolder && folders.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{isSuperAdmin && !selectedCourse ? 'No course folders found.' : 'No subject folders found.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
