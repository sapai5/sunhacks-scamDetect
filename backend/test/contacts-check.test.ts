import { describe, expect, it } from 'vitest';
import { isTrusted, normalize } from '../telephony/contacts-check/index.js';

describe('contacts check', () => {
  it('normalizes US formats to E.164', () => {
    expect(normalize('(480) 555-0193')).toBe('+14805550193');
    expect(normalize('1-480-555-0193')).toBe('+14805550193');
    expect(normalize('+1 480 555 0193')).toBe('+14805550193');
  });

  it('trusts numbers in the list regardless of formatting', () => {
    expect(isTrusted('+14805550193', '+1 (480) 555-0193, +16025550100')).toBe(true);
  });

  it('screens everyone else, including withheld caller ID', () => {
    expect(isTrusted('+16025550147', '+14805550193')).toBe(false);
    expect(isTrusted(undefined, '+14805550193')).toBe(false);
    expect(isTrusted('anonymous', '+14805550193')).toBe(false);
    expect(isTrusted('+14805550193', '')).toBe(false);
  });
});
