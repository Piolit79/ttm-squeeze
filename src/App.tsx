import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Loader2 } from 'lucide-react';
import { fetchBars, fetchSignals, fetchScan } from './lib/api';
import SqueezeChart from './components/SqueezeChart';
import ScanTable from './components/ScanTable';
import Backtest from './pages/Backtest';
import type { TTMOpts } from './lib/ttm';

const WATCHLIST = ['NVDA', 'GOOGL', 'AMZN', 'TSLA', 'MSFT'];
type TF = '1Hour' | '1Day';
type Page = 'chart' | 'backtest';

export default function App() {
  const [page, setPage]     = useState<Page>('chart');
  const [ticker, setTicker] = useState('NVDA');
  const [tf, setTf]         = useState<TF>('1Hour');
  const [length, setLength] = useState(() => {
    const saved = localStorage.getItem('ttm-length');
    return saved ? parseInt(saved, 10) : 7;
  });
  const setLengthPersist = useCallback((v: number) => {
    localStorage.setItem('ttm-length', String(v));
    setLength(v);
  }, []);

  const ttmOpts: TTMOpts = useMemo(
    () => ({ length, bbMult: 2.0, kcHigh: 1.0, kcMid: 1.5, kcLow: 2.0 }),
    [length],
  );

  const { data: barsData, isLoading: barsLoading, error: barsErr } = useQuery({
    queryKey:  ['bars', ticker, tf],
    queryFn:   () => fetchBars(ticker, tf),
    staleTime: 60_000,
  });

  const { data: sigsData } = useQuery({
    queryKey:  ['signals', ticker],
    queryFn:   () => fetchSignals(ticker),
    staleTime: 60_000,
  });

  const { data: scanData, isLoading: scanLoading, refetch: refetchScan } = useQuery({
    queryKey:  ['scan'],
    queryFn:   fetchScan,
    staleTime: 5 * 60_000,
  });

  const latestSig = sigsData?.signals?.slice(-1)[0];

  // Measure the chart container so lightweight-charts gets exact pixel heights.
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [chartAreaH, setChartAreaH] = useState(
    () => Math.max(300, (typeof window !== 'undefined' ? window.innerHeight : 800) - 300),
  );
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h > 0) setChartAreaH(h);
    });
    ro.observe(el);
    if (el.clientHeight > 0) setChartAreaH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Price gets ~68% of chart area, momentum ~32%
  const priceH = Math.round(chartAreaH * 0.68);
  const momH   = chartAreaH - priceH - 1; // -1 for the separator pixel

  return (
    <div className="h-screen bg-[#0f1117] text-slate-200 flex flex-col overflow-hidden">

      {/* ── Header / toolbar ─────────────────────────────────────────────── */}
      <header className="border-b border-slate-800 px-4 py-2 flex items-center gap-3 flex-wrap">
        <h1 className="text-sm font-bold text-white tracking-tight shrink-0">TTM Squeeze Pro</h1>

        <div className="w-px h-4 bg-slate-700 shrink-0" />

        {/* Page tabs */}
        <div className="flex gap-1">
          {(['chart', 'backtest'] as Page[]).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`px-3 py-1 rounded text-xs font-semibold capitalize transition-colors
                ${page === p ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-200'}`}
            >
              {p === 'chart' ? 'Chart' : 'Backtest'}
            </button>
          ))}
        </div>

        {/* Chart-specific controls */}
        {page === 'chart' && (
          <>
            <div className="w-px h-4 bg-slate-700 shrink-0" />
            <div className="flex gap-1">
              {WATCHLIST.map(t => (
                <button key={t} onClick={() => setTicker(t)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors
                    ${ticker === t ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-200'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-slate-700 shrink-0" />
            <div className="flex gap-1">
              {(['1Hour', '1Day'] as TF[]).map(t => (
                <button key={t} onClick={() => setTf(t)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors
                    ${tf === t ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-200'}`}>
                  {t === '1Hour' ? '1H' : '1D'}
                </button>
              ))}
            </div>
          </>
        )}

        {page === 'chart' && (
          <>
            <div className="w-px h-4 bg-slate-700 shrink-0" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Length</span>
              <input type="number" min={5} max={100} step={1} value={length}
                onChange={e => setLengthPersist(Math.max(5, Math.min(100, Number(e.target.value))))}
                className="w-14 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-white text-center focus:outline-none focus:border-blue-500"
              />
            </div>
            <span className="text-xs text-slate-600 hidden sm:inline">
              BB ±{ttmOpts.bbMult}σ · KC {ttmOpts.kcHigh}×/{ttmOpts.kcMid}×/{ttmOpts.kcLow}× ATR
            </span>
            {latestSig && (
              <div className="ml-auto flex items-center gap-3 text-xs font-mono flex-wrap shrink-0">
                <span className="text-slate-500">Last signal</span>
                <span className="text-slate-300">{new Date(latestSig.bar_time).toLocaleDateString()}</span>
                <span>Entry <span className="text-white">${latestSig.entry_price.toFixed(2)}</span></span>
                <span className="text-red-400">Stop ${latestSig.stop_price.toFixed(2)}</span>
                <span className="text-green-400">Target ${latestSig.target_price.toFixed(2)}</span>
              </div>
            )}
          </>
        )}
      </header>

      {/* ── Backtest page ────────────────────────────────────────────────────── */}
      {page === 'backtest' && <Backtest />}

      {/* ── Chart page ──────────────────────────────────────────────────────── */}
      {page === 'chart' && (
      <>
      <div ref={chartAreaRef} className="flex-1 min-h-0 px-4 pt-2 pb-0">
        {barsLoading && (
          <div className="flex items-center justify-center h-full gap-2 text-slate-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading {ticker} {tf}…</span>
          </div>
        )}
        {barsErr && (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">
            Failed to load bars.
          </div>
        )}
        {barsData && !barsLoading && (
          <SqueezeChart
            bars={barsData.bars}
            signals={sigsData?.signals ?? []}
            opts={ttmOpts}
            priceHeight={priceH}
            momHeight={momH}
          />
        )}
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="flex-none px-4 py-1.5 border-b border-slate-800 flex items-center gap-4 text-xs text-slate-600 flex-wrap">
        <span className="font-semibold text-slate-500">Squeeze:</span>
        {[['bg-orange-500','High'],['bg-red-500','Mid'],['bg-slate-500','Low'],['bg-green-500','Fired']].map(([cls,lbl]) => (
          <span key={lbl} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${cls}`}/>{lbl}</span>
        ))}
        <span className="ml-2 font-semibold text-slate-500">Mom:</span>
        {[['text-cyan-400','↑+'],['text-blue-400','↓+'],['text-yellow-400','↓−'],['text-red-400','↑−']].map(([cls,lbl]) => (
          <span key={lbl} className={cls}>{lbl}</span>
        ))}
        <span className="ml-2 font-semibold text-slate-500">Signals:</span>
        <span className="text-green-400">↑ Buy</span>
        <span className="text-yellow-400">↓ Target</span>
        <span className="text-red-400">↓ Stop</span>
      </div>

      {/* ── Screener — fixed-height band at the bottom ─────────────────────── */}
      <div className="flex-none flex flex-col border-t border-slate-800">
        <div className="px-4 py-1.5 flex items-center justify-between border-b border-slate-800 flex-shrink-0">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Screener</span>
          <div className="flex items-center gap-3">
            {scanData && (
              <span className="text-xs text-slate-600">{new Date(scanData.scanned_at).toLocaleTimeString()}</span>
            )}
            <button
              onClick={() => refetchScan()}
              disabled={scanLoading}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-200 transition-colors disabled:opacity-40"
            >
              {scanLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
          {scanLoading && !scanData && (
            <div className="flex items-center justify-center gap-2 text-slate-500 py-6 text-xs">
              <Loader2 size={13} className="animate-spin" /> Scanning watchlist…
            </div>
          )}
          {scanData && (
            <>
              <ScanTable results={scanData.results} onSelect={setTicker} selected={ticker} />
              {scanData.errors.length > 0 && (
                <div className="px-4 py-1 text-xs text-red-400">
                  {scanData.errors.map(e => `${e.ticker}: ${e.error}`).join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </> )} {/* end chart page */}

    </div>
  );
}
