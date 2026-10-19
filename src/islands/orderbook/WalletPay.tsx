// Payment panel for a server-created order. Two rails: a connected wallet
// (Wallet Standard: Phantom, Solflare, Backpack, auto-detected) or a Solana
// Pay QR for phones. Either way the SERVER confirms the payment on-chain;
// this panel just polls /api/confirm until the order is filled.

import { useEffect, useState } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react';
import type { FillResult, ServerOrder } from './types';
import { postConfirm } from './api';
import { buildUsdcTransfer } from './transfer';
import './walletpay.css';

export type WalletPayProps = {
  order: ServerOrder;
  rpc: string;
  onFilled: (r: FillResult) => void;
  onExpired: () => void;
};

export default function WalletPay(props: WalletPayProps) {
  return (
    <ConnectionProvider endpoint={props.rpc}>
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
  if (/insufficient|receiving wallet|needs a little sol/i.test(m)) return m.toLowerCase();
  if (/rejected|declined|cancel/i.test(m)) return 'you declined the transaction';
  if (/blockhash|network|fetch/i.test(m)) return 'network hiccup, try again';
  return m.length > 90 ? m.slice(0, 90) + '…' : m;
}

function useCountdown(until: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, until - now);
  return `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
}

function PayPanel({ order, onFilled, onExpired }: WalletPayProps) {
  const [method, setMethod] = useState<'wallet' | 'qr'>('wallet');
  const [status, setStatus] = useState<Status>({ s: 'idle' });
  const [qr, setQr] = useState<string | null>(null);
  const { connection } = useConnection();
  const { wallets, select, publicKey, connecting, connected, sendTransaction, disconnect } = useWallet();
  const left = useCountdown(order.expiresAt);

  const installed = wallets.filter((w) => w.readyState === 'Installed' || w.readyState === 'Loadable');

  // Poll the server for this order's payment, whichever rail was used.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await postConfirm(order.ref);
        if (stop) return;
        if (r.status === 'filled') return onFilled(r as FillResult);
        if (r.status === 'expired') return onExpired();
      } catch (err: any) {
        if (!stop && err?.code === 'invalid_payment')
          setStatus({ s: 'error', msg: 'a transfer was found but it did not match this order. email me' });
      }
      if (!stop) timer = setTimeout(tick, 3000);
    };
    let timer = setTimeout(tick, 3000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [order.ref]);

  useEffect(() => {
    if (method !== 'qr' || qr) return;
    import('qrcode')
      .then((QR) => QR.toDataURL(order.url, { margin: 1, width: 232, color: { dark: '#0c0b09', light: '#eae7e0' } }))
      .then(setQr)
      .catch(() => setStatus({ s: 'error', msg: 'could not draw the qr, use the wallet rail' }));
  }, [method]);

  async function payWithWallet() {
    if (!publicKey) return;
    setStatus({ s: 'building' });
    try {
      const tx = await buildUsdcTransfer(connection, publicKey, order);
      setStatus({ s: 'approving' });
      const sig = await sendTransaction(tx, connection);
      setStatus({ s: 'confirming', sig });
    } catch (err) {
      setStatus({ s: 'error', msg: humanize(err) });
    }
  }

  const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

  return (
    <div className="wp mono">
      <div className="wp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={method === 'wallet'} className={method === 'wallet' ? 'act' : ''} onClick={() => setMethod('wallet')}>
          wallet
        </button>
        <button type="button" role="tab" aria-selected={method === 'qr'} className={method === 'qr' ? 'act' : ''} onClick={() => setMethod('qr')}>
          qr code
        </button>
        <span className="wp-ttl" title="your reserved blocks are held for this long">held {left}</span>
      </div>

      {order.cluster === 'devnet' && <p className="wp-note">devnet test market: no real money moves.</p>}

      {method === 'wallet' && (
        <div className="wp-body">
          {!connected && installed.length === 0 && (
            <p className="wp-note">no solana wallet detected in this browser. install phantom or solflare, or pay by qr code.</p>
          )}
          {!connected && installed.length > 0 && (
            <div className="wp-wallets">
              <p className="wp-note">connect to trade directly:</p>
              {installed.map((w) => (
                <button type="button" key={w.adapter.name} className="wp-wallet" disabled={connecting} onClick={() => select(w.adapter.name)}>
                  <img src={w.adapter.icon} alt="" width={16} height={16} />
                  {w.adapter.name.toLowerCase()}
                  {connecting && ', connecting…'}
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
                  pay {order.amount.toFixed(2)} usdc
                </button>
              ) : (
                <p className="wp-status">
                  <i />
                  {status.s === 'building' && 'building transaction…'}
                  {status.s === 'approving' && 'approve it in your wallet…'}
                  {status.s === 'confirming' && 'sent. confirming on solana…'}
                </p>
              )}
            </div>
          )}
          {status.s === 'error' && <p className="wp-err">rejected: {status.msg}</p>}
        </div>
      )}

      {method === 'qr' && (
        <div className="wp-body">
          {!qr ? (
            <p className="wp-note">generating payment request…</p>
          ) : (
            <div className="wp-qr">
              <img src={qr} alt="Solana Pay QR code" width={116} height={116} />
              <div className="wp-qr-meta">
                <a href={order.url}>open in wallet ↗</a>
                <button type="button" onClick={() => navigator.clipboard?.writeText(order.url)}>
                  copy payment link
                </button>
                <span className="wp-status">
                  <i /> watching solana for your transfer…
                </span>
              </div>
            </div>
          )}
          {status.s === 'error' && <p className="wp-err">{status.msg}</p>}
        </div>
      )}
    </div>
  );
}
