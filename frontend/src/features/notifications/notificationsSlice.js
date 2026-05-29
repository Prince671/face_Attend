import { createSlice } from '@reduxjs/toolkit';

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState: {
    unreadCount: 0
  },
  reducers: {
    setUnreadCount: (state, action) => {
      state.unreadCount = Number(action.payload || 0);
    }
  }
});

export const { setUnreadCount } = notificationsSlice.actions;
export default notificationsSlice.reducer;
