// Called from the Connect contact flow on every inbound call.
// Product rule: only callers NOT in the elder's contacts are screened.
// Stage 2 start: the contacts list comes from an env var. After B1, read Elders.trustedContacts.

interface ConnectEvent {
  Details?: { ContactData?: { CustomerEndpoint?: { Address?: string; Type?: string } } };
}

/** Keep digits and a leading +, and assume US numbers when there's no country code. */
export function normalize(number: string): string {
  const digits = number.replace(/[^\d]/g, '');
  if (number.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export function isTrusted(caller: string | undefined, trustedCsv: string): boolean {
  if (!caller) return false; // withheld caller ID is never trusted
  const trusted = new Set(trustedCsv.split(',').map((n) => n.trim()).filter(Boolean).map(normalize));
  return trusted.has(normalize(caller));
}

export const handler = async (event: ConnectEvent): Promise<{ trusted: 'true' | 'false' }> => {
  const caller = event.Details?.ContactData?.CustomerEndpoint?.Address;
  const trusted = isTrusted(caller, process.env.TRUSTED_CONTACTS ?? '');
  // Log the decision only; no phone numbers in logs.
  console.log(JSON.stringify({ trusted, hasCallerId: Boolean(caller) }));
  return { trusted: trusted ? 'true' : 'false' };
};
