import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStockBars } from './lib/alpaca.js';
import { makeClient, loadCachedBars, saveBars, toOHLC } from './lib/supabase.js';
import { computeTTM } from './lib/ttm.js';

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

  const db = makeClient();

  let ohlc = await loadCachedBars(db, ticker, timeframe);

  if (!ohlc) {
    const lookback = timeframe === '1Day' ? 400 : 365;
    const raw = await getStockBars(ticker, timeframe, lookback);
    if (raw.length === 0) return res.status(404).json({ error: `No bars for ${ticker}` });
    ohlc = toOHLC(raw);
    await saveBars(db, ticker, timeframe, ohlc);
  }

  const ind = computeTTM(ohlc);

  const bars = ohlc.map((b, i) => ({
    t:              b.t,
    o:              b.o,
    h:              b.h,
    l:              b.l,
    c:              b.c,
    v:              b.v,
    squeeze_dot:    ind[i].squeezeDot,
    momentum:       ind[i].momentum,
    momentum_color: ind[i].momentumColor,
    squeeze_on:     ind[i].squeezeOn,
    squeeze_high:   ind[i].squeezeHigh,
  }));

  return res.status(200).json({ ticker, timeframe, bars });
}
