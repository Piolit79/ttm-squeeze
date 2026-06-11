import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Loader2 } from 'lucide-react';
import { fetchBars, fetchSignals, fetchScan } from './lib/api';
import SqueezeChart from './components/SqueezeChart';
import ScanTable from './components/ScanTable';

const WATCHLIST = ['NVDA', 'GOOGL', 'AMZN', 'TSLA', 'MSFT'];
type TF = '1Hour' | '1Day';

export default function App() {
  const [ticker, setTicker]   = useState('NVDA');
  const [tf, setTf]           = useState<TF>('1Hour');
  // Chart data
  const { data: barsData, isLoading: barsLoading, error: barsErr } = useQuery({
    queryKey: ['bars', ticker, tf],
    queryFn:  () => fetchBars(ticker, tf),
    staleTime: 60_000,
  });

  const { data: sigsData } = useQuery({
    queryKey: ['signals', ticker],
    queryFn:  () => fetchSignals(ticker),
    staleTime: 60_000,
  });

  // Screener
  const { data: scanData, isLoading: scanLoading, refetch: refetchScan } = useQuery({
    queryKey: ['scan'],
    queryFn:  fetchScan,
    staleTime: 5 * 60_000,
    enabled:  false,
  });

  const latestSig = sigsData?.signals?.slice(-1)[0];

  return (
    <div className="min-h-screen bg-[#0f1117] text-slate-200 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 px-5 py-3 flex items-center gap-6">
        <h1 className="text-sm font-bold text-white tracking-tight">TTM Squeeze Pro</h1>
        <p className="text-xs text-slate-500">1H trigger · Daily confirmation · 1:2 R/R</p>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: screener */}
        <aside className="w-[440px] flex-shrink-0 border-r border-slate-800 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Screener</span>
            <button
              onClick={() => refetchScan()}
              disabled={scanLoading}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            >
              {scanLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {scanLoading ? 'Scanning…' : 'Run Scan'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!scanData && !scanLoading && (
              <div className="text-center py-16 text-slate-600 text-xs">
                Click "Run Scan" to check all watchlist tickers.
              </div>
            )}
            {scanData && (
              <>
                <ScanTable
                  results={scanData.results}
                  onSelect={setTicker}
                  selected={ticker}
                />
                {scanData.errors.length > 0 && (
                  <div className="px-4 py-2 text-xs text-red-400">
                    {scanData.errors.map(e => `${e.ticker}: ${e.error}`).join(' · ')}
                  </div>
                )}
                <div className="px-4 py-2 text-xs text-slate-600">
                  Scanned {new Date(scanData.scanned_at).toLocaleTimeString()}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Main: chart */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-4 flex-wrap">
            {/* Ticker picker */}
            <div className="flex gap-1">
              {WATCHLIST.map(t => (
                <button
                  key={t}
                  onClick={() => setTicker(t)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors
                    ${ticker === t
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-500 hover:text-slate-200'}`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Timeframe switcher */}
            <div className="flex gap-1 ml-2">
              {(['1Hour', '1Day'] as TF[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors
                    ${tf === t
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-500 hover:text-slate-200'}`}
                >
                  {t === '1Hour' ? '1H' : '1D'}
                </button>
              ))}
            </div>

            {/* Latest signal badge */}
            {latestSig && (
              <div className="ml-auto flex items-center gap-4 text-xs font-mono">
                <span className="text-slate-500">Last signal:</span>
                <span className="text-white">
                  {new Date(latestSig.bar_time).toLocaleDateString()}
                </span>
                <span className="text-slate-300">Entry <span className="text-white">${latestSig.entry_price.toFixed(2)}</span></span>
                <span className="text-red-400">Stop ${latestSig.stop_price.toFixed(2)}</span>
                <span className="text-green-400">Target ${latestSig.target_price.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Chart area */}
          <div className="flex-1 px-4 py-4">
            {barsLoading && (
              <div className="flex items-center justify-center h-full gap-2 text-slate-500">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading {ticker} {tf} bars…</span>
              </div>
            )}
            {barsErr && (
              <div className="flex items-center justify-center h-full text-red-400 text-sm">
                Failed to load data. Is the backend running on localhost:8000?
              </div>
            )}
            {barsData && !barsLoading && (
              <SqueezeChart
                bars={barsData.bars}
                signals={sigsData?.signals ?? []}
                ticker={ticker}
                timeframe={tf}
                height={500}
              />
            )}
          </div>

          {/* Legend */}
          <div className="px-5 py-2 border-t border-slate-800 flex items-center gap-6 text-xs text-slate-600">
            <span className="font-semibold text-slate-500">Squeeze dots:</span>
            {[['bg-orange-500','High'], ['bg-red-500','Mid'], ['bg-slate-500','Low'], ['bg-green-500','Fired']].map(([cls, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${cls}`} />
                {label}
              </span>
            ))}
            <span className="ml-4 font-semibold text-slate-500">Momentum:</span>
            {[['text-cyan-400','↑+'], ['text-blue-400','↓+'], ['text-yellow-400','↓−'], ['text-red-400','↑−']].map(([cls, label]) => (
              <span key={label} className={`${cls}`}>{label}</span>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
