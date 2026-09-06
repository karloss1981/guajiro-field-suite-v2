import React from 'react';
import { C } from '../config/theme';
import type { Translations } from '../i18n/translations';

interface ReportLangModalProps {
  t: Translations;
  onSelect: (lang: string) => void;
  onClose: () => void;
}

export function ReportLangModal({ t, onSelect, onClose }: ReportLangModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000c',
        zIndex: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          background: '#0b1830',
          borderRadius: 20,
          padding: '28px 24px',
          width: '100%',
          maxWidth: 340,
          border: '1px solid #162e58',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: "'Barlow Condensed',sans-serif",
            fontSize: 22,
            fontWeight: 900,
            color: C.text,
            marginBottom: 6,
          }}
        >
          {t.reportLangTitle}
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, marginTop: 16 }}>
          {(['es', 'en'] as const).map((l, i) => (
            <button
              key={l}
              onClick={() => onSelect(l)}
              style={{
                flex: 1,
                background: 'linear-gradient(135deg,#0e1e3a,#0b2d5a)',
                border: '2px solid #00b8f5',
                borderRadius: 14,
                padding: '18px 10px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 36 }}>{i === 0 ? '🇪🇸' : '🇺🇸'}</div>
              <div
                style={{
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontSize: 16,
                  fontWeight: 800,
                  color: C.text,
                  marginTop: 6,
                }}
              >
                {i === 0 ? 'Español' : 'English'}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid #162e58',
            borderRadius: 10,
            padding: '10px 24px',
            color: C.dim,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {t.cancelLang}
        </button>
      </div>
    </div>
  );
}
