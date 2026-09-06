import React from 'react';
import type { Lang } from '../types/common';

interface LangToggleProps {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export function LangToggle({ lang, setLang }: LangToggleProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 3,
        background: '#0e1e3a',
        borderRadius: 20,
        padding: 3,
        border: '1px solid #162e58',
      }}
    >
      {(['es', 'en'] as const).map((l, i) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          style={{
            background: lang === l ? '#00b8f5' : 'none',
            border: 'none',
            borderRadius: 16,
            padding: '3px 9px',
            cursor: 'pointer',
            fontSize: 17,
            lineHeight: 1,
            opacity: lang === l ? 1 : 0.4,
            transition: 'all .2s',
          }}
        >
          {i === 0 ? '🇪🇸' : '🇺🇸'}
        </button>
      ))}
    </div>
  );
}
