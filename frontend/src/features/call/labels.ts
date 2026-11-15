import type { Level, Tactic } from '@contracts';

export const LEVEL_LABEL: Record<Level, string> = { green: 'Safe', yellow: 'Careful', red: 'Scam!' };

export const LEVEL_ADVICE: Record<Level, string> = {
  green: 'This call sounds normal.',
  yellow: 'Be careful. Don’t send money or share personal details.',
  red: 'This sounds like a scam. Hang up now.',
};

export const TACTIC_LABEL: Record<Tactic, string> = {
  impersonation: 'Pretending to be someone',
  urgency: 'Rushing you',
  secrecy: 'Asking you to keep it secret',
  payment_request: 'Asking for money',
  gift_cards: 'Gift cards',
  wire_or_crypto: 'Wire or crypto',
  remote_access: 'Control of your computer',
  personal_info_request: 'Asking for private info',
  threats: 'Threats',
};

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
