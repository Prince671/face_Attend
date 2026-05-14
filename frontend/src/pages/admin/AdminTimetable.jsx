import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, FileSpreadsheet, Image, RefreshCw, UploadCloud, Wand2 } from 'lucide-react';
import { timetableAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay, PageLoader } from '../../components/LoadingStates';

const DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];
const toDateInput = (date) => date.toISOString().slice(0, 10);

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
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(currentWeekRange);

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
      setTimetables(timetableRes.data.timetables || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData().catch(() => toast.error('Failed to load timetable data'));
    window.addEventListener('admin-scope:changed', fetchData);
    return () => window.removeEventListener('admin-scope:changed', fetchData);
  }, []);

  useEffect(() => {
    const next = timetables.find(t => t.department === department);
    setTitle(next?.title || `${department} Timetable`);
    setFile(null);
  }, [department, timetables]);

  const uploadAndGenerate = async (event) => {
    event.preventDefault();
    if (!file) {
      toast.error('Choose a timetable image, Excel, or CSV file');
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('department', department);
      formData.append('title', title || `${department} Timetable`);
      formData.append('startDate', range.startDate);
      formData.append('endDate', range.endDate);
      formData.append('timetableFile', file);
      if (!file.type.startsWith('image/')) formData.append('clearImage', 'true');

      const res = await timetableAPI.save(formData);
      const generated = res.data.generated || {};
      toast.success(`Analyzed ${res.data.timetable?.slots?.length || 0} slots and generated ${generated.created || 0} lectures`);
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to analyze timetable');
    } finally {
      setSaving(false);
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
      toast.success(`Generated ${res.data.created} lectures. Skipped ${res.data.skipped} duplicates.`);
      await fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not generate lectures');
    } finally {
      setGenerating(false);
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
        <PageLoader label="Loading timetable data..." />
      ) : (
      <div className="relative space-y-6">
      <LoadingOverlay show={loading && timetables.length > 0} label="Refreshing timetable..." />

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
              accept="image/*,.xlsx,.xls,.csv"
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <button type="submit" disabled={saving} className="btn-primary flex items-center justify-center gap-2 min-h-[42px] sm:min-h-[46px]">
            <UploadCloud className="w-4 h-4" /> {saving ? 'Analyzing...' : 'Analyze & Generate'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <Image className="w-5 h-5 text-primary-300 mb-2" />
            <p className="text-white font-medium">Image timetable</p>
            <p className="text-slate-400 mt-1">AI reads the uploaded timetable and extracts only this department.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <FileSpreadsheet className="w-5 h-5 text-emerald-300 mb-2" />
            <p className="text-white font-medium">Excel or CSV</p>
            <p className="text-slate-400 mt-1">Use columns like day, semester, subject, start time, end time, room, faculty.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <Wand2 className="w-5 h-5 text-amber-300 mb-2" />
            <p className="text-white font-medium">Auto scheduling</p>
            <p className="text-slate-400 mt-1">Subjects and weekly lectures are created from the analyzed slots.</p>
          </div>
        </div>
      </form>

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
