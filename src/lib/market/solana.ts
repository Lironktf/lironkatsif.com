// On-chain payment verification (server side), using @solana/pay v1 on top of
// @solana/kit. Finds the transaction that carries the order's unique reference
// key and validates that it moved at least the expected USDC amount to the
// configured recipient.
//
// Server code must NOT import @solana/web3.js: its rpc-websockets dependency
// require()s an ESM-only package, which Vercel's function runtime rejects
// (ERR_REQUIRE_ESM) even though local Node 24 allows it.

import { createSolanaRpc, address, getAddressDecoder } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { encodeURL, findReference, validateTransfer, FindReferenceError } from '@solana/pay';
import { randomBytes } from 'node:crypto';
import type { MarketConfig } from './config';
import type { Verifier } from './market';
import { MarketError } from './market';

/** A fresh random 32-byte address; it only has to be unique, nobody signs with it. */
export function newReference(): string {
  return getAddressDecoder().decode(randomBytes(32));
}

export function paymentUrl(cfg: MarketConfig, o: { ref: string; amount: number; qty: number; price: number }) {
  return encodeURL({
    recipient: address(cfg.recipient),
    amount: o.amount,
    splToken: address(cfg.usdcMint),
    reference: address(o.ref),
    label: 'LIRON/USDC',
    message: `${o.qty * 15} min of Liron's time @ ${o.price.toFixed(2)} USDC per 15m`,
    memo: `LIRON/USDC ${o.ref.slice(0, 8)}`,
  }).toString();
}

export function solanaVerifier(cfg: MarketConfig): Verifier {
  return async (ref, amount) => {
    const rpc = createSolanaRpc(cfg.rpc);
    let signature;
    try {
      signature = (await findReference(rpc, address(ref), { commitment: 'confirmed' })).signature;
    } catch (err) {
      if (err instanceof FindReferenceError) return null; // not paid yet
      throw err; // RPC trouble: the caller retries on the next poll
    }
    try {
      await validateTransfer(
        rpc,
        signature,
        { recipient: address(cfg.recipient), amount, splToken: address(cfg.usdcMint), reference: address(ref) },
        { commitment: 'confirmed' },
      );
    } catch (err) {
      throw new MarketError('invalid_payment', `transfer found but invalid: ${(err as Error).message}`);
    }
    return { sig: String(signature) };
  };
}

// The recipient's USDC token account must exist BEFORE a payment: Solana Pay's
// validator compares pre/post token balances, so an account created inside the
// payment transaction cannot be verified. Cached briefly per instance.
let ataCache: { key: string; ok: boolean; at: number } | null = null;
export async function recipientReady(cfg: MarketConfig): Promise<boolean> {
  const key = `${cfg.rpc}|${cfg.recipient}|${cfg.usdcMint}`;
  if (ataCache && ataCache.key === key && Date.now() - ataCache.at < (ataCache.ok ? 300_000 : 30_000)) return ataCache.ok;
  const [ata] = await findAssociatedTokenPda({
    owner: address(cfg.recipient),
    mint: address(cfg.usdcMint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const { value } = await createSolanaRpc(cfg.rpc).getAccountInfo(ata, { encoding: 'base64' }).send();
  ataCache = { key, ok: value != null, at: Date.now() };
  return ataCache.ok;
}
