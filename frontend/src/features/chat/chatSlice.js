import { createSlice } from '@reduxjs/toolkit';

const chatSlice = createSlice({
  name: 'chat',
  initialState: {
    activeGroupId: '',
    selectedMessageIds: [],
    typingByGroup: {},
    uploadQueue: {}
  },
  reducers: {
    setActiveGroupId: (state, action) => {
      state.activeGroupId = action.payload || '';
      state.selectedMessageIds = [];
    },
    setSelectedMessageIds: (state, action) => {
      state.selectedMessageIds = action.payload || [];
    },
    setTypingState: (state, action) => {
      const { groupId, userId, mode, typing } = action.payload || {};
      if (!groupId || !userId) return;
      state.typingByGroup[groupId] = state.typingByGroup[groupId] || {};
      if (typing) state.typingByGroup[groupId][userId] = mode || 'typing';
      else delete state.typingByGroup[groupId][userId];
    },
    setUploadProgress: (state, action) => {
      const { id, progress, status, error } = action.payload || {};
      if (!id) return;
      state.uploadQueue[id] = { progress, status, error };
    },
    clearUpload: (state, action) => {
      delete state.uploadQueue[action.payload];
    }
  }
});

export const { setActiveGroupId, setSelectedMessageIds, setTypingState, setUploadProgress, clearUpload } = chatSlice.actions;
export default chatSlice.reducer;
