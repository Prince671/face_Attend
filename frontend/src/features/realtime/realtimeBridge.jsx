import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { apiSlice } from '../../services/apiSlice';
import { useSocket } from '../../context/SocketContext';

const eventTagMap = {
  new_registration: ['AdminDashboard', 'Dashboard', 'Notifications'],
  student_profile_changed: ['Profile', 'Subjects', 'Dashboard', 'StudentDashboard', 'AdminDashboard', 'Attendance'],
  student_profile_update_requested: ['AdminDashboard', 'Dashboard', 'Notifications'],
  profile_update_resolved: ['Profile', 'Notifications'],
  account_status_changed: ['Profile', 'Dashboard', 'StudentDashboard'],
  teacher_changed: ['Subjects', 'AdminDashboard', 'Dashboard'],
  academic_structure_changed: ['Subjects', 'AdminDashboard'],
  subject_updated: ['Subjects', 'Lectures', 'Attendance', 'Dashboard', 'StudentDashboard', 'AdminDashboard', 'Classroom'],
  new_lecture: ['Lectures', 'Timetable', 'Dashboard', 'StudentDashboard', 'Notifications'],
  lecture_updated: ['Lectures', 'Timetable', 'Dashboard', 'StudentDashboard', 'AdminDashboard'],
  lectures_changed: ['Lectures', 'Timetable', 'Dashboard', 'StudentDashboard', 'AdminDashboard', 'Attendance'],
  attendance_opened: ['Attendance', 'Lectures', 'Dashboard', 'StudentDashboard', 'Notifications'],
  attendance_closed: ['Attendance', 'Lectures', 'Dashboard', 'StudentDashboard', 'AdminDashboard', 'Notifications'],
  attendance_updated: ['Attendance', 'Dashboard', 'StudentDashboard', 'AdminDashboard'],
  attendance_marked: ['Attendance', 'Dashboard', 'StudentDashboard', 'AdminDashboard'],
  timetable_changed: ['Timetable', 'Lectures', 'Dashboard', 'StudentDashboard'],
  holiday_changed: ['Timetable', 'Lectures', 'Notifications'],
  lms_changed: ['Lms', 'Classroom', 'Dashboard', 'StudentDashboard', 'AdminDashboard'],
  notification_created: ['Notifications'],
  chat_group_created: ['ChatGroups'],
  chat_group_updated: ['ChatGroups', 'ChatGallery'],
  chat_group_deleted: ['ChatGroups', 'ChatMessages', 'ChatGallery'],
  chat_member_added: ['ChatGroups'],
  chat_member_removed: ['ChatGroups'],
  chat_member_left: ['ChatGroups'],
  chat_activity_created: ['ChatGroups']
};

export default function RealtimeBridge() {
  const { socket } = useSocket();
  const dispatch = useDispatch();

  useEffect(() => {
    if (!socket) return undefined;
    const handlers = {};
    const invalidate = (eventName) => {
      const tags = eventTagMap[eventName];
      if (tags?.length) dispatch(apiSlice.util.invalidateTags(tags));
    };
    Object.keys(eventTagMap).forEach(eventName => {
      handlers[eventName] = () => invalidate(eventName);
      socket.on(eventName, handlers[eventName]);
    });
    return () => {
      Object.keys(handlers).forEach(eventName => socket.off(eventName, handlers[eventName]));
    };
  }, [dispatch, socket]);

  return null;
}
