import React from 'react';
import { useToast } from '../stores/toast.store';

function ToastItem({ id, msg }: { id: string; msg: string }) {
  const { removeToast } = useToast();
  return (
    <div
      onClick={() => removeToast(id)}
      style={{
        background: '#00dc85',
        color: '#04091c',
        padding: '12px 24px',
        borderRadius: 12,
        fontWeight: 700,
        fontSize: 14,
        boxShadow: '0 4px 24px #00dc8560',
        fontFamily: "'Barlow',sans-serif",
        whiteSpace: 'nowrap',
        maxWidth: '90vw',
        cursor: 'pointer',
      }}
    >
      {msg}
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {toasts.map(t => (
        <ToastItem key={t.id} id={t.id} msg={t.msg} />
      ))}
    </div>
  );
}
