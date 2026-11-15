// Pure validation for the Settings API. No AWS calls here so it can be unit tested.
import type { Contact, ElderSettings } from '../../../contracts/index.js';
import { BadRequest } from '../analyze/rules.js';

const TEXT_FIELDS = ['elderName', 'verificationQuestion', 'verificationAnswer', 'agentName', 'agentRelation'] as const;
const E164 = /^\+[1-9]\d{6,14}$/;

export type SettingsPatch = Partial<Omit<ElderSettings, 'elderId'>>;

/** PUT body -> the fields to update. Unknown fields are dropped; a bad field rejects the whole request. */
export function parseSettingsPatch(body: unknown): { elderId: string; patch: SettingsPatch } {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (typeof b.elderId !== 'string' || !b.elderId || b.elderId.length > 64) throw new BadRequest('elderId must be a string');

  const patch: SettingsPatch = {};
  for (const k of TEXT_FIELDS) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !v.trim() || v.length > 200) throw new BadRequest(`${k} must be 1-200 characters`);
    patch[k] = v.trim();
  }
  if (b.family !== undefined) {
    if (!Array.isArray(b.family) || b.family.length > 5) throw new BadRequest('family must be an array of at most 5');
    patch.family = b.family.map((c): Contact => {
      const o = (c ?? {}) as Record<string, unknown>;
      if (typeof o.name !== 'string' || typeof o.phone !== 'string' || o.name.length > 64 || o.phone.length > 24) {
        throw new BadRequest('family entries need a name and phone');
      }
      return { name: o.name.trim(), phone: o.phone.trim() };
    });
  }
  if (b.trustedContacts !== undefined) {
    const list = b.trustedContacts;
    if (!Array.isArray(list) || list.length > 100 || !list.every((p) => typeof p === 'string' && E164.test(p))) {
      throw new BadRequest('trustedContacts must be at most 100 E.164 numbers like +14805551234');
    }
    patch.trustedContacts = list as string[];
  }
  if (Object.keys(patch).length === 0) throw new BadRequest('nothing to update');
  return { elderId: b.elderId, patch };
}
