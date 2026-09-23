import { useEffect, useState } from 'react';
import { authService } from '../services/authService';
import { appDataService, type Preferences } from '../services/appDataService';
import { persistAppLanguage, type AppLanguage } from '../lib/appLanguage';
import './UserPreferencesRuntime.css';

export const PREFERENCES_CACHE_KEY = 'mboteroom-preferences-cache';
export const PREFERENCES_EVENT = 'mboteroom-preferences-changed';

export const readCachedPreferences = (): Preferences => {
  try {
    const raw = localStorage.getItem(PREFERENCES_CACHE_KEY);
    return raw ? JSON.parse(raw) as Preferences : {};
  } catch {
    return {};
  }
};

export const writeCachedPreferences = (preferences: Preferences) => {
  try { localStorage.setItem(PREFERENCES_CACHE_KEY, JSON.stringify(preferences)); } catch { /* ignored */ }
};

const resolveTheme = (theme: string | undefined) => {
  if (theme === 'dark' || theme === 'light') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyPreferences = (preferences: Preferences) => {
  writeCachedPreferences(preferences);
  const root = document.documentElement;
  root.dataset.mboteTheme = resolveTheme(preferences.theme);
  root.dataset.mboteTextSize = preferences.textSize || 'normal';
  root.dataset.mboteAccessibility = (preferences.accessibility as { enabled?: boolean } | undefined)?.enabled ? 'on' : 'off';
  root.dataset.mboteChatBackground = preferences.chatBackground || 'default';
  root.dataset.mboteDataSaver = preferences.dataSaver ? 'on' : 'off';
  root.style.setProperty('--mbote-user-font-scale', preferences.textSize === 'large' ? '1.12' : preferences.textSize === 'small' ? '.92' : '1');
  if (preferences.language && ['fr','en','ln','ar'].includes(preferences.language)) {
    persistAppLanguage(preferences.language as AppLanguage);
  }
};

export default function UserPreferencesRuntime() {
  const [preferences, setPreferences] = useState<Preferences>(() => readCachedPreferences());

  useEffect(() => { applyPreferences(preferences); }, [preferences]);

  useEffect(() => {
    const load = () => {
      if (!authService.isAuthenticated()) {
        setPreferences(readCachedPreferences());
        return;
      }
      void appDataService.getPreferences()
        .then((value) => setPreferences(value || {}))
        .catch(() => setPreferences(readCachedPreferences()));
    };
    const onChanged = (event: Event) => {
      const value = (event as CustomEvent<Preferences>).detail;
      setPreferences(value || readCachedPreferences());
    };
    const onAuth = () => load();
    load();
    window.addEventListener(PREFERENCES_EVENT, onChanged);
    window.addEventListener('mbote-room-auth-changed', onAuth);
    window.addEventListener('storage', onAuth);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemTheme = () => {
      if (!preferences.theme || preferences.theme === 'system') applyPreferences(preferences);
    };
    media?.addEventListener?.('change', onSystemTheme);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, onChanged);
      window.removeEventListener('mbote-room-auth-changed', onAuth);
      window.removeEventListener('storage', onAuth);
      media?.removeEventListener?.('change', onSystemTheme);
    };
  }, [preferences.theme]);

  return null;
}
