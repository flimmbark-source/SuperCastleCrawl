import type { AccessibilitySettings } from '../types';
import { DEFAULT_BINDINGS } from './InputManager';

const STORAGE_KEY = 'glyphdelve_settings';

export const DEFAULT_SETTINGS: AccessibilitySettings = {
  keyBindings: { ...DEFAULT_BINDINGS },
  gameSpeed: 1.0,
  fontScale: 100,
  colorblindMode: false,
  reducedMotion: false,
  screenShake: true,
  tooltipMode: 'plain',
};

export function loadSettings(): AccessibilitySettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: AccessibilitySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function applyFontScale(scale: 100 | 125 | 150) {
  document.documentElement.style.fontSize = `${scale}%`;
}
