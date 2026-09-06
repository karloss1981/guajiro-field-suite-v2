import React, { createContext, useContext, useState, useCallback } from 'react';

interface ToastItem {
  id: string;
  msg: string;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (msg: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((msg: string) => {
    const id = String(Date.now());
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return React.createElement(ToastContext.Provider, { value: { toasts, showToast, removeToast } }, children);
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
