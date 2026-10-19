// Thin client for the market API. Errors carry the server's human message.
import type { BookSnapshot, Bid, FillResult, ServerOrder } from './types';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Set by /admin after login (same origin). Present only in the owner's browser. */
function ownerToken(): string {
  try {
    return sessionStorage.getItem('lk.admin') ?? '';
  } catch {
    return '';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const tok = ownerToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? 'error', body.message ?? `request failed (${res.status})`);
  return body as T;
}

export const getBook = () => call<BookSnapshot>('/api/book');
export const postBid = (b: { price: number; size: number; note: string; contact: string; website: string }) =>
  call<{ bid: Bid }>('/api/bid', { method: 'POST', body: JSON.stringify(b) });
export const postOrder = (price: number, qty: number) =>
  call<ServerOrder>('/api/order', { method: 'POST', body: JSON.stringify({ price, qty }) });
export const postConfirm = (ref: string) =>
  call<FillResult | { status: 'pending' | 'expired' }>('/api/confirm', {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
export const postCancel = (ref: string) =>
  call<{ ok: true }>('/api/cancel', { method: 'POST', body: JSON.stringify({ ref }) });
