import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStockBars } from './lib/alpaca.js';
import { makeClient, loadCachedBars, saveBars, toOHLC } from './lib/supabase.js';
import { computeTTM, momentumCrossedZeroUp, swingLow } from './lib/ttm.js';
import type { OHLCBar, IndicatorBar } from './lib/ttm.js';

export const maxDuration = 120;

const WATCHLIST = ['NVDA', 'GOOGL', 'AMZN', 'TSLA', 'MSFT'];

function alignDailyToIntraday(
  bars1h: OHLCBar[],
  ind1d: IndicatorBar[],
): (IndicatorBar | null)[] {
  const dayMap = new Map<string, IndicatorBar>();
  for (const b of ind1d) {
    const day = new Date(b.t * 1000).toISOString().slice(0, 10);
    dayMap.set(day, b);
  }
  const result: (IndicatorBar | null)[] = [];
  let lastDaily: IndicatorBar | null = null;
  for (const b of bars1h) {
    const prevDay = new Date((b.t - 86_400) * 1000).toISOString().slice(0, 10);
    if (dayMap.has(prevDay)) lastDaily = dayMap.get(prevDay)!;
    result.push(lastDaily);
  }
  return result;
}

async function getBarsWithCache(
  db: ReturnType<typeof makeClient>,
  ticker: string,
  timeframe: '1Hour' | '1Day',
): Promise<OHLCBar[]> {
  const cached = await loadCachedBars(db, ticker, timeframe);
  if (cached) return cached;
  const days = timeframe === '1Day' ? 400 : 365;
  const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const raw = await getStockBars(ticker, timeframe, start);
  const ohlc = toOHLC(raw);
  await saveBars(db, ticker, timeframe, ohlc);
  return ohlc;
}

async function scanTicker(
  db: ReturnType<typeof makeClient>,
  ticker: string,
) {
  const [bars1h, bars1d] = await Promise.all([
    getBarsWithCache(db, ticker, '1Hour'),
    getBarsWithCache(db, ticker, '1Day'),
  ]);

  const ind1h = computeTTM(bars1h);
  const ind1d = computeTTM(bars1d);
  const daily = alignDailyToIntraday(bars1h, ind1d);

  // Find last signal
  let latestSignal: { entry: number; stop: number; target: number } | null = null;
  let barsSinceSignal: number | null = null;
  let signalActive = false;

  for (let i = 1; i < bars1h.length; i++) {
    if (!momentumCrossedZeroUp(ind1h, i)) continue;
    const d = daily[i];
    if (!d || d.momentum === null || d.momentum <= 0) continue;

    const entry = bars1h[i].c;
    const stop  = swingLow(bars1h, i, 20);
    const risk  = entry - stop;
    if (risk <= 0) continue;

    latestSignal    = { entry, stop, target: entry + 2 * risk };
    barsSinceSignal = bars1h.length - 1 - i;
    // Active = signal within last 20 bars and not yet stopped out/targeted
    signalActive    = barsSinceSignal <= 20;
  }

  // "Setting up" = squeeze on AND daily mom positive but no current signal
  const last1h = ind1h[ind1h.length - 1];
  const lastD  = daily[daily.length - 1];
  const settingUp =
    !signalActive &&
    last1h.squeezeOn &&
    lastD !== null &&
    lastD.momentum !== null &&
    lastD.momentum > 0;

  const lastD1d = ind1d[ind1d.length - 1];

  return {
    ticker,
    signal_active:    signalActive,
    setting_up:       settingUp,
    bars_since_signal: barsSinceSignal,
    latest_signal:    latestSignal,
    state_1h: {
      squeeze_dot:       last1h.squeezeDot,
      momentum:          last1h.momentum ?? 0,
      momentum_color:    last1h.momentumColor ?? 'cyan',
      squeeze_on:        last1h.squeezeOn,
      squeeze_high:      last1h.squeezeHigh,
      momentum_positive: (last1h.momentum ?? 0) > 0,
      momentum_rising:   null,
    },
    state_1d: {
      squeeze_dot:       lastD1d.squeezeDot,
      momentum:          lastD1d.momentum ?? 0,
      momentum_color:    lastD1d.momentumColor ?? 'cyan',
      squeeze_on:        lastD1d.squeezeOn,
      squeeze_high:      lastD1d.squeezeHigh,
      momentum_positive: (lastD1d.momentum ?? 0) > 0,
      momentum_rising:   null,
    },
  };
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (_req.method === 'OPTIONS') return res.status(204).end();

  const db = makeClient();
  const results = [];
  const errors: { ticker: string; error: string }[] = [];

  await Promise.all(
    WATCHLIST.map(async ticker => {
      try {
        results.push(await scanTicker(db, ticker));
      } catch (e: any) {
        errors.push({ ticker, error: e.message });
      }
    }),
  );

  return res.status(200).json({
    scanned_at: new Date().toISOString(),
    watchlist:  WATCHLIST,
    results,
    errors,
  });
}
