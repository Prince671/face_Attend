import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Plus, Video, Play, Square, ChevronRight, Calendar, Folder, FolderOpen, Download, ArrowLeft, Monitor, Building2, GraduationCap } from 'lucide-react';
import { lectureAPI, subjectAPI, attendanceAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';

const DEFAULT_LECTURE_DURATION = 60;

const pad = (value) => String(value).padStart(2, '0');
const toDateInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toTimeInput = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

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
  const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

export default function AdminLectures() {
  const { user } = useAuth();
  const [lectures, setLectures] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(createDefaultForm);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [filterSubject, setFilterSubject] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');

  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');

  const fetchLectures = () => {
    setLoading(true);
    const params = filterSubject ? { subjectId: filterSubject } : {};
    lectureAPI.getAll(params).then(r => setLectures(sortLecturesByDateAsc(r.data.lectures))).catch(() => toast.error('Failed')).finally(() => setLoading(false));
  };

  useEffect(() => {
    subjectAPI.getAll().then(r => setSubjects(r.data.subjects));
    fetchLectures();
    window.addEventListener('admin-scope:changed', fetchLectures);
    const refreshSubjects = () => subjectAPI.getAll().then(r => setSubjects(r.data.subjects));
    window.addEventListener('admin-scope:changed', refreshSubjects);
    return () => {
      window.removeEventListener('admin-scope:changed', fetchLectures);
      window.removeEventListener('admin-scope:changed', refreshSubjects);
    };
  }, []);
  useEffect(() => {
    setSelectedSubject(filterSubject);
    fetchLectures();
  }, [filterSubject]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await lectureAPI.create(form);
      toast.success('Lecture created!');
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
    setSelectedDepartment(department);
    setSelectedSemester('');
    setSelectedSubject('');
    setFilterSubject('');
    setShowForm(false);
  };

  const selectSemester = (semester) => {
    setSelectedSemester(String(semester));
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
      setSelectedSemester('');
      return;
    }
    if (selectedDepartment) {
      setSelectedDepartment('');
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
    .filter(folder => !isSuperAdmin || (
      (!selectedDepartment || folder.subject.department === selectedDepartment) &&
      (!selectedSemester || Number(folder.subject.semester) === Number(selectedSemester))
    ));

  const selectedFolder = folders.find(folder => folder.subject._id === selectedSubject) || null;
  const visibleFolders = selectedFolder ? [selectedFolder] : folders;
  const visibleLectures = selectedFolder?.lectures || [];
  const departmentFolders = Array.from(new Set(subjects.map(subject => subject.department).filter(Boolean))).sort()
    .map(department => {
      const departmentSubjects = subjects.filter(subject => subject.department === department);
      const subjectIds = new Set(departmentSubjects.map(subject => subject._id));
      const departmentLectures = lectures.filter(lecture => subjectIds.has(lecture.subject?._id));
      return {
        department,
        subjects: departmentSubjects.length,
        lectures: departmentLectures.length,
        open: departmentLectures.filter(lecture => lecture.attendanceOpen).length,
        completed: departmentLectures.filter(lecture => lecture.status === 'completed').length
      };
    });
  const semesterFolders = Array.from(new Set(
    subjects
      .filter(subject => subject.department === selectedDepartment)
      .map(subject => Number(subject.semester))
      .filter(Boolean)
  )).sort((a, b) => a - b)
    .map(semester => {
      const semesterSubjects = subjects.filter(subject => subject.department === selectedDepartment && Number(subject.semester) === semester);
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
  const showSubjectFolders = !isSuperAdmin || (selectedDepartment && selectedSemester);
  const formTitle = selectedFolder
    ? `Create New Lecture for ${selectedFolder.subject.name} (${selectedFolder.subject.code})`
    : 'Create New Lecture';
  const breadcrumbItems = isSuperAdmin
    ? [
      { label: 'Departments', onClick: () => { setSelectedDepartment(''); setSelectedSemester(''); setSelectedSubject(''); } },
      selectedDepartment && { label: selectedDepartment, onClick: () => { setSelectedSemester(''); setSelectedSubject(''); } },
      selectedSemester && { label: `Semester ${selectedSemester}`, onClick: selectedFolder ? () => setSelectedSubject('') : undefined },
      selectedFolder && { label: selectedFolder.subject.name },
      (selectedDepartment && selectedSemester && !selectedFolder) && { label: 'Subjects' },
      selectedFolder && { label: 'Lectures' }
    ]
    : [{ label: 'Lectures' }];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white">Lectures</h1>
          <p className="text-slate-400 mt-1">Manage lectures and attendance sessions</p>
        </div>
        {isSuperAdmin && (selectedDepartment || selectedSemester || selectedSubject) && (
          <button type="button" onClick={goBack} className="btn-secondary inline-flex items-center gap-2 justify-center">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
      </div>
      <AdminBreadcrumb items={breadcrumbItems} />
      {!selectedFolder && (
      <div className="flex sm:justify-end">
        <button onClick={handleSessionDownload} disabled={downloading} className="btn-secondary flex items-center gap-2">
          <Download className="w-4 h-4" /> {isSessionDownloading ? 'Downloading...' : 'Download Session Attendance'}
        </button>
      </div>
      )}

      <AnimatePresence>
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
      </AnimatePresence>

      {/* Filter */}
      {!selectedFolder && !isSuperAdmin && (
      <div className="flex items-center gap-3">
        <select className="input-field sm:w-auto" value={filterSubject} onChange={e => handleFilterSubject(e.target.value)}>
          <option value="">All Subjects</option>
          {subjects.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
      </div>
      )}

      {loading ? (
        <PageLoader label="Loading lecture folders..." />
      ) : (
        <div className="space-y-5">
          {isSuperAdmin && !selectedDepartment && (
            <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
              {departmentFolders.map(folder => (
                <motion.button
                  key={folder.department}
                  onClick={() => selectDepartment(folder.department)}
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
                      <p className="text-slate-400 text-sm">{folder.subjects} subjects</p>
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

          {isSuperAdmin && selectedDepartment && !selectedSemester && (
            <div className="space-y-4">
              <div className="glass-card">
                <p className="text-xs uppercase tracking-wider text-primary-300">Selected Department</p>
                <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedDepartment}</h2>
                <p className="text-slate-400 text-sm mt-1">Choose a semester to view subject folders and lectures.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
                {semesterFolders.map(folder => (
                  <motion.button
                    key={folder.semester}
                    onClick={() => selectSemester(folder.semester)}
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
          <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
            {visibleFolders.map(folder => {
              const isSelected = folder.subject._id === selectedSubject;
              const openCount = folder.lectures.filter(lecture => lecture.attendanceOpen).length;
              return (
                <motion.button
                  key={folder.subject._id}
                  onClick={() => handleSubjectSelect(folder.subject._id)}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className={`glass-card text-left border transition-all hover:border-primary-500/40 ${isSelected ? 'border-primary-500/50 bg-primary-500/10' : 'border-transparent'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${isSelected ? 'bg-primary-500/20 text-primary-300' : 'bg-white/5 text-slate-400'}`}>
                      {isSelected ? <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" /> : <Folder className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate text-sm sm:text-base">{folder.subject.name}</p>
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
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <motion.button
                  type="button"
                  onClick={() => openFolderLectureForm(selectedFolder)}
                  className="btn-primary inline-flex items-center gap-2 justify-center"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Plus className="w-4 h-4" /> New Lecture
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => handleSubjectDownload(selectedFolder)}
                  disabled={isSubjectDownloadActive(selectedFolder)}
                  className={`btn-secondary inline-flex items-center gap-2 justify-center ${isSubjectDownloadActive(selectedFolder) ? 'action-pulse' : ''}`}
                  whileHover={{ scale: isSubjectDownloadActive(selectedFolder) ? 1 : 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Download className="w-4 h-4" /> {isSubjectDownloadActive(selectedFolder) ? 'Downloading...' : 'Download Attendance'}
                </motion.button>
                <motion.button
                  type="button"
                  onClick={closeSelectedFolder}
                  className="btn-secondary inline-flex items-center gap-2 justify-center"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </motion.button>
              </div>
            </div>
          )}

          {selectedFolder && visibleLectures.map((lec, i) => (
            <motion.div key={lec._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="glass-card hover:border-white/10 border border-transparent transition-all">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className={`h-2 w-full sm:w-2 sm:h-14 rounded-full flex-shrink-0 ${lec.attendanceOpen ? 'bg-emerald-500' : lec.status === 'completed' ? 'bg-primary-500' : 'bg-slate-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white">{lec.title}</h3>
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
                    {new Date(lec.date).toLocaleDateString()} · {lec.startTime} – {lec.endTime} ({lec.duration} min)
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                  {!lec.attendanceOpen && lec.status !== 'completed' && (
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
          {selectedFolder && visibleLectures.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No lectures in this subject folder yet.</p>
            </div>
          )}
          {!selectedFolder && folders.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{isSuperAdmin && !selectedDepartment ? 'No department folders found.' : 'No subject folders found.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
