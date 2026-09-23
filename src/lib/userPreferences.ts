import type { Preferences } from '../services/appDataService';

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
  try { localStorage.setItem(PREFERENCES_CACHE_KEY, JSON.stringify(preferences)); } catch { /* storage can be unavailable */ }
};

export const publishPreferences = (preferences: Preferences) => {
  writeCachedPreferences(preferences);
  window.dispatchEvent(new CustomEvent<Preferences>(PREFERENCES_EVENT, { detail: preferences }));
};
