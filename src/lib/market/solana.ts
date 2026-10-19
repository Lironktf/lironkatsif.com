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
import { encodeURL, findReference, FindReferenceError } from '@solana/pay';
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

/**
 * How much of `mint` (in base units) the recipient's balance grew by in this
 * transaction, from the RPC's pre/post token balances. Order-independent: it
 * doesn't care which instruction did the transfer, so wallets that add their
 * own instructions (MetaMask appends ComputeBudget, others add guard
 * instructions) still verify. Returns null if the transaction failed.
 */
export function receivedBaseUnits(tx: any, recipient: string, mint: string): bigint | null {
  if (!tx?.meta || tx.meta.err != null) return null;
  const sum = (list: any[] | undefined) =>
    (list ?? [])
      .filter((b) => b.owner === recipient && b.mint === mint)
      .reduce<bigint>((acc, b) => acc + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
}

/** True if `key` is one of the transaction's account keys (the order reference). */
export function mentionsKey(tx: any, key: string): boolean {
  const keys: any[] = tx?.transaction?.message?.accountKeys ?? [];
  const loaded = [...(tx?.meta?.loadedAddresses?.readonly ?? []), ...(tx?.meta?.loadedAddresses?.writable ?? [])];
  return [...keys.map((k) => (typeof k === 'string' ? k : k.pubkey)), ...loaded].includes(key);
}

const USDC_DECIMALS = 6;

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
    const tx = await rpc
      .getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
      .send();
    if (!tx) return null; // indexed but not yet fetchable: retry next poll
    const want = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
    const got = receivedBaseUnits(tx, cfg.recipient, cfg.usdcMint);
    if (!mentionsKey(tx, ref)) throw new MarketError('invalid_payment', 'transaction does not carry this order reference');
    if (got == null) throw new MarketError('invalid_payment', 'transaction failed on-chain');
    if (got < want)
      throw new MarketError('invalid_payment', `received ${got} base units, expected at least ${want}`);
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
