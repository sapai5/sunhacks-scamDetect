import { describe, expect, it } from 'vitest';
import { backspacePhone, caretForDigits, formatUsPhone, keptDigitsBefore } from './phone';

const FULL = '+1 (480) 555-0193';

describe('formatUsPhone', () => {
  it('formats partial and full numbers and ignores extra digits', () => {
    expect(formatUsPhone('')).toBe('');
    expect(formatUsPhone('480')).toBe('+1 (480');
    expect(formatUsPhone('4805')).toBe('+1 (480) 5');
    expect(formatUsPhone('4805550193')).toBe(FULL);
    expect(formatUsPhone('48055501934')).toBe(FULL);
  });

  it('accepts the formats people paste', () => {
    expect(formatUsPhone('+1 (480) 555-0193')).toBe(FULL);
    expect(formatUsPhone('1-480-555-0193')).toBe(FULL);
    expect(formatUsPhone('+1 480 555 0193')).toBe(FULL);
  });
});

describe('caret', () => {
  it('counts national digits and skips the country code', () => {
    expect(keptDigitsBefore(FULL, FULL.indexOf(')') + 1)).toBe(3);
    expect(keptDigitsBefore(FULL, 0)).toBe(0);
    expect(caretForDigits(FULL, 0)).toBe(FULL.indexOf('(') + 1);
    expect(caretForDigits(FULL, 3)).toBe(FULL.indexOf(')') );
    expect(caretForDigits('+1 (480) 5', 4)).toBe('+1 (480) 5'.length);
  });
});

describe('backspacePhone', () => {
  it('deletes the digit before a parenthesis or dash', () => {
    const afterParen = backspacePhone(FULL, FULL.indexOf(')') + 1);
    expect(afterParen).toEqual({ value: '+1 (485) 550-193', caret: caretForDigits('+1 (485) 550-193', 2) });
    const afterDash = backspacePhone(FULL, FULL.indexOf('-') + 1);
    expect(afterDash?.value).toBe('+1 (480) 550-193');
  });

  it('leaves a digit delete to the browser', () => {
    expect(backspacePhone(FULL, FULL.indexOf('0') + 1)).toBeNull();
  });
});
