import React, { useEffect } from 'react';
import { CalendarDays, Clock, FileSpreadsheet, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGetMyTimetableQuery } from '../../services/apiSlice';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton } from '../../components/LoadingStates';
import { getAcademicLabel, getSemesterLabel } from '../../utils/academicLabels';

const DAY_ORDER = ['MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT', 'SUN'];
const dayLabel = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THUR: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday'
};

const sortSlots = (slots = []) => [...slots].sort((a, b) => {
  const dayDiff = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
  if (dayDiff !== 0) return dayDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

const buildPreview = (slots = []) => {
  const byDay = DAY_ORDER.map(day => ({
    day,
    slots: slots.filter(slot => slot.day === day)
  })).filter(group => group.slots.length);

  return { byDay };
};

const TimetableSlotCard = ({ slot }) => (
  <div className="min-w-[148px] max-w-[180px] rounded-xl border border-white/10 bg-slate-950/35 p-3 shadow-soft transition hover:border-primary-400/40 hover:bg-primary-500/10 sm:min-w-[172px]">
    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {slot.startTime} - {slot.endTime}</span>
      {slot.isLab && <span className="badge-info px-1.5 py-0.5 text-[9px]">{slot.labNumber || 'LAB'}</span>}
    </div>
    <p className="mt-2 line-clamp-2 text-sm font-semibold text-white">{slot.subject?.name || slot.title}</p>
    <p className="mt-0.5 truncate text-[11px] text-primary-300">{slot.subject?.code || slot.title}</p>
    {slot.room && (
      <p className="mt-2 flex items-center gap-1 truncate text-[11px] text-slate-400">
        <MapPin className="w-3 h-3 shrink-0" /> {slot.room}
      </p>
    )}
  </div>
);

export default function StudentTimetable() {
  const { user } = useAuth();
  const { data, isLoading: loading, error } = useGetMyTimetableQuery(undefined, { refetchOnReconnect: true });
  const timetable = data?.timetable || null;

  useEffect(() => {
    if (error) toast.error('Failed to load timetable');
  }, [error]);

  if (loading) return <PageSkeleton variant="timetable" />;
  const academicLabel = getAcademicLabel(user);
  const slots = sortSlots(timetable?.slots || []);
  const preview = buildPreview(slots);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-primary-400" /> My Timetable
        </h1>
        <p className="text-slate-400 mt-1">
          {academicLabel} lecture schedule
          {timetable?.generatedFrom && timetable?.generatedThrough
            ? ` for ${new Date(timetable.generatedFrom).toLocaleDateString()} - ${new Date(timetable.generatedThrough).toLocaleDateString()}`
            : ''}
        </p>
      </div>

      <AdminBreadcrumb items={[
        { label: academicLabel },
        user?.semester && { label: getSemesterLabel(user.semester) },
        { label: 'Timetable' }
      ]} />

      {!timetable ? (
        <div className="glass-card text-center py-12 text-slate-400">No timetable uploaded for your department yet.</div>
      ) : (
        <div className="space-y-4">
          <div className="glass-card compact-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-white font-semibold">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-300" />
                  {timetable.title || 'Department Timetable'}
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Uploaded by department admin{timetable.originalFileName ? ` - ${timetable.originalFileName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="badge-info">Filtered preview</span>
                {user?.semester && <span className="badge-neutral">Semester {user.semester}</span>}
                {user?.branch && <span className="badge-neutral">{user.branch}</span>}
                <span className="badge-neutral">{slots.length} slots</span>
              </div>
            </div>
          </div>

          {slots.length > 0 ? (
            <div className="glass-card overflow-hidden p-3 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-white font-semibold">Read-only timetable preview</h2>
                  <p className="text-sm text-slate-400">Only your semester and branch are shown. The full admin upload is hidden from students.</p>
                </div>
                <FileSpreadsheet className="w-5 h-5 text-primary-300" />
              </div>

              <div className="space-y-3">
                {preview.byDay.map(group => (
                  <div key={group.day} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 sm:grid sm:grid-cols-[120px_1fr] sm:items-start sm:gap-4">
                    <div className="mb-3 flex items-center justify-between sm:mb-0 sm:block">
                      <p className="text-sm font-semibold text-white">{dayLabel[group.day] || group.day}</p>
                      <p className="text-xs text-slate-500">{group.slots.length} lecture{group.slots.length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
                      <div className="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap">
                        {group.slots.map(slot => (
                          <TimetableSlotCard key={slot._id || `${slot.day}-${slot.startTime}-${slot.title}`} slot={slot} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="glass-card text-center py-10 text-slate-400">No timetable slots are available for your semester yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
