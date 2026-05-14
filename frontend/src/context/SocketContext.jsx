import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext({ socket: null });

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Don't connect until we actually have a user with an _id
    if (!user || !user._id) {
      // If socket exists from a previous session, disconnect it
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      return;
    }

    // Don't re-connect if socket already exists for this user
    if (socketRef.current && socketRef.current.connected) return;

    const s = io('/', {
      withCredentials: true,
      transports: ['polling', 'websocket'],
      upgrade: true,
      timeout: 20000,
      pingTimeout: 30000,
      pingInterval: 25000,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    const joinRoom = () => {
      if (user.role === 'admin') {
        s.emit('join_admin', user.department);
      } else {
        s.emit('join_student', user._id);
      }
    };

    s.on('connect', () => {
      joinRoom();
    });

    // Re-join on every reconnect (network drop recovery)
    s.on('reconnect', () => {
      joinRoom();
    });

    // If already connected (e.g. hot-reload), join immediately
    if (s.connected) joinRoom();

    socketRef.current = s;
    setSocket(s);

    return () => {
      s.off('connect');
      s.off('reconnect');
      if (s.connected) s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [user?._id, user?.role]); // Re-run only when user id/role changes

  return (
    <SocketContext.Provider value={{ socket }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
