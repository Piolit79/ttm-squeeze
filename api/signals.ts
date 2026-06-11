import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStockBars } from './lib/alpaca.js';
import { makeClient, loadCachedBars, saveBars, toOHLC } from './lib/supabase.js';
import { computeTTM, momentumCrossedZeroUp, swingLow } from './lib/ttm.js';
import type { OHLCBar, IndicatorBar } from './lib/ttm.js';

export const maxDuration = 60;

const WATCHLIST = ['NVDA', 'GOOGL', 'AMZN', 'TSLA', 'MSFT'];

/** Forward-fill daily indicator values onto the 1H index. */
function alignDailyToIntraday(
  bars1h: OHLCBar[],
  ind1d: IndicatorBar[],
): (IndicatorBar | null)[] {
  // Build a day-string → last IndicatorBar map (end of each daily bar)
  const dayMap = new Map<string, IndicatorBar>();
  for (const b of ind1d) {
    const day = new Date(b.t * 1000).toISOString().slice(0, 10);
    dayMap.set(day, b);
  }

  const result: (IndicatorBar | null)[] = [];
  let lastDaily: IndicatorBar | null = null;

  for (const b of bars1h) {
    // Use the previous calendar day so we never lookahead
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
  const lookback = timeframe === '1Day' ? 400 : 365;
  const raw = await getStockBars(ticker, timeframe, lookback);
  const ohlc = toOHLC(raw);
  await saveBars(db, ticker, timeframe, ohlc);
  return ohlc;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ticker = (req.query.ticker as string | undefined)?.toUpperCase();
  if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }
  if (!WATCHLIST.includes(ticker)) {
    return res.status(400).json({ error: `${ticker} not in watchlist` });
  }

  const db = makeClient();

  const [bars1h, bars1d] = await Promise.all([
    getBarsWithCache(db, ticker, '1Hour'),
    getBarsWithCache(db, ticker, '1Day'),
  ]);

  const ind1h = computeTTM(bars1h);
  const ind1d = computeTTM(bars1d);
  const daily = alignDailyToIntraday(bars1h, ind1d);

  const signals = [];

  for (let i = 1; i < bars1h.length; i++) {
    if (!momentumCrossedZeroUp(ind1h, i)) continue;

    // Daily confirmation: previous day's momentum must be positive
    const d = daily[i];
    if (!d || d.momentum === null || d.momentum <= 0) continue;

    const entry = bars1h[i].c;
    const stop  = swingLow(bars1h, i, 20);
    const risk  = entry - stop;
    if (risk <= 0) continue;
    const target = entry + 2 * risk;

    signals.push({
      bar_time:     new Date(bars1h[i].t * 1000).toISOString(),
      entry_price:  entry,
      stop_price:   stop,
      target_price: target,
      risk_points:  risk,
      reward_points: 2 * risk,
    });
  }

  return res.status(200).json({ ticker, signals });
}
