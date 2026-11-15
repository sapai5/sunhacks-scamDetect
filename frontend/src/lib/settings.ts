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

/** The old form filled these in. They are not real contacts, so they are dropped. */
function isSampleContact(c: Contact): boolean {
  const name = c.name.trim().toLowerCase();
  const digits = c.phone.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return name === 'maria (daughter)' || name === 'james (son)' || national === '4805550193' || national === '4805550122';
}

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Set when Maria and James were removed, so the app can clear them on the server too. */
let sampleRemoved = false;

export function loadSettings(): Settings {
  const s = read();
  const family = (Array.isArray(s.family) ? s.family : []).filter((c) => c && typeof c.name === 'string' && typeof c.phone === 'string' && !isSampleContact(c));
  if (family.length === s.family.length) return s;
  const next = { ...s, family };
  sampleRemoved = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

/** The cleaned settings, once, after the sample contacts were removed. */
export function takeSampleFamilyRemoval(): Settings | null {
  if (!sampleRemoved) return null;
  sampleRemoved = false;
  return loadSettings();
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
