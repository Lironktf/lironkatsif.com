import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Bid, Level, MarketConfig, Trade } from './types';
import './orderbook.css';

const WalletPay = lazy(() => import('./WalletPay'));

const BIDS_KEY = 'lk.bids';
const TRADES_KEY = 'lk.trades';

const px = (n: number) => n.toFixed(2);
const hrs = (n: number) => n.toFixed(1);
const hhmmss = (ts: number) => new Date(ts).toISOString().slice(11, 19);
const uid = () => Math.random().toString(36).slice(2, 9);

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. — book still works for the session */
  }
}

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
        {hrs(props.size)}
        {props.demo && <em className="demo-tag">demo</em>}
      </span>
      <span className="c">{hrs(props.cum)}</span>
    </button>
  );
}

type TicketMode = { kind: 'buy'; level: Level; qty: number } | { kind: 'bid' } | null;
type PayState =
  | { s: 'idle' }
  | { s: 'checkout' }
  | { s: 'confirmed'; sig: string }
  | { s: 'unconfigured' };

export default function OrderBook(props: { asks: Level[]; config: MarketConfig }) {
  const { config } = props;
  const [asks, setAsks] = useState<Level[]>(() =>
    [...props.asks].sort((a, b) => a.price - b.price),
  );
  const [bids, setBids] = useState<Bid[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [demo, setDemo] = useState(false);
  const [ticket, setTicket] = useState<TicketMode>(null);
  const [pay, setPay] = useState<PayState>({ s: 'idle' });
  const [bidForm, setBidForm] = useState({ price: '', size: '1.0', note: '' });

  // hydrate persisted state after mount (island is client-rendered but be safe)
  useEffect(() => {
    setBids(load<Bid[]>(BIDS_KEY, []));
    setTrades(load<Trade[]>(TRADES_KEY, []));
  }, []);
  useEffect(() => save(BIDS_KEY, bids.filter((b) => !b.demo)), [bids]);
  useEffect(() => save(TRADES_KEY, trades.filter((t) => !t.demo)), [trades]);

  // ── demo feed: clearly labeled, never persisted ──────────────
  useEffect(() => {
    if (!demo) {
      setBids((bs) => bs.filter((b) => !b.demo));
      setTrades((ts) => ts.filter((t) => !t.demo));
      return;
    }
    const timer = setInterval(() => {
      const roll = Math.random();
      setBids((bs) => {
        const best = asks.find((a) => a.size > 0)?.price ?? 200;
        if (roll < 0.4) {
          const price = Math.max(20, Math.round(best - 5 - Math.random() * 60));
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
        setTrades((ts) => {
          const best = asks.find((a) => a.size > 0)?.price ?? 200;
          const t: Trade = {
            id: uid(),
            side: Math.random() > 0.4 ? 'buy' : 'sell',
            price: Math.round(best + (Math.random() - 0.6) * 30),
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

  const startCheckout = () => {
    if (ticket?.kind !== 'buy') return;
    setPay(config.solAddress ? { s: 'checkout' } : { s: 'unconfigured' });
  };

  const handleFill = (sig: string) => {
    if (ticket?.kind !== 'buy') return;
    setTrades((ts) => [
      {
        id: uid(),
        side: 'buy',
        price: ticket.level.price,
        size: ticket.qty,
        ts: Date.now(),
        sig,
      },
      ...ts,
    ]);
    setAsks((as) =>
      as.map((a) =>
        a.price === ticket.level.price
          ? { ...a, size: Math.max(0, a.size - ticket.qty) }
          : a,
      ),
    );
    setPay({ s: 'confirmed', sig });
  };

  // ── bid flow ─────────────────────────────────────────────────
  const placeBid = () => {
    const price = Number(bidForm.price);
    const size = Number(bidForm.size);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) return;
    const bid: Bid = { id: uid(), price, size, note: bidForm.note, ts: Date.now() };
    setBids((bs) => [...bs, bid]);
    const body = encodeURIComponent(
      `Bid on ${config.ticker}\n\nprice: ${price} USDC/h\nsize: ${size}h\nnote: ${bidForm.note || '—'}\n\n(reply to this email to negotiate / get filled)`,
    );
    window.location.href = `mailto:${config.email}?subject=${encodeURIComponent(
      `[BID] ${size}h @ ${price} USDC/h`,
    )}&body=${body}`;
    setBidForm({ price: '', size: '1.0', note: '' });
    setTicket(null);
  };

  const closeTicket = () => {
    setPay({ s: 'idle' });
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
            <dd>{hrs(vol24)}h</dd>
          </div>
          <div>
            <dt>depth</dt>
            <dd>{hrs(liveAsks.reduce((a, l) => a + l.size, 0))}h</dd>
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
          <span className="live">
            <i /> live
          </span>
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
            <span>price · usdc/h</span>
            <span>size · h</span>
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
              <span>cheapest hour {bestAsk != null ? px(bestAsk) : '—'} usdc</span>
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
                <b>{px(ticket.level.price)} usdc/h</b>
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
                  <b>{hrs(ticket.qty)}h</b>
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
                  buy {hrs(ticket.qty)}h @ {px(ticket.level.price)}
                </button>
              )}
              {pay.s === 'checkout' && (
                <Suspense
                  fallback={<p className="mono pay-loading">loading payment rails…</p>}
                >
                  <WalletPay
                    amount={ticket.level.price * ticket.qty}
                    label={`${config.ticker} — ${hrs(ticket.qty)}h`}
                    message={`${hrs(ticket.qty)}h of Liron's time @ ${px(ticket.level.price)} USDC/h`}
                    config={config}
                    onConfirmed={handleFill}
                  />
                </Suspense>
              )}
              {pay.s === 'confirmed' && (
                <div className="filled mono" role="status">
                  <b>FILLED ✓</b>
                  <p>
                    payment confirmed on-chain.{' '}
                    {config.bookingUrl ? (
                      <a href={config.bookingUrl}>book your time here ↗</a>
                    ) : (
                      <a href={`mailto:${config.email}?subject=${encodeURIComponent('[FILLED] booking my hours — tx ' + pay.sig)}`}>
                        email me to schedule ↗
                      </a>
                    )}
                  </p>
                  <span className="sig">tx {pay.sig.slice(0, 10)}…{pay.sig.slice(-6)}</span>
                </div>
              )}
              {pay.s === 'unconfigured' && (
                <div className="offline mono" role="status">
                  <b>payments offline</b>
                  <p>
                    the wallet isn't wired up yet —{' '}
                    <a
                      href={`mailto:${config.email}?subject=${encodeURIComponent(
                        `[BUY] ${hrs(ticket.qty)}h @ ${px(ticket.level.price)} USDC/h`,
                      )}`}
                    >
                      email me and consider it filled ↗
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
                name a price below the market. bids are indicative — placing one
                emails me, and I fill the ones I like.
              </p>
              <label className="line mono">
                <span>price · usdc/h</span>
                <input
                  inputMode="decimal"
                  placeholder={bestAsk ? String(Math.round(bestAsk * 0.7)) : '120'}
                  value={bidForm.price}
                  onChange={(e) => setBidForm({ ...bidForm, price: e.target.value })}
                />
              </label>
              <label className="line mono">
                <span>size · hours</span>
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
                  value={bidForm.note}
                  onChange={(e) => setBidForm({ ...bidForm, note: e.target.value })}
                />
              </label>
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
                    {hrs(t.size)}h{t.demo && <em className="demo-tag">demo</em>}
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
