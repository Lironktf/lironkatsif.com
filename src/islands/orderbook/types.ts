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
  side: 'buy' | 'sell';
  price: number;
  size: number;
  ts: number;
  demo?: boolean;
  sig?: string;
};

export type MarketConfig = {
  ticker: string;
  chain: string;
  solAddress: string;
  usdcMint: string;
  rpc: string;
  bookingUrl: string;
  email: string;
};
