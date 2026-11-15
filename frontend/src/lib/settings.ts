// Elder settings collected in onboarding. Stored in this browser only.
// The backend still reads its own copy from backend/cdk.json (no settings endpoint yet).

export interface Contact {
  name: string;
  phone: string;
}

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
