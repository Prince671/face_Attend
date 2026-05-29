import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { apiSlice } from '../services/apiSlice';
import authReducer from '../features/auth/authSlice';
import uiReducer from '../features/ui/uiSlice';
import chatReducer from '../features/chat/chatSlice';
import notificationsReducer from '../features/notifications/notificationsSlice';

export const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,
    auth: authReducer,
    ui: uiReducer,
    chat: chatReducer,
    notifications: notificationsReducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiSlice.middleware)
});

setupListeners(store.dispatch);
