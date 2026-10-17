export type Level = { price: number; size: number; note?: string };

export type Bid = {
  id: string;
  price: number;
  size: number;
  note?: string;
  demo?: boolean;
  ts: number;
};

export type Trade = {
  id: string;
  side?: 'buy' | 'sell';
  price: number;
  size: number;
  ts: number;
  demo?: boolean;
  sig?: string;
};

/** Static display config. Everything that matters for money comes from the server. */
export type MarketConfig = {
  ticker: string;
  chain: string;
  email: string;
};

export type BookSnapshot = {
  halted: boolean;
  cluster: 'devnet' | 'mainnet-beta';
  levels: Level[];
  bids: Bid[];
  trades: Trade[];
  publicRpc: string;
};

export type ServerOrder = {
  ref: string;
  price: number;
  qty: number;
  amount: number;
  expiresAt: number;
  recipient: string;
  mint: string;
  cluster: 'devnet' | 'mainnet-beta';
  url: string;
};

export type FillResult = { status: 'filled'; sig: string; booking: string | null; contact: string };
