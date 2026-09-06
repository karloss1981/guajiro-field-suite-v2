import React from 'react';
import { C } from '../config/theme';

interface StatProps {
  label: string;
  value: React.ReactNode;
  color?: string;
  emoji?: string;
  sub?: string;
}

export function Stat({ label, value, color = C.accent, emoji, sub }: StatProps) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        flex: 1,
        minWidth: 90,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span
          style={{
            fontFamily: "'Barlow Condensed',sans-serif",
            fontSize: 28,
            fontWeight: 900,
            color,
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {emoji && <span style={{ fontSize: 18 }}>{emoji}</span>}
      </div>
      <div style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: 1.5 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
