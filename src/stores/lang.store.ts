import React, { createContext, useContext, useState } from 'react';
import type { Lang } from '../types/common';
import { getT } from '../i18n/translations';
import type { Translations } from '../i18n/translations';

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const stored = localStorage.getItem('gfs_lang');
    return (stored === 'en' || stored === 'es') ? stored : 'es';
  });

  const handleSetLang = (l: Lang) => {
    setLang(l);
    localStorage.setItem('gfs_lang', l);
  };

  const t = getT(lang);

  return React.createElement(LangContext.Provider, { value: { lang, setLang: handleSetLang, t } }, children);
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within LangProvider');
  return ctx;
}
