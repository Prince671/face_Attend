import { createSlice } from '@reduxjs/toolkit';

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    sidebarOpen: true,
    routeLoading: false,
    appBusy: false,
    appBusyLabel: '',
    theme: localStorage.getItem('theme') || 'dark'
  },
  reducers: {
    setSidebarOpen: (state, action) => {
      state.sidebarOpen = Boolean(action.payload);
    },
    setRouteLoading: (state, action) => {
      state.routeLoading = Boolean(action.payload);
    },
    setAppBusy: (state, action) => {
      state.appBusy = Boolean(action.payload?.busy);
      state.appBusyLabel = action.payload?.label || '';
    },
    setTheme: (state, action) => {
      state.theme = action.payload || 'dark';
    }
  }
});

export const { setSidebarOpen, setRouteLoading, setAppBusy, setTheme } = uiSlice.actions;
export default uiSlice.reducer;
