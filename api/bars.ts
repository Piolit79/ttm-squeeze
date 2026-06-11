import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStockBars } from './lib/alpaca.js';
import { makeClient, loadCachedBars, saveBars, toOHLC } from './lib/supabase.js';

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ticker    = (req.query.ticker    as string | undefined)?.toUpperCase();
  const timeframe = (req.query.timeframe as string | undefined) ?? '1Hour';

  if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }
  if (timeframe !== '1Hour' && timeframe !== '1Day') {
    return res.status(400).json({ error: 'timeframe must be 1Hour or 1Day' });
  }

  // When explicit start/end dates are requested (backtest), bypass the cache
  // so arbitrary historical ranges work without poisoning the chart cache.
  const startParam = req.query.start as string | undefined;
  const endParam   = req.query.end   as string | undefined;

  if (startParam) {
    const raw = await getStockBars(ticker, timeframe as '1Hour' | '1Day', startParam, endParam);
    if (raw.length === 0) return res.status(404).json({ error: `No bars for ${ticker}` });
    return res.status(200).json({ ticker, timeframe, bars: toOHLC(raw) });
  }

  const db = makeClient();
  let ohlc = await loadCachedBars(db, ticker, timeframe);

  if (!ohlc) {
    const defaultStart = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const raw = await getStockBars(ticker, timeframe as '1Hour' | '1Day', defaultStart);
    if (raw.length === 0) return res.status(404).json({ error: `No bars for ${ticker}` });
    ohlc = toOHLC(raw);
    await saveBars(db, ticker, timeframe, ohlc);
  }

  return res.status(200).json({ ticker, timeframe, bars: ohlc });
}
