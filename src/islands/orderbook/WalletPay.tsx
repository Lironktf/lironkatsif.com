// Payment panel, lazy-loaded only when a buy ticket reaches checkout.
// Two rails: a connected wallet (any Wallet Standard wallet — Phantom,
// Solflare, Backpack — auto-detected, no hardcoded adapter list) or a
// Solana Pay QR for phones and the walletless.

import { useEffect, useRef, useState } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react';
import type { MarketConfig } from './types';
import type { PaymentSession } from './solana';
import { startPayment } from './solana';
import './walletpay.css';

export type WalletPayProps = {
  amount: number;
  label: string;
  message: string;
  config: MarketConfig;
  onConfirmed: (signature: string) => void;
};

export default function WalletPay(props: WalletPayProps) {
  return (
    <ConnectionProvider endpoint={props.config.rpc}>
      <WalletProvider wallets={[]} autoConnect>
        <PayPanel {...props} />
      </WalletProvider>
    </ConnectionProvider>
  );
}

type Status =
  | { s: 'idle' }
  | { s: 'building' }
  | { s: 'approving' }
  | { s: 'confirming'; sig: string }
  | { s: 'error'; msg: string };

function humanize(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/insufficient/i.test(m)) return 'insufficient USDC in that wallet';
  if (/rejected|declined|cancel/i.test(m)) return 'you declined the transaction';
  if (/payer not found/i.test(m)) return 'that wallet has no funds on mainnet';
  return m.length > 90 ? m.slice(0, 90) + '…' : m;
}

function PayPanel({ amount, label, message, config, onConfirmed }: WalletPayProps) {
  const [method, setMethod] = useState<'wallet' | 'qr'>('wallet');
  const [status, setStatus] = useState<Status>({ s: 'idle' });
  const [qr, setQr] = useState<PaymentSession | null>(null);
  const qrRef = useRef<PaymentSession | null>(null);
  const { connection } = useConnection();
  const { wallets, select, publicKey, connecting, connected, sendTransaction, disconnect } =
    useWallet();

  const installed = wallets.filter(
    (w) => w.readyState === 'Installed' || w.readyState === 'Loadable',
  );

  // QR session lives only while the qr tab is open
  useEffect(() => {
    if (method !== 'qr' || qrRef.current) return;
    let cancelled = false;
    startPayment({
      recipient: config.solAddress,
      amount,
      usdcMint: config.usdcMint,
      rpc: config.rpc,
      label,
      message,
      onConfirmed,
      onError: () =>
        setStatus({ s: 'error', msg: 'transfer found but failed validation — email me your tx signature' }),
    })
      .then((session) => {
        if (cancelled) return session.abort();
        qrRef.current = session;
        setQr(session);
      })
      .catch(() => setStatus({ s: 'error', msg: 'could not build the QR — try the wallet rail' }));
    return () => {
      cancelled = true;
    };
  }, [method]);
  useEffect(
    () => () => {
      qrRef.current?.abort();
    },
    [],
  );

  async function payWithWallet() {
    if (!publicKey) return;
    setStatus({ s: 'building' });
    try {
      const [pay, web3, { default: BigNumber }] = await Promise.all([
        import('@solana/pay'),
        import('@solana/web3.js'),
        import('bignumber.js'),
      ]);
      const reference = web3.Keypair.generate().publicKey;
      const tx = await pay.createTransfer(connection, publicKey, {
        recipient: new web3.PublicKey(config.solAddress),
        amount: new BigNumber(amount),
        splToken: new web3.PublicKey(config.usdcMint),
        reference,
        memo: label,
      });
      setStatus({ s: 'approving' });
      const sig = await sendTransaction(tx, connection);
      setStatus({ s: 'confirming', sig });
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
      onConfirmed(sig);
    } catch (err) {
      setStatus({ s: 'error', msg: humanize(err) });
    }
  }

  const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

  return (
    <div className="wp mono">
      <div className="wp-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={method === 'wallet'}
          className={method === 'wallet' ? 'act' : ''}
          onClick={() => setMethod('wallet')}
        >
          wallet
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === 'qr'}
          className={method === 'qr' ? 'act' : ''}
          onClick={() => setMethod('qr')}
        >
          qr code
        </button>
      </div>

      {method === 'wallet' && (
        <div className="wp-body">
          {!connected && installed.length === 0 && (
            <p className="wp-note">
              no solana wallet detected in this browser — install phantom or
              solflare, or pay by qr code instead.
            </p>
          )}

          {!connected && installed.length > 0 && (
            <div className="wp-wallets">
              <p className="wp-note">connect to trade directly:</p>
              {installed.map((w) => (
                <button
                  type="button"
                  key={w.adapter.name}
                  className="wp-wallet"
                  disabled={connecting}
                  onClick={() => select(w.adapter.name)}
                >
                  <img src={w.adapter.icon} alt="" width={16} height={16} />
                  {w.adapter.name.toLowerCase()}
                  {connecting && ' — connecting…'}
                </button>
              ))}
            </div>
          )}

          {connected && publicKey && (
            <div className="wp-connected">
              <p className="wp-note">
                <span className="wp-key">{short(publicKey.toBase58())}</span>
                <button type="button" className="wp-disconnect" onClick={() => disconnect()}>
                  disconnect
                </button>
              </p>
              {status.s === 'idle' || status.s === 'error' ? (
                <button type="button" className="wp-pay" onClick={payWithWallet}>
                  pay {amount.toFixed(2)} usdc
                </button>
              ) : (
                <p className="wp-status">
                  <i />
                  {status.s === 'building' && 'building transaction…'}
                  {status.s === 'approving' && 'approve it in your wallet…'}
                  {status.s === 'confirming' && 'confirming on solana…'}
                </p>
              )}
            </div>
          )}

          {status.s === 'error' && <p className="wp-err">rejected — {status.msg}</p>}
        </div>
      )}

      {method === 'qr' && (
        <div className="wp-body">
          {!qr ? (
            <p className="wp-note">generating payment request…</p>
          ) : (
            <div className="wp-qr">
              <img src={qr.qr} alt="Solana Pay QR code" width={116} height={116} />
              <div className="wp-qr-meta">
                <a href={qr.url}>open in wallet ↗</a>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(qr.url)}
                >
                  copy payment link
                </button>
                <span className="wp-status">
                  <i /> watching solana for your transfer…
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
