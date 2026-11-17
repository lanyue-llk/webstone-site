"use client";

import { useEffect, useState } from "react";
import { initialLanguage, LANGUAGE_KEY, type Language } from "./i18n";

export function useLanguage() {
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    try { setLanguage(initialLanguage(localStorage.getItem(LANGUAGE_KEY))); } catch { /* English is the default. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  function chooseLanguage(next: Language) {
    setLanguage(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Switching still works without storage. */ }
  }
  return [language, chooseLanguage] as const;
}
