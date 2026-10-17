// Owner notifications. Telegram and/or email (Resend); both optional.
// Never throws: a failed notification must not break a trade.

import type { MarketConfig } from './config';

export function notifier(cfg: MarketConfig) {
  return async (text: string) => {
    const jobs: Promise<unknown>[] = [];
    const t = (ms: number) => AbortSignal.timeout(ms);
    if (cfg.telegramToken && cfg.telegramChat) {
      jobs.push(
        fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: cfg.telegramChat, text }),
          signal: t(5000),
        }),
      );
    }
    if (cfg.resendKey && cfg.notifyEmail) {
      jobs.push(
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.resendKey}` },
          body: JSON.stringify({
            from: cfg.resendFrom,
            to: [cfg.notifyEmail],
            subject: text.split('\n')[0],
            text,
          }),
          signal: t(5000),
        }),
      );
    }
    if (jobs.length === 0) console.log('[market notify]', text);
    await Promise.allSettled(jobs);
  };
}
