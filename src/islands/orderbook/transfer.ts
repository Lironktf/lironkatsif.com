// Builds a Solana Pay-compatible USDC transfer for the connected-wallet rail.
// Shape required by the server's validator:
//   [memo, transferChecked(payer ATA -> recipient ATA, + reference key)]
// with the transfer as the LAST instruction and the reference appended as a
// read-only, non-signer account.

import './buffer-polyfill';
import { Buffer } from 'buffer';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { ServerOrder } from './types';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const USDC_DECIMALS = 6;

export async function buildUsdcTransfer(connection: Connection, payer: PublicKey, order: ServerOrder) {
  const mint = new PublicKey(order.mint);
  const recipient = new PublicKey(order.recipient);
  const from = getAssociatedTokenAddressSync(mint, payer);
  const to = getAssociatedTokenAddressSync(mint, recipient, true);
  const raw = BigInt(Math.round(order.amount * 10 ** USDC_DECIMALS));

  if (payer.equals(recipient))
    throw new Error("that's the receiving wallet. pay from a different wallet");
  // Every Solana transaction needs a little SOL for the network fee, even a USDC transfer.
  if ((await connection.getBalance(payer, 'confirmed')) < 10_000)
    throw new Error('this wallet needs a little SOL (about 0.001) for the network fee');

  let balance: bigint;
  try {
    balance = (await getAccount(connection, from)).amount;
  } catch {
    throw new Error('insufficient usdc: this wallet has no usdc account');
  }
  if (balance < raw) throw new Error('insufficient usdc in that wallet');

  const memo = new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [],
    data: Buffer.from(`LIRON/USDC ${order.ref.slice(0, 8)}`, 'utf8'),
  });
  const transfer = createTransferCheckedInstruction(from, mint, to, payer, raw, USDC_DECIMALS);
  transfer.keys.push({ pubkey: new PublicKey(order.ref), isSigner: false, isWritable: false });

  const tx = new Transaction().add(memo, transfer);
  tx.feePayer = payer;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  return tx;
}
