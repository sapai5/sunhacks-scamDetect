import { describe, expect, it } from 'vitest';
import { elderAlertsFor, smsText } from '../lambda/shared/elderAlerts.js';
import { parseAppMessage, parseSubscription, subscriptionKey } from '../lambda/push/rules.js';

const kinds = (...args: Parameters<typeof elderAlertsFor>) => elderAlertsFor(...args).map((a) => a.kind);

describe('elderAlertsFor: when the elder gets a text / notification', () => {
  it('alerts once when the call turns red, not on every red result', () => {
    expect(kinds({ level: 'yellow' }, { level: 'red' }, 'CA1')).toEqual(['red']);
    expect(kinds(undefined, { level: 'red' }, 'CA1')).toEqual(['red']);
    expect(kinds({ level: 'red' }, { level: 'red' }, 'CA1')).toEqual([]);
    expect(kinds({ level: 'yellow', peak: 'red' }, { level: 'red', peak: 'red' }, 'CA1')).toEqual([]);
  });

  it('stays quiet for green and yellow results', () => {
    expect(kinds(undefined, { level: 'green' }, 'CA1')).toEqual([]);
    expect(kinds({ level: 'green' }, { level: 'yellow' }, 'CA1')).toEqual([]);
  });

  it('tells the elder the agent took over (their leg drops), by the agent name', () => {
    const [a] = elderAlertsFor({ level: 'red', agentStatus: 'idle' }, { level: 'red', agentStatus: 'active' }, 'CA1', 'Dana');
    expect(a.kind).toBe('takeover');
    expect(a.title).toBe('Dana took over this call');
    expect(a.body).toMatch(/Don't call this number back/);
    expect(a.path).toBe('/elder/live');
  });

  it('reports how the takeover ended', () => {
    expect(kinds({ agentStatus: 'active' }, { agentStatus: 'scam_confirmed' }, 'CA1')).toEqual(['scam']);
    expect(kinds({ agentStatus: 'active' }, { agentStatus: 'verified' }, 'CA1')).toEqual(['verified']);
    // "Let me talk": the elder did it themselves, nothing to tell them.
    expect(kinds({ agentStatus: 'active' }, { agentStatus: 'stopped' }, 'CA1')).toEqual([]);
  });

  it('sends a summary when a risky call ends, linking to its page; green calls end quietly', () => {
    const [a] = elderAlertsFor({ level: 'red', peak: 'red' }, { level: 'red', peak: 'red', ended: true }, 'CA 1');
    expect(a).toMatchObject({ kind: 'ended', title: 'You hung up on a likely scam', path: '/elder/call?id=CA%201' });
    expect(kinds({ level: 'yellow' }, { level: 'yellow', ended: true }, 'CA1')).toEqual(['ended']);
    expect(kinds({ level: 'green' }, { level: 'green', ended: true }, 'CA1')).toEqual([]);
    // After a confirmed scam the "scam" alert already said it.
    expect(kinds({ agentStatus: 'scam_confirmed', peak: 'red' }, { agentStatus: 'scam_confirmed', peak: 'red', ended: true }, 'CA1')).toEqual([]);
  });

  it('builds a text with the app link', () => {
    const [a] = elderAlertsFor(undefined, { level: 'red' }, 'CA1');
    expect(smsText(a, 'https://app.example.com/')).toBe(
      "ScamDetermine: This call may be a scam. Don't send money, gift cards or codes. Open ScamDetermine to see why. https://app.example.com/elder/live",
    );
  });
});

describe('push socket: Web Push and current-call messages', () => {
  const sub = { endpoint: 'https://web.push.apple.com/QAbc123', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };

  it('accepts the new actions', () => {
    expect(parseAppMessage('{"action":"vapidKey"}')).toEqual({ action: 'vapidKey' });
    expect(parseAppMessage('{"action":"current","elderId":"e-01"}')).toEqual({ action: 'current', elderId: 'e-01' });
    expect(parseAppMessage(JSON.stringify({ action: 'subscribePush', elderId: 'e-01', subscription: sub }))).toEqual({
      action: 'subscribePush',
      elderId: 'e-01',
      subscription: sub,
    });
  });

  it('rejects subscriptions that would make the Lambda call arbitrary URLs', () => {
    expect(parseSubscription({ ...sub, endpoint: 'http://169.254.169.254/latest' })).toBeNull();
    expect(parseSubscription({ ...sub, endpoint: 'not a url' })).toBeNull();
    expect(parseSubscription({ endpoint: sub.endpoint, keys: { p256dh: 'x', auth: sub.keys.auth } })).toBeNull();
    expect(parseAppMessage(JSON.stringify({ action: 'subscribePush', subscription: sub }))).toBeNull(); // no elderId
  });

  it('keys a subscription by its endpoint', () => {
    expect(subscriptionKey(sub.endpoint)).toBe(subscriptionKey(sub.endpoint));
    expect(subscriptionKey(sub.endpoint)).not.toBe(subscriptionKey(`${sub.endpoint}x`));
    expect(subscriptionKey(sub.endpoint)).toMatch(/^s[0-9a-f]{24}$/);
  });
});
