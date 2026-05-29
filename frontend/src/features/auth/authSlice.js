import { createSlice } from '@reduxjs/toolkit';

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
};

const initialState = {
  user: readStoredUser(),
  token: localStorage.getItem('token') || ''
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action) => {
      state.token = action.payload?.token || state.token;
      state.user = action.payload?.user || null;
    },
    setCurrentUser: (state, action) => {
      state.user = action.payload || null;
    },
    clearCredentials: (state) => {
      state.token = '';
      state.user = null;
    }
  }
});

export const { setCredentials, setCurrentUser, clearCredentials } = authSlice.actions;
export default authSlice.reducer;
