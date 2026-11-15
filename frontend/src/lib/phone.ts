// US phone entry. The field shows "+1 (480) 555-0193" while the person types digits.
// Formatting characters are not part of the number: backspace on one deletes the digit before it.

/** The up-to-10 national digits. A leading 1 is the country code when the value has a "+" or more than 10 digits. */
export function nationalDigits(raw: string): string {
  const hasPlus = raw.trim().startsWith('+');
  let d = raw.replace(/\D/g, '');
  if ((hasPlus || d.length > 10) && d.startsWith('1')) d = d.slice(1);
  return d.slice(0, 10);
}

/** Display form. Empty stays empty so the placeholder can show. */
export function formatUsPhone(raw: string): string {
  const d = nationalDigits(raw);
  if (!d) return '';
  const body = d.length < 4 ? `(${d}` : d.length < 7 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return `+1 ${body}`;
}

/** How many national digits are before this caret. The country-code 1 does not count. */
export function keptDigitsBefore(raw: string, caret: number): number {
  const digits = raw.replace(/\D/g, '');
  const dropCountry = (raw.trim().startsWith('+') || digits.length > 10) && digits.startsWith('1');
  let seen = 0;
  let kept = 0;
  for (let i = 0; i < raw.length && i < caret; i++) {
    if (!/\d/.test(raw[i] ?? '')) continue;
    seen++;
    if (dropCountry && seen === 1) continue;
    kept++;
  }
  return Math.min(10, kept);
}

/** Caret sitting just after `count` national digits, past the "+1 (" prefix. */
export function caretForDigits(formatted: string, count: number): number {
  if (!formatted) return 0;
  const open = formatted.indexOf('(');
  if (count <= 0) return open >= 0 ? open + 1 : 0;
  const dropCountry = formatted.trim().startsWith('+');
  let seen = 0;
  let kept = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (!/\d/.test(formatted[i] ?? '')) continue;
    seen++;
    if (dropCountry && seen === 1) continue;
    kept++;
    if (kept === count) return i + 1;
  }
  return formatted.length;
}

export interface PhoneEdit {
  value: string;
  caret: number;
}

/**
 * Backspace while the caret is on a formatting character: delete the digit before it.
 * Returns null when the character before the caret is a digit, so the browser can delete it.
 */
export function backspacePhone(raw: string, caret: number): PhoneEdit | null {
  if (caret <= 0 || /\d/.test(raw[caret - 1] ?? '')) return null;
  const before = keptDigitsBefore(raw, caret);
  if (before === 0) return { value: formatUsPhone(raw), caret: caretForDigits(formatUsPhone(raw), 0) };
  const digits = nationalDigits(raw);
  const next = formatUsPhone(digits.slice(0, before - 1) + digits.slice(before));
  return { value: next, caret: caretForDigits(next, before - 1) };
}

/** Forward delete while the caret is on a formatting character. */
export function deletePhone(raw: string, caret: number): PhoneEdit | null {
  if (caret >= raw.length || /\d/.test(raw[caret] ?? '')) return null;
  const before = keptDigitsBefore(raw, caret);
  const digits = nationalDigits(raw);
  if (before >= digits.length) return { value: formatUsPhone(raw), caret: caretForDigits(formatUsPhone(raw), before) };
  const next = formatUsPhone(digits.slice(0, before) + digits.slice(before + 1));
  return { value: next, caret: caretForDigits(next, before) };
}
