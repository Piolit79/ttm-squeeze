const BASE = 'https://data.alpaca.markets';

function headers() {
  return {
    'APCA-API-KEY-ID':     process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
  };
}

export interface AlpacaBar {
  t: string; // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Fetch all bars for a symbol + timeframe, paginating through next_page_token.
 * timeframe: "1Hour" | "1Day"
 * lookback:  how many calendar days back to start
 */
export async function getStockBars(
  symbol: string,
  timeframe: '1Hour' | '1Day',
  lookbackDays = 365,
): Promise<AlpacaBar[]> {
  const start = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const bars: AlpacaBar[] = [];
  let pageToken: string | undefined;

  do {
    let url =
      `${BASE}/v2/stocks/${symbol}/bars` +
      `?timeframe=${timeframe}&start=${start}&limit=1000&adjustment=all&feed=iex`;
    if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;

    const r = await fetch(url, { headers: headers() });
    if (!r.ok) throw new Error(`Alpaca ${r.status}: ${symbol} ${timeframe} — ${await r.text()}`);
    const data = await r.json();

    if (Array.isArray(data.bars)) bars.push(...data.bars);
    pageToken = data.next_page_token ?? undefined;
  } while (pageToken);

  return bars;
}
