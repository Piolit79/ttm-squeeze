const BASE = "/api";

export interface Bar {
  t: number;
  o: number; h: number; l: number; c: number; v: number;
  squeeze_dot: "orange" | "red" | "black" | "green";
  momentum: number | null;
  momentum_color: "cyan" | "blue" | "yellow" | "red_m" | null;
  squeeze_on: boolean;
  squeeze_high: boolean;
}

export interface BarsResponse {
  ticker: string;
  timeframe: string;
  bars: Bar[];
}

export interface Signal {
  bar_time: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  risk_points: number;
  reward_points: number;
}

export interface SignalsResponse {
  ticker: string;
  signals: Signal[];
}

export interface TickerState {
  squeeze_dot: string;
  momentum: number;
  momentum_color: string;
  squeeze_on: boolean;
  squeeze_high: boolean;
  momentum_positive: boolean;
  momentum_rising: boolean | null;
}

export interface ScanResult {
  ticker: string;
  signal_active: boolean;
  setting_up: boolean;
  bars_since_signal: number | null;
  latest_signal: { entry: number; stop: number; target: number } | null;
  state_1h: TickerState;
  state_1d: TickerState;
}

export interface ScanResponse {
  scanned_at: string;
  watchlist: string[];
  results: ScanResult[];
  errors: { ticker: string; error: string }[];
}

export async function fetchBars(ticker: string, timeframe: "1Hour" | "1Day"): Promise<BarsResponse> {
  const r = await fetch(`${BASE}/bars?ticker=${ticker}&timeframe=${timeframe}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export async function fetchSignals(ticker: string): Promise<SignalsResponse> {
  const r = await fetch(`${BASE}/signals?ticker=${ticker}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export async function fetchScan(): Promise<ScanResponse> {
  const r = await fetch(`${BASE}/scan`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
