// Elder settings collected in onboarding. Stored in this browser, and sent to the backend's
// Settings API when onboarding finishes (syncSettings in api.ts).
import type { Contact } from '../../../contracts/index.js';

export type { Contact };

export interface Settings {
  family: Contact[];
  question: string;
  answer: string;
  onboarded: boolean;
}

const KEY = 'scamdetermine.settings';
const DEFAULTS: Settings = { family: [], question: '', answer: '', onboarded: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode etc.: settings just won't persist */
  }
  return next;
}

export function resetSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
