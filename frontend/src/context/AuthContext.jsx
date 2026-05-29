import React, { createContext, useContext, useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { authAPI } from '../services/api';
import { clearCredentials, setCredentials, setCurrentUser } from '../features/auth/authSlice';
import { apiSlice } from '../services/apiSlice';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const dispatch = useDispatch();
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      authAPI.getMe()
        .then(res => {
          setUser(res.data.user);
          dispatch(setCurrentUser(res.data.user));
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
          dispatch(clearCredentials());
          dispatch(apiSlice.util.resetApiState());
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    dispatch(setCredentials({ token, user: userData }));
  };

  const updateUser = (userData) => {
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    dispatch(setCurrentUser(userData));
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('adminScopeSelected');
    setUser(null);
    dispatch(clearCredentials());
    dispatch(apiSlice.util.resetApiState());
  };

  return (
    <AuthContext.Provider value={{ user, setUser, updateUser, login, logout, loading, isAdmin: user?.role === 'admin', isTeacher: user?.role === 'teacher', isStaff: ['admin', 'teacher'].includes(user?.role), isStudent: user?.role === 'student' }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
