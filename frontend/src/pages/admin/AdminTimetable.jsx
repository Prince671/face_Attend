import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, FileSpreadsheet, Image, RefreshCw, UploadCloud, Wand2, Plus, Trash2, X } from 'lucide-react';
import { holidayAPI, timetableAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeRefresh } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay, PageSkeleton } from '../../components/LoadingStates';
import { toDateInputValue } from '../../utils/dateInput';

const DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];
const COURSE_BRANCHES = {
  'B. Tech': ['Computer Science', 'Mechanical Engineering', 'Electrical Engineering', 'AI/ML Engineering'],
  Diploma: ['Computer Science', 'Mechanical Engineering', 'Electrical Engineering'],
  BBA: ['BBA'],
  MBA: ['MBA'],
};
const COURSE_DEPARTMENT = {
  'B. Tech:Computer Science': 'Computer Science',
  'B. Tech:AI/ML Engineering': 'Computer Science',
  'B. Tech:Mechanical Engineering': 'Mechanical',
  'B. Tech:Electrical Engineering': 'Electrical',
  'Diploma:Computer Science': 'Computer Science',
  'Diploma:Mechanical Engineering': 'Mechanical',
  'Diploma:Electrical Engineering': 'Electrical',
  'BBA:BBA': 'BBA',
  'MBA:MBA': 'MBA',
};
const toDateInput = (date) => toDateInputValue(date);
const semesterLimitForCourse = (course) => {
  if (course === 'MBA') return 4;
  if (course === 'Diploma' || course === 'BBA') return 6;
  return 8;
};

function CheckboxSelect({ label, placeholder, options, values, onToggle, disabled = false }) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options.filter(option => values.includes(option.value)).map(option => option.label);

  return (
    <div className="relative">
      <label className="label">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(previous => !previous)}
        className="input-field flex min-h-[46px] items-center justify-between gap-3 text-left transition-all duration-200 hover:border-primary-400/60 hover:bg-white/[0.07] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`truncate ${selectedLabels.length ? 'text-white' : 'text-slate-400'}`}>
          {selectedLabels.length ? `${selectedLabels.length} selected` : placeholder}
        </span>
        <span className={`text-primary-300 transition-transform duration-200 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      {open && (
        <div className="relative z-10 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl animate-fade-in">
          <div className="max-h-64 overflow-y-auto p-2">
            {options.map(option => {
              const checked = values.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 hover:bg-primary-500/10 hover:text-white active:scale-[0.98] ${checked ? 'bg-primary-500/15 text-primary-100' : 'text-slate-300'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(option.value)}
                    className="h-4 w-4 rounded border-white/20 bg-slate-900 text-primary-500 focus:ring-primary-500"
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </label>
              );
            })}
            {options.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No options available</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const currentWeekRange = () => {
  const start = new Date();
  const diffToMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 5);
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
};

export default function AdminTimetable() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');
  const isDepartmentAdmin = user?.department && !isSuperAdmin;
  const [timetables, setTimetables] = useState([]);
  const [department, setDepartment] = useState(isDepartmentAdmin ? user.department : 'Computer Science');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(currentWeekRange);
  const [holidays, setHolidays] = useState([]);
  const [holidayForm, setHolidayForm] = useState({
    scopes: [],
    courses: [],
    branches: [],
    semesters: [],
    title: '',
    date: toDateInput(new Date()),
    endDate: toDateInput(new Date()),
    startTime: '09:30',
    endTime: '10:30',
    type: 'holiday',
    notes: ''
  });

  const current = timetables.find(t => t.department === department);
  const slotCount = useMemo(() => {
    const scopedSlots = current?.slots || [];
    if (isDepartmentAdmin && user?.adminSemesterScope) {
      return scopedSlots.filter(slot => Number(slot.semester) === Number(user.adminSemesterScope)).length;
    }
    return scopedSlots.length;
  }, [current, isDepartmentAdmin, user?.adminSemesterScope]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const timetableRes = await timetableAPI.getAll();
      const holidayRes = await holidayAPI.getAll();
      setTimetables(timetableRes.data.timetables || []);
      setHolidays(holidayRes.data.holidays || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData().catch(() => toast.error('Failed to load timetable data'));
    window.addEventListener('admin-scope:changed', fetchData);
    return () => window.removeEventListener('admin-scope:changed', fetchData);
  }, []);

  useRealtimeRefresh(() => fetchData().catch(() => {}), ['timetable', 'holiday', 'lectures']);

  useEffect(() => {
    const next = timetables.find(t => t.department === department);
    setTitle(next?.title || `${department} Timetable`);
    setFile(null);
  }, [department, timetables]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('app:busy', {
      detail: {
        active: saving,
        label: saving ? (savingStage || 'Analyzing timetable and generating lectures...') : ''
      }
    }));
  }, [saving, savingStage]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('app:busy', { detail: { active: false, label: '' } }));
    };
  }, []);

  const uploadAndGenerate = async (event) => {
    event.preventDefault();
    if (!file) {
      toast.error('Choose a timetable image, Excel, or CSV file');
      return;
    }

    setSaving(true);
    setSavingStage('Analyzing timetable and preparing subjects...');
    try {
      const formData = new FormData();
      formData.append('department', department);
      formData.append('title', title || `${department} Timetable`);
      formData.append('startDate', range.startDate);
      formData.append('endDate', range.endDate);
      formData.append('timetableFile', file);
      if (!file.type.startsWith('image/')) formData.append('clearImage', 'true');

      const res = await timetableAPI.save(formData);
      setSavingStage('Refreshing generated lectures...');
      const generated = res.data.generated || {};
      const analyzed = res.data.totalSlots ?? res.data.timetable?.slots?.length ?? 0;
      if ((generated.created || 0) > 0) {
        toast.success(`Analyzed ${analyzed} slots and generated ${generated.created} lectures${generated.failed ? ` (${generated.failed} skipped)` : ''}`);
      } else {
        toast(`Analyzed ${analyzed} slots. No new lectures were created for this date range${generated.failed ? `; ${generated.failed} slots were invalid.` : '.'}`);
      }
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to analyze timetable');
    } finally {
      setSaving(false);
      setSavingStage('');
    }
  };

  const regenerateLectures = async () => {
    if (!current?._id) {
      toast.error('Upload and analyze a timetable first');
      return;
    }
    setGenerating(true);
    try {
      const res = await timetableAPI.generateLectures(current._id, { ...range, replaceWeek: true });
      toast.success(`Generated ${res.data.created} lectures. Skipped ${res.data.skipped || 0} duplicates${res.data.failed ? `; ${res.data.failed} invalid slots` : ''}.`);
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not generate lectures');
    } finally {
      setGenerating(false);
    }
  };

  const addHoliday = async (event) => {
    event.preventDefault();
    try {
      if (!holidayForm.scopes.length) {
        toast.error('Add at least one course, branch, and semester audience');
        return;
      }
      const res = await holidayAPI.create({
        ...holidayForm,
        appliesToAll: false,
        endDate: ['event', 'exam'].includes(holidayForm.type) ? holidayForm.endDate : holidayForm.date,
        startTime: ['event', 'other'].includes(holidayForm.type) ? holidayForm.startTime : '',
        endTime: ['event', 'other'].includes(holidayForm.type) ? holidayForm.endTime : ''
      });
      const notified = res.data.notified || {};
      const cancelled = Number(res.data?.cancellation?.cancelled || 0);
      toast.success(
        `Saved and notified ${notified.students || 0} students and ${notified.teachers || 0} teachers${cancelled ? `. ${cancelled} lecture${cancelled === 1 ? '' : 's'} cancelled` : ''}`
      );
      setHolidayForm({
        scopes: [],
        courses: [],
        branches: [],
        semesters: [],
        title: '',
        date: toDateInput(new Date()),
        endDate: toDateInput(new Date()),
        startTime: '09:30',
        endTime: '10:30',
        type: 'holiday',
        notes: ''
      });
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not save holiday/event');
    }
  };

  const updateHolidayForm = (updates) => setHolidayForm(previous => {
    const next = { ...previous, ...updates };
    if (Object.prototype.hasOwnProperty.call(updates, 'date') && (!next.endDate || next.endDate < updates.date)) {
      next.endDate = updates.date;
    }
    return next;
  });

  const filteredCourseBranches = useMemo(() => {
    if (!isDepartmentAdmin) return COURSE_BRANCHES;
    return Object.entries(COURSE_BRANCHES).reduce((acc, [courseName, branches]) => {
      const scopedBranches = branches.filter(branchName => COURSE_DEPARTMENT[`${courseName}:${branchName}`] === user.department);
      if (scopedBranches.length) acc[courseName] = scopedBranches;
      return acc;
    }, {});
  }, [isDepartmentAdmin, user?.department]);

  const courseOptions = useMemo(() => Object.keys(filteredCourseBranches).map(course => ({ value: course, label: course })), [filteredCourseBranches]);
  const branchOptions = useMemo(() => holidayForm.courses.flatMap(course =>
    (filteredCourseBranches[course] || []).map(branch => ({
      value: `${course}:${branch}`,
      label: `${course} / ${branch}`,
      course,
      branch
    }))
  ), [filteredCourseBranches, holidayForm.courses]);
  const semesterOptions = useMemo(() => {
    const maxSemester = holidayForm.courses.reduce((max, course) => Math.max(max, semesterLimitForCourse(course)), 0);
    return Array.from({ length: maxSemester }, (_, index) => ({ value: index + 1, label: `Semester ${index + 1}` }));
  }, [holidayForm.courses]);
  const audienceScopes = useMemo(() => {
    return holidayForm.branches.flatMap(branchValue => {
      const [course, branch] = branchValue.split(':');
      const departmentForScope = COURSE_DEPARTMENT[branchValue] || department;
      const limit = semesterLimitForCourse(course);
      return holidayForm.semesters
        .filter(semester => Number(semester) <= limit)
        .map(semester => ({
          course,
          branch,
          semester: Number(semester),
          department: departmentForScope
        }));
    });
  }, [department, holidayForm.branches, holidayForm.semesters]);

  useEffect(() => {
    setHolidayForm(previous => {
      const current = JSON.stringify(previous.scopes);
      const next = JSON.stringify(audienceScopes);
      return current === next ? previous : { ...previous, scopes: audienceScopes };
    });
  }, [audienceScopes]);

  const toggleHolidayCourse = (course) => {
    setHolidayForm(previous => {
      const courses = previous.courses.includes(course)
        ? previous.courses.filter(item => item !== course)
        : [...previous.courses, course];
      const allowedBranchValues = new Set(courses.flatMap(item => (filteredCourseBranches[item] || []).map(branch => `${item}:${branch}`)));
      const branches = previous.branches.filter(branch => allowedBranchValues.has(branch));
      const maxSemester = courses.reduce((max, item) => Math.max(max, semesterLimitForCourse(item)), 0);
      const semesters = previous.semesters.filter(semester => Number(semester) <= maxSemester);
      return { ...previous, courses, branches, semesters };
    });
  };

  const toggleHolidayBranch = (branchValue) => {
    setHolidayForm(previous => ({
      ...previous,
      branches: previous.branches.includes(branchValue)
        ? previous.branches.filter(item => item !== branchValue)
        : [...previous.branches, branchValue]
    }));
  };

  const toggleHolidaySemester = (semester) => {
    setHolidayForm(previous => ({
      ...previous,
      semesters: previous.semesters.includes(semester)
        ? previous.semesters.filter(item => item !== semester)
        : [...previous.semesters, semester]
    }));
  };

  const removeHolidayScope = (index) => {
    const scope = holidayForm.scopes[index];
    if (!scope) return;
    const branchValue = `${scope.course}:${scope.branch}`;
    setHolidayForm(previous => {
      const remainingScopes = previous.scopes.filter((_, itemIndex) => itemIndex !== index);
      const branchStillUsed = remainingScopes.some(item => `${item.course}:${item.branch}` === branchValue);
      const semesterStillUsed = remainingScopes.some(item => Number(item.semester) === Number(scope.semester));
      return {
        ...previous,
        branches: branchStillUsed ? previous.branches : previous.branches.filter(item => item !== branchValue),
        semesters: semesterStillUsed ? previous.semesters : previous.semesters.filter(item => Number(item) !== Number(scope.semester))
      };
    });
  };

  const needsDateRange = ['event', 'exam'].includes(holidayForm.type);
  const needsTimeRange = ['event', 'other'].includes(holidayForm.type);

  const removeHoliday = async (id) => {
    try {
      await holidayAPI.delete(id);
      toast.success('Holiday/event removed');
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not remove holiday/event');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-primary-400" /> Timetable
          </h1>
          <p className="text-slate-400 mt-1">Upload a timetable file, analyze it, and schedule the weekly lectures automatically</p>
        </div>
        <button onClick={() => fetchData()} disabled={loading} className="btn-secondary mobile-icon-btn sm:w-auto flex items-center gap-2 disabled:opacity-60" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> <span className="mobile-label">{loading ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      <AdminBreadcrumb items={isSuperAdmin ? [
        { label: 'Departments' },
        { label: department },
        { label: 'Timetable' }
      ] : [{ label: 'Timetable' }]} />

      {loading && timetables.length === 0 ? (
        <PageSkeleton variant="timetable" />
      ) : (
      <div className="relative space-y-6">
      <LoadingOverlay show={loading && timetables.length > 0} label="Refreshing timetable..." />
      <LoadingOverlay show={saving} label={savingStage || 'Analyzing timetable...'} />

      <form onSubmit={uploadAndGenerate} className="glass-card space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="label">Department</label>
            <select className="input-field" value={department} onChange={e => setDepartment(e.target.value)} disabled={isDepartmentAdmin}>
              {DEPARTMENTS.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Timetable Title</label>
            <input className="input-field" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label">Week Start</label>
            <input className="input-field" type="date" value={range.startDate} onChange={e => setRange({ ...range, startDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Week End</label>
            <input className="input-field" type="date" value={range.endDate} onChange={e => setRange({ ...range, endDate: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="label">{current ? 'Change / Reupload Timetable' : 'Upload Timetable'}</label>
            <input
              className="input-field"
              type="file"
              accept="image/*,.xlsx,.csv"
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <button type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-2 min-h-[42px] sm:min-h-[46px]">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {saving ? 'Analyzing & Scheduling...' : 'Analyze & Generate'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <Image className="w-5 h-5 text-primary-300 mb-2" />
            <p className="text-white font-medium">Full timetable image</p>
            <p className="text-slate-400 mt-1">AI reads all visible semester rows for this department in one upload.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <FileSpreadsheet className="w-5 h-5 text-emerald-300 mb-2" />
            <p className="text-white font-medium">Excel or CSV</p>
            <p className="text-slate-400 mt-1">Use columns like day, semester, subject, start time, end time, room, faculty.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <Wand2 className="w-5 h-5 text-amber-300 mb-2" />
            <p className="text-white font-medium">Auto scheduling</p>
            <p className="text-slate-400 mt-1">Subjects and weekly lectures are created for every extracted semester.</p>
          </div>
        </div>
      </form>

      <div className="glass-card space-y-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <CalendarDays className="h-5 w-5 text-amber-300" /> Holiday & Event Calendar
          </h2>
          <p className="mt-1 text-sm text-slate-400">Attendance cannot be started for lectures that fall on a configured holiday/event.</p>
        </div>
        <form onSubmit={addHoliday} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <CheckboxSelect
              label="Courses"
              placeholder="Select courses"
              options={courseOptions}
              values={holidayForm.courses}
              onToggle={toggleHolidayCourse}
            />
            <CheckboxSelect
              label="Branches"
              placeholder={holidayForm.courses.length ? 'Select branches' : 'Select course first'}
              options={branchOptions}
              values={holidayForm.branches}
              onToggle={toggleHolidayBranch}
              disabled={!holidayForm.courses.length}
            />
            <CheckboxSelect
              label="Semesters"
              placeholder={holidayForm.branches.length ? 'Select semesters' : 'Select branch first'}
              options={semesterOptions}
              values={holidayForm.semesters}
              onToggle={toggleHolidaySemester}
              disabled={!holidayForm.branches.length}
            />
          </div>

          {holidayForm.scopes.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-all duration-200">
              {holidayForm.scopes.map((scope, index) => (
                <span key={`${scope.course}-${scope.branch}-${scope.semester}`} className="inline-flex items-center gap-2 rounded-full border border-primary-400/25 bg-primary-500/10 px-3 py-1 text-xs text-primary-100 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-300/70 hover:bg-primary-500/20">
                  {scope.course} / {scope.branch} / Sem {scope.semester}
                  <button type="button" onClick={() => removeHolidayScope(index)} className="text-primary-200 hover:text-red-200" title="Remove audience">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {holidayForm.scopes.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Type</label>
                  <select className="input-field" value={holidayForm.type} onChange={event => updateHolidayForm({ type: event.target.value })}>
                    <option value="holiday">Holiday</option>
                    <option value="event">Event</option>
                    <option value="exam">Exam</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label">Title</label>
                  <input className="input-field" placeholder="Holiday, event, or exam title" value={holidayForm.title} onChange={event => updateHolidayForm({ title: event.target.value })} required />
                </div>
              </div>
              <div className={`grid grid-cols-1 gap-3 ${needsDateRange ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}>
                <div>
                  <label className="label">{needsDateRange ? 'Start Date' : 'Date'}</label>
                  <input className="input-field" type="date" value={holidayForm.date} onChange={event => updateHolidayForm({ date: event.target.value })} required />
                </div>
                {needsDateRange && (
                  <div>
                    <label className="label">End Date</label>
                    <input className="input-field" type="date" min={holidayForm.date} value={holidayForm.endDate} onChange={event => updateHolidayForm({ endDate: event.target.value })} required />
                  </div>
                )}
              </div>
              {needsTimeRange && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="label">Start Time</label>
                    <input className="input-field" type="time" value={holidayForm.startTime} onChange={event => updateHolidayForm({ startTime: event.target.value })} required />
                  </div>
                  <div>
                    <label className="label">End Time</label>
                    <input className="input-field" type="time" value={holidayForm.endTime} onChange={event => updateHolidayForm({ endTime: event.target.value })} required />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                <button className="btn-primary flex items-center justify-center gap-2"><Plus className="h-4 w-4" /> Add & Notify</button>
              </div>
              <textarea className="input-field min-h-20" placeholder="Optional notes or instructions" value={holidayForm.notes} onChange={event => updateHolidayForm({ notes: event.target.value })} />
            </>
          )}
        </form>
        <div className="three-card-grid">
          {holidays.slice(0, 9).map(item => (
            <div key={item._id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(item.date).toLocaleDateString('en-IN')}
                    {item.endDate && new Date(item.endDate).toDateString() !== new Date(item.date).toDateString() ? ` - ${new Date(item.endDate).toLocaleDateString('en-IN')}` : ''}
                    {item.startTime && item.endTime ? `, ${item.startTime}-${item.endTime}` : ''} - {item.type}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{[item.course, item.branch, item.semester && `Sem ${item.semester}`].filter(Boolean).join(' / ')}</p>
                  {Array.isArray(item.scopes) && item.scopes.length > 1 && (
                    <p className="mt-1 text-xs text-primary-200">{item.scopes.length} selected audiences</p>
                  )}
                </div>
                <button type="button" onClick={() => removeHoliday(item._id)} className="text-slate-500 hover:text-red-300" title="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {holidays.length === 0 && <p className="text-sm text-slate-500">No holidays or events configured yet.</p>}
        </div>
      </div>

      {current && (
        <div className="glass-card space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-white">{current.title}</h2>
              <p className="text-sm text-slate-400">
                {current.department}
                {current.generatedFrom && current.generatedThrough ? ` - Generated ${new Date(current.generatedFrom).toLocaleDateString()} - ${new Date(current.generatedThrough).toLocaleDateString()}` : ''}
              </p>
            </div>
            <button onClick={regenerateLectures} disabled={generating} className="btn-success flex items-center justify-center gap-2">
              <Wand2 className="w-4 h-4" /> {generating ? 'Generating...' : 'Regenerate Week'}
            </button>
          </div>

          {current.imageUrl && (
          <div className="rounded-lg overflow-auto border border-white/10 bg-black/30 max-h-[68vh] sm:max-h-[460px]">
              <img src={current.imageUrl} alt="Uploaded timetable" className="w-full min-w-[680px] sm:min-w-[900px] object-contain" />
          </div>
          )}
          {slotCount === 0 && <p className="text-center text-slate-500 py-8">Upload a timetable to generate lectures.</p>}
        </div>
      )}
      </div>
      )}
    </div>
  );
}
