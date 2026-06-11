import { createClient } from '@supabase/supabase-js';
import type { AlpacaBar } from './alpaca.js';
import type { OHLCBar } from './ttm.js';

export function makeClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type Sb = ReturnType<typeof makeClient>;

/** ISO timestamp → unix seconds */
function toUnix(t: string): number {
  return Math.floor(new Date(t).getTime() / 1000);
}

/**
 * Load cached bars from Supabase.
 * Returns null if cache is empty or stale (>= 15 min old for intraday, >= 8 h for daily).
 */
export async function loadCachedBars(
  db: Sb,
  ticker: string,
  timeframe: string,
): Promise<OHLCBar[] | null> {
  const { data, error } = await db
    .from('bars_cache')
    .select('bars_json, fetched_at')
    .eq('ticker', ticker)
    .eq('timeframe', timeframe)
    .maybeSingle();

  if (error || !data) return null;

  const ageMs = Date.now() - new Date(data.fetched_at).getTime();
  const maxAgeMs = timeframe === '1Day' ? 8 * 3_600_000 : 15 * 60_000;
  if (ageMs > maxAgeMs) return null;

  return data.bars_json as OHLCBar[];
}

/** Upsert bars into the cache. */
export async function saveBars(
  db: Sb,
  ticker: string,
  timeframe: string,
  bars: OHLCBar[],
): Promise<void> {
  await db.from('bars_cache').upsert(
    { ticker, timeframe, bars_json: bars, fetched_at: new Date().toISOString() },
    { onConflict: 'ticker,timeframe' },
  );
}

/** Convert Alpaca raw bars → OHLCBar (unix seconds). */
export function toOHLC(raw: AlpacaBar[]): OHLCBar[] {
  return raw.map(b => ({
    t: toUnix(b.t),
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
  }));
}
