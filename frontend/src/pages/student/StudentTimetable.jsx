import React, { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import { timetableAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';

export default function StudentTimetable() {
  const { user } = useAuth();
  const [timetable, setTimetable] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    timetableAPI.getMine()
      .then(res => setTimetable(res.data.timetable))
      .catch(() => toast.error('Failed to load timetable'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader label="Loading timetable..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-primary-400" /> My Timetable
        </h1>
        <p className="text-slate-400 mt-1">
          {timetable?.department || 'Department'} lecture schedule
          {timetable?.generatedFrom && timetable?.generatedThrough
            ? ` for ${new Date(timetable.generatedFrom).toLocaleDateString()} - ${new Date(timetable.generatedThrough).toLocaleDateString()}`
            : ''}
        </p>
      </div>

      <AdminBreadcrumb items={[
        { label: user?.department || timetable?.department || 'Department' },
        user?.semester && { label: `Semester ${user.semester}` },
        { label: 'Timetable' }
      ]} />

      {!timetable ? (
        <div className="glass-card text-center py-12 text-slate-400">No timetable uploaded for your department yet.</div>
      ) : (
        <>
          {timetable.imageUrl && (
            <div className="glass-card overflow-auto">
              <img src={timetable.imageUrl} alt="Department timetable" className="w-full min-w-[680px] sm:min-w-[900px] object-contain rounded-lg" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
