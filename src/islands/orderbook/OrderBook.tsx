import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Bid, BookSnapshot, FillResult, Level, MarketConfig, ServerOrder, Trade } from './types';
import { ApiError, getBook, postBid, postOrder } from './api';
import './orderbook.css';

const WalletPay = lazy(() => import('./WalletPay'));
const POLL_MS = 5000;

/** Keeps the book on screen if the lazy payment panel fails to load or crashes. */
class PayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="offline mono" role="status">
          <b>payment rails failed to load</b>
          <p>refresh the page and try again. your blocks stay held for a few minutes.</p>
        </div>
      );
    return this.props.children;
  }
}

const px = (n: number) => n.toFixed(2);
// sizes are 15-minute blocks
const blk = (n: number) => String(Math.round(n));
const mins = (n: number) => `${Math.round(n * 15)}m`;
const hhmmss = (ts: number) => new Date(ts).toISOString().slice(11, 19);
const uid = () => Math.random().toString(36).slice(2, 9);


/** flashes a row green/red when the watched value changes */
function useFlash(value: number): string {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    if (value === prev.current) return;
    const dir = value > prev.current ? 'flash-up' : 'flash-down';
    prev.current = value;
    setCls('');
    const raf = requestAnimationFrame(() => setCls(dir));
    const t = setTimeout(() => setCls(''), 600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [value]);
  return cls;
}

function Row(props: {
  side: 'ask' | 'bid';
  price: number;
  size: number;
  cum: number;
  max: number;
  note?: string;
  demo?: boolean;
  onClick?: () => void;
}) {
  const flash = useFlash(props.size);
  const depth = Math.min(100, (props.cum / props.max) * 100);
  return (
    <button
      type="button"
      className={`ob-row ${props.side} ${flash}`}
      onClick={props.onClick}
      title={props.note}
    >
      <i className="depth" style={{ width: `${depth}%` }} />
      <span className="p">{px(props.price)}</span>
      <span className="s">
        {blk(props.size)}
        {props.demo && <em className="demo-tag">demo</em>}
      </span>
      <span className="c">{blk(props.cum)}</span>
    </button>
  );
}

type TicketMode = { kind: 'buy'; level: Level; qty: number } | { kind: 'bid' } | null;
type PayState =
  | { s: 'idle' }
  | { s: 'reserving' }
  | { s: 'checkout'; order: ServerOrder }
  | { s: 'confirmed'; sig: string; booking: string | null; contact: string }
  | { s: 'halted'; msg?: string }
  | { s: 'expired' }
  | { s: 'error'; msg: string };

export default function OrderBook(props: { asks: Level[]; config: MarketConfig }) {
  const { config } = props;
  // ── live state from the server; static asks until the first poll lands ──
  const [snap, setSnap] = useState<BookSnapshot | null>(null);
  const [demoBids, setDemoBids] = useState<Bid[]>([]);
  const [demoTrades, setDemoTrades] = useState<Trade[]>([]);
  const [demo, setDemo] = useState(false);
  const [ticket, setTicket] = useState<TicketMode>(null);
  const [pay, setPay] = useState<PayState>({ s: 'idle' });
  const [bidForm, setBidForm] = useState({ price: '', size: '1', note: '', contact: '', website: '' });
  const [bidMsg, setBidMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = async () => {
    try {
      setSnap(await getBook());
    } catch {
      /* keep the last snapshot; next poll retries */
    }
  };
  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const halted = snap ? snap.halted : true;
  const asks: Level[] = useMemo(
    () => [...(snap?.levels ?? props.asks)].sort((a, b) => a.price - b.price),
    [snap, props.asks],
  );
  const bids: Bid[] = useMemo(() => [...(snap?.bids ?? []), ...demoBids], [snap, demoBids]);
  const trades: Trade[] = useMemo(
    () =>
      [...demoTrades, ...(snap?.trades ?? []).map((t) => ({ ...t, side: 'buy' as const }))].sort(
        (a, b) => b.ts - a.ts,
      ),
    [snap, demoTrades],
  );

  // ── demo feed: clearly labeled, never persisted ──────────────
  useEffect(() => {
    if (!demo) {
      setDemoBids([]);
      setDemoTrades([]);
      return;
    }
    const timer = setInterval(() => {
      const roll = Math.random();
      setDemoBids((bs) => {
        const best = asks.find((a) => a.size > 0)?.price ?? 1;
        if (roll < 0.4) {
          const price = Math.max(0.05, +(best * (0.4 + Math.random() * 0.5)).toFixed(2));
          const bid: Bid = {
            id: uid(),
            price,
            size: Math.ceil(Math.random() * 3),
            demo: true,
            ts: Date.now(),
          };
          return [...bs, bid].slice(-14);
        }
        if (roll < 0.55 && bs.some((b) => b.demo)) {
          const demoBids = bs.filter((b) => b.demo);
          const victim = demoBids[Math.floor(Math.random() * demoBids.length)];
          return bs.filter((b) => b.id !== victim.id);
        }
        return bs;
      });
      if (roll >= 0.55) {
        setDemoTrades((ts) => {
          const best = asks.find((a) => a.size > 0)?.price ?? 1;
          const t: Trade = {
            id: uid(),
            side: Math.random() > 0.4 ? 'buy' : 'sell',
            price: Math.max(0.05, +(best * (0.8 + Math.random() * 0.5)).toFixed(2)),
            size: Math.ceil(Math.random() * 2),
            ts: Date.now(),
            demo: true,
          };
          return [t, ...ts].slice(0, 30);
        });
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [demo, asks]);

  // ── derived market stats ─────────────────────────────────────
  const liveAsks = asks.filter((a) => a.size > 0);
  const sortedBids = useMemo(
    () => [...bids].sort((a, b) => b.price - a.price).slice(0, 8),
    [bids],
  );
  const bestAsk = liveAsks[0]?.price ?? null;
  const bestBid = sortedBids[0]?.price ?? null;
  const spread = bestAsk != null && bestBid != null ? bestAsk - bestBid : null;
  const last = trades[0]?.price ?? bestAsk ?? 0;
  const lastDir =
    trades.length >= 2 ? Math.sign(trades[0].price - trades[1].price) : 0;
  const vol24 = trades
    .filter((t) => Date.now() - t.ts < 86_400_000)
    .reduce((acc, t) => acc + t.size, 0);

  const askMax = useMemo(() => {
    let cum = 0;
    for (const a of liveAsks) cum += a.size;
    return Math.max(cum, 1);
  }, [liveAsks]);
  const bidMax = useMemo(
    () => Math.max(sortedBids.reduce((acc, b) => acc + b.size, 0), 1),
    [sortedBids],
  );

  const lastFlash = useFlash(last);

  // ── buy flow ─────────────────────────────────────────────────
  const openBuy = (level: Level) => {
    setPay({ s: 'idle' });
    setTicket({ kind: 'buy', level, qty: 1 });
  };

  const startCheckout = async () => {
    if (ticket?.kind !== 'buy') return;
    if (halted) {
      setPay({ s: 'halted' });
      return;
    }
    setPay({ s: 'reserving' });
    try {
      const order = await postOrder(ticket.level.price, ticket.qty);
      setPay({ s: 'checkout', order });
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'halted') setPay({ s: 'halted', msg: err.message });
      else setPay({ s: 'error', msg: err instanceof Error ? err.message : 'could not place the order' });
      refresh();
    }
  };

  const handleFill = (r: FillResult) => {
    setPay({ s: 'confirmed', sig: r.sig, booking: r.booking, contact: r.contact });
    refresh();
  };

  // ── bid flow ─────────────────────────────────────────────────
  const placeBid = async () => {
    const price = Number(bidForm.price);
    const size = Number(bidForm.size);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(size) || size <= 0) {
      setBidMsg({ ok: false, text: 'enter a price and a whole number of blocks' });
      return;
    }
    try {
      await postBid({ price, size, note: bidForm.note, contact: bidForm.contact, website: bidForm.website });
      setBidMsg({ ok: true, text: "bid placed. it's on the book, and I'll reach out if I fill it." });
      setBidForm({ price: '', size: '1', note: '', contact: '', website: '' });
      refresh();
    } catch (err) {
      setBidMsg({ ok: false, text: err instanceof Error ? err.message : 'could not place the bid' });
    }
  };

  const closeTicket = () => {
    setPay({ s: 'idle' });
    setBidMsg(null);
    setTicket(null);
  };

  return (
    <div className={`ob marks ${demo ? 'is-demo' : ''}`}>
      {/* ── header strip ── */}
      <header className="ob-head mono">
        <div className="pair">
          <b>{config.ticker}</b>
          <span className="chain">{config.chain}</span>
        </div>
        <dl className="stats">
          <div className={lastFlash}>
            <dt>last</dt>
            <dd className={lastDir > 0 ? 'up' : lastDir < 0 ? 'down' : ''}>
              {last ? px(last) : '—'}
            </dd>
          </div>
          <div>
            <dt>spread</dt>
            <dd>{spread != null ? px(spread) : '—'}</dd>
          </div>
          <div>
            <dt>24h vol</dt>
            <dd>{mins(vol24)}</dd>
          </div>
          <div>
            <dt>depth</dt>
            <dd>{mins(liveAsks.reduce((a, l) => a + l.size, 0))}</dd>
          </div>
        </dl>
        <div className="head-right">
          <button
            type="button"
            className={`demo-btn ${demo ? 'on' : ''}`}
            onClick={() => setDemo((d) => !d)}
            title="Streams clearly-labeled fake activity so you can see the book move. Real asks are unaffected."
          >
            demo feed {demo ? 'on' : 'off'}
          </button>
          {halted ? (
            <span className="live halt">
              <i /> halted
            </span>
          ) : (
            <span className="live">
              <i /> live
            </span>
          )}
        </div>
      </header>

      {demo && (
        <p className="demo-banner mono" role="status">
          demo feed on — bids and prints tagged “demo” are simulated. the asks
          are always real.
        </p>
      )}

      <div className="ob-grid">
        {/* ── the book ── */}
        <section className="book" aria-label="Order book">
          <div className="cols mono">
            <span>price · usdc/15m</span>
            <span>size · ×15m</span>
            <span>total</span>
          </div>

          <div className="asks">
            {[...liveAsks].reverse().map((a, i, arr) => {
              const cum = arr
                .slice(i)
                .reduce((acc, x) => acc + x.size, 0);
              return (
                <Row
                  key={a.price}
                  side="ask"
                  price={a.price}
                  size={a.size}
                  cum={cum}
                  max={askMax}
                  note={`${a.note ?? ''} — click to buy`}
                  onClick={() => openBuy(a)}
                />
              );
            })}
          </div>

          <div className="spread mono">
            {spread != null ? (
              <>
                <span>spread {px(spread)}</span>
                <span>mid {px((bestAsk! + bestBid!) / 2)}</span>
              </>
            ) : (
              <span>cheapest 15 min {bestAsk != null ? px(bestAsk) : '—'} usdc</span>
            )}
          </div>

          <div className="bids">
            {sortedBids.length === 0 ? (
              <button
                type="button"
                className="no-bids mono"
                onClick={() => setTicket({ kind: 'bid' })}
              >
                no resting bids — place the first ↗
              </button>
            ) : (
              sortedBids.map((b, i, arr) => {
                const cum = arr.slice(0, i + 1).reduce((acc, x) => acc + x.size, 0);
                return (
                  <Row
                    key={b.id}
                    side="bid"
                    price={b.price}
                    size={b.size}
                    cum={cum}
                    max={bidMax}
                    demo={b.demo}
                    note={b.note}
                    onClick={() => setTicket({ kind: 'bid' })}
                  />
                );
              })
            )}
          </div>
        </section>

        {/* ── the ticket ── */}
        <section className="ticket" aria-label="Order ticket">
          <div className="tabs mono">
            <button
              type="button"
              className={ticket?.kind !== 'bid' ? 'act' : ''}
              onClick={() => (liveAsks[0] ? openBuy(liveAsks[0]) : null)}
            >
              buy time
            </button>
            <button
              type="button"
              className={ticket?.kind === 'bid' ? 'act' : ''}
              onClick={() => setTicket({ kind: 'bid' })}
            >
              place bid
            </button>
          </div>

          {ticket == null && (
            <div className="ticket-empty mono">
              <p>click an ask to buy at that price,</p>
              <p>or place a bid below the market.</p>
            </div>
          )}

          {ticket?.kind === 'buy' && (
            <div className="ticket-body">
              <p className="note">{ticket.level.note}</p>
              <div className="line mono">
                <span>price</span>
                <b>{px(ticket.level.price)} usdc / 15m</b>
              </div>
              <div className="line mono">
                <span>size</span>
                <span className="qty">
                  <button
                    type="button"
                    onClick={() =>
                      setTicket({ ...ticket, qty: Math.max(1, ticket.qty - 1) })
                    }
                    aria-label="Less"
                  >
                    −
                  </button>
                  <b>{blk(ticket.qty)} × 15m</b>
                  <button
                    type="button"
                    onClick={() =>
                      setTicket({
                        ...ticket,
                        qty: Math.min(ticket.level.size, ticket.qty + 1),
                      })
                    }
                    aria-label="More"
                  >
                    +
                  </button>
                </span>
              </div>
              <div className="line total mono">
                <span>total</span>
                <b>{px(ticket.level.price * ticket.qty)} usdc</b>
              </div>

              {pay.s === 'idle' && (
                <button type="button" className="exec mono" onClick={startCheckout}>
                  buy {blk(ticket.qty)}×15m @ {px(ticket.level.price)}
                </button>
              )}
              {pay.s === 'reserving' && <p className="mono pay-loading">reserving your blocks…</p>}
              {pay.s === 'checkout' && (
                <PayBoundary>
                  <Suspense
                    fallback={<p className="mono pay-loading">loading payment rails…</p>}
                  >
                    <WalletPay
                      order={pay.order}
                      rpc={snap?.publicRpc ?? ''}
                      onFilled={handleFill}
                      onExpired={() => setPay({ s: 'expired' })}
                    />
                  </Suspense>
                </PayBoundary>
              )}
              {pay.s === 'expired' && (
                <div className="offline mono" role="status">
                  <b>order expired</b>
                  <p>the hold on those blocks ran out before a payment landed. start again if you still want them.</p>
                </div>
              )}
              {pay.s === 'error' && (
                <div className="offline mono" role="status">
                  <b>order rejected</b>
                  <p>{pay.msg}</p>
                </div>
              )}
              {pay.s === 'confirmed' && (
                <div className="filled mono" role="status">
                  <b>FILLED ✓</b>
                  <p>
                    payment confirmed on-chain.{' '}
                    {pay.booking ? (
                      <a href={pay.booking} target="_blank" rel="noopener">book your time here ↗</a>
                    ) : (
                      <a href={`mailto:${pay.contact}?subject=${encodeURIComponent('[FILLED] booking my time, tx ' + pay.sig)}`}>
                        email me to schedule ↗
                      </a>
                    )}
                  </p>
                  <span className="sig">tx {pay.sig.slice(0, 10)}…{pay.sig.slice(-6)}</span>
                </div>
              )}
              {pay.s === 'halted' && (
                <div className="offline halted mono" role="status">
                  <b>trading halted</b>
                  <p>
                    {pay.msg ?? "the market isn't open for business yet, no orders are being accepted."}{' '}
                    <a
                      href={`mailto:${config.email}?subject=${encodeURIComponent(
                        `[HALTED] interested in ${blk(ticket.qty)}×15m @ ${px(ticket.level.price)} USDC per 15m`,
                      )}`}
                    >
                      email me and I'll ping you at the opening bell ↗
                    </a>
                  </p>
                </div>
              )}
              <button type="button" className="cancel mono" onClick={closeTicket}>
                cancel order
              </button>
            </div>
          )}

          {ticket?.kind === 'bid' && (
            <div className="ticket-body">
              <p className="note">
                name a price below the market. your bid goes on the public book
                (your contact stays private), and I fill the ones I like.
              </p>
              <label className="line mono">
                <span>price · usdc/15m</span>
                <input
                  inputMode="decimal"
                  placeholder={bestAsk ? (bestAsk * 0.6).toFixed(2) : '0.25'}
                  value={bidForm.price}
                  onChange={(e) => setBidForm({ ...bidForm, price: e.target.value })}
                />
              </label>
              <label className="line mono">
                <span>size · ×15m</span>
                <input
                  inputMode="decimal"
                  value={bidForm.size}
                  onChange={(e) => setBidForm({ ...bidForm, size: e.target.value })}
                />
              </label>
              <label className="line mono">
                <span>what for?</span>
                <input
                  placeholder="optional"
                  maxLength={140}
                  value={bidForm.note}
                  onChange={(e) => setBidForm({ ...bidForm, note: e.target.value })}
                />
              </label>
              <label className="line mono">
                <span>contact · private</span>
                <input
                  placeholder="email or @telegram"
                  maxLength={120}
                  value={bidForm.contact}
                  onChange={(e) => setBidForm({ ...bidForm, contact: e.target.value })}
                />
              </label>
              <input
                className="hp"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={bidForm.website}
                onChange={(e) => setBidForm({ ...bidForm, website: e.target.value })}
              />
              {bidMsg && <p className={`mono bid-msg ${bidMsg.ok ? 'ok' : 'bad'}`}>{bidMsg.text}</p>}
              <button type="button" className="exec bid-exec mono" onClick={placeBid}>
                place bid
              </button>
              <button type="button" className="cancel mono" onClick={closeTicket}>
                cancel
              </button>
            </div>
          )}
        </section>

        {/* ── the tape ── */}
        <section className="tape" aria-label="Recent trades">
          <div className="cols mono">
            <span>time</span>
            <span>price</span>
            <span>size</span>
          </div>
          {trades.length === 0 ? (
            <p className="no-prints mono">no prints yet — be the first trade on the tape.</p>
          ) : (
            <ol className="mono">
              {trades.slice(0, 14).map((t) => (
                <li key={t.id} className={t.side === 'buy' ? 'up' : 'down'}>
                  <span>{hhmmss(t.ts)}</span>
                  <span>{px(t.price)}</span>
                  <span>
                    {mins(t.size)}{t.demo && <em className="demo-tag">demo</em>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
