import { createApi } from '@reduxjs/toolkit/query/react';
import API from './api';

const axiosBaseQuery = () => async ({ url, method = 'GET', data, params, headers, responseType }) => {
  try {
    const result = await API({ url, method, data, params, headers, responseType });
    return { data: result.data };
  } catch (axiosError) {
    return {
      error: {
        status: axiosError.response?.status,
        data: axiosError.response?.data || axiosError.message
      }
    };
  }
};

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: axiosBaseQuery(),
  tagTypes: [
    'Dashboard',
    'StudentDashboard',
    'AdminDashboard',
    'Subjects',
    'Timetable',
    'Lectures',
    'Analytics',
    'Attendance',
    'Lms',
    'Classroom',
    'Notifications',
    'ChatGroups',
    'ChatMessages',
    'ChatGallery',
    'Profile'
  ],
  endpoints: (builder) => ({
    getMe: builder.query({
      query: () => ({ url: '/auth/me' }),
      providesTags: ['Profile']
    }),
    getStudentDashboard: builder.query({
      query: () => ({ url: '/student/dashboard' }),
      providesTags: ['Dashboard', 'StudentDashboard', 'Attendance', 'Lectures']
    }),
    getStudentProgress: builder.query({
      query: () => ({ url: '/lms/student/progress' }),
      providesTags: ['Dashboard', 'StudentDashboard', 'Lms']
    }),
    getMySubjects: builder.query({
      query: () => ({ url: '/subjects/my-subjects' }),
      providesTags: ['Subjects', 'Classroom', 'Attendance']
    }),
    getSubjects: builder.query({
      query: (params) => ({ url: '/subjects', params }),
      providesTags: ['Subjects']
    }),
    getMyTimetable: builder.query({
      query: () => ({ url: '/timetables/my' }),
      providesTags: ['Timetable', 'Lectures']
    }),
    getTimetables: builder.query({
      query: () => ({ url: '/timetables' }),
      providesTags: ['Timetable']
    }),
    getNotifications: builder.query({
      query: () => ({ url: '/notifications' }),
      providesTags: ['Notifications']
    }),
    getUnreadCount: builder.query({
      query: () => ({ url: '/notifications/unread-count' }),
      providesTags: ['Notifications']
    }),
    markNotificationRead: builder.mutation({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'PUT' }),
      invalidatesTags: ['Notifications']
    }),
    markAllNotificationsRead: builder.mutation({
      query: () => ({ url: '/notifications/mark-all-read', method: 'PUT' }),
      invalidatesTags: ['Notifications']
    }),
    deleteNotification: builder.mutation({
      query: (id) => ({ url: `/notifications/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Notifications']
    }),
    deleteAllNotifications: builder.mutation({
      query: () => ({ url: '/notifications/all', method: 'DELETE' }),
      invalidatesTags: ['Notifications']
    }),
    setNotificationAutoDeleteProtection: builder.mutation({
      query: ({ id, preserve }) => ({
        url: `/notifications/${id}/auto-delete-protection`,
        method: 'PUT',
        data: { preserve }
      }),
      invalidatesTags: ['Notifications']
    }),
    getSubjectOverview: builder.query({
      query: (subjectId) => ({ url: `/lms/subjects/${subjectId}/overview` }),
      providesTags: (result, error, subjectId) => [{ type: 'Classroom', id: subjectId }, 'Classroom', 'Lms']
    }),
    getSubjectCalendar: builder.query({
      query: ({ subjectId, ...params }) => ({ url: `/lms/subjects/${subjectId}/calendar`, params }),
      providesTags: (result, error, arg) => [{ type: 'Classroom', id: arg.subjectId }, 'Classroom', 'Lms']
    }),
    getDiscussions: builder.query({
      query: (subjectId) => ({ url: `/lms/subjects/${subjectId}/discussions` }),
      providesTags: (result, error, subjectId) => [{ type: 'Classroom', id: subjectId }, 'Classroom', 'Lms']
    }),
    getChatGroups: builder.query({
      query: () => ({ url: '/chat/groups' }),
      providesTags: ['ChatGroups']
    }),
    getChatMessages: builder.query({
      query: ({ groupId, ...params }) => ({ url: `/chat/groups/${groupId}/messages`, params }),
      providesTags: (result, error, arg) => [{ type: 'ChatMessages', id: arg.groupId }, 'ChatMessages']
    }),
    getChatGallery: builder.query({
      query: (groupId) => ({ url: `/chat/groups/${groupId}/gallery` }),
      providesTags: (result, error, groupId) => [{ type: 'ChatGallery', id: groupId }, 'ChatGallery']
    }),
    getAdminAnalytics: builder.query({
      query: (params) => ({ url: '/admin/analytics', params }),
      providesTags: ['Dashboard', 'AdminDashboard', 'Analytics', 'Attendance']
    }),
    getTeacherDashboard: builder.query({
      query: () => ({ url: '/admin/teacher-dashboard' }),
      providesTags: ['Dashboard', 'AdminDashboard', 'Attendance', 'Lms']
    }),
    getSuperOverview: builder.query({
      query: (params) => ({ url: '/admin/super-overview', params }),
      providesTags: ['Dashboard', 'AdminDashboard']
    })
  })
});

export const {
  useGetMeQuery,
  useGetStudentDashboardQuery,
  useGetStudentProgressQuery,
  useGetMySubjectsQuery,
  useGetSubjectsQuery,
  useGetMyTimetableQuery,
  useGetTimetablesQuery,
  useGetNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useDeleteNotificationMutation,
  useDeleteAllNotificationsMutation,
  useSetNotificationAutoDeleteProtectionMutation,
  useGetSubjectOverviewQuery,
  useGetSubjectCalendarQuery,
  useGetDiscussionsQuery,
  useGetChatGroupsQuery,
  useGetChatMessagesQuery,
  useGetChatGalleryQuery,
  useGetAdminAnalyticsQuery,
  useGetTeacherDashboardQuery,
  useGetSuperOverviewQuery
} = apiSlice;
