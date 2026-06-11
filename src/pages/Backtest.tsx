import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { createChart, type IChartApi, type Time } from 'lightweight-charts';
import { fetchBars } from '../lib/api';
import { runBacktest, type BacktestConfig, type BacktestStats, type TradeRecord } from '../lib/backtest';

const WATCHLIST = ['NVDA', 'GOOGL', 'AMZN', 'TSLA', 'MSFT'];

// ── Equity curve lightweight-charts component ──────────────────────────────────

function EquityCurve({ curve, startCapital }: { curve: { t: number; equity: number }[]; startCapital: number }) {
  const ref  = useRef<HTMLDivElement>(null);
  const api  = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || curve.length === 0) return;

    const chart = createChart(ref.current, {
      width:  ref.current.clientWidth,
      height: 160,
      layout: { background: { color: '#0f1117' }, textColor: '#94a3b8' },
      grid:   { vertLines: { color: '#1e2330' }, horzLines: { color: '#1e2330' } },
      rightPriceScale:  { borderColor: '#2e3347' },
      timeScale:        { borderColor: '#2e3347', timeVisible: true },
      crosshair:        { mode: 1 },
    });

    const baseline = chart.addBaselineSeries({
      baseValue:              { type: 'price', price: startCapital },
      topLineColor:           '#22c55e',
      topFillColor1:          'rgba(34,197,94,0.15)',
      topFillColor2:          'rgba(34,197,94,0.02)',
      bottomLineColor:        '#ef4444',
      bottomFillColor1:       'rgba(239,68,68,0.02)',
      bottomFillColor2:       'rgba(239,68,68,0.15)',
      lastValueVisible:       true,
      priceLineVisible:       false,
      crosshairMarkerVisible: true,
    });

    baseline.setData(curve.map(p => ({ time: p.t as Time, value: p.equity })));
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    api.current = chart;

    return () => { ro.disconnect(); chart.remove(); api.current = null; };
  }, [curve, startCapital]);

  return <div ref={ref} className="w-full" />;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({
  label, value, sub, color,
}: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Trade table ────────────────────────────────────────────────────────────────

function TradeTable({ trades }: { trades: TradeRecord[] }) {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  return (
    <div className="overflow-auto border border-slate-800 rounded-lg" style={{ maxHeight: 300 }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-900">
          <tr className="text-slate-500 uppercase tracking-wider">
            {['#','Entry Date','Entry','Stop','Target','Exit Date','Exit','Reason','P&L $','P&L %','Equity'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap border-b border-slate-800">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map(t => {
            const reasonColor =
              t.exitReason === 'target' ? 'text-green-400' :
              t.exitReason === 'stop'   ? 'text-red-400'   :
              'text-yellow-400';
            const pnlColor = t.pnl >= 0 ? 'text-green-400' : 'text-red-400';
            return (
              <tr key={t.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                <td className="px-3 py-2 text-slate-500">{t.id}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{t.entryDate.slice(0,10)}</td>
                <td className="px-3 py-2 font-mono">{fmt(t.entryPrice)}</td>
                <td className="px-3 py-2 font-mono text-red-400">{fmt(t.stopPrice)}</td>
                <td className="px-3 py-2 font-mono text-green-400">{fmt(t.targetPrice)}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">
                  {t.exitDate === 'Open' ? '—' : t.exitDate.slice(0,10)}
                </td>
                <td className="px-3 py-2 font-mono">{fmt(t.exitPrice)}</td>
                <td className={`px-3 py-2 font-semibold ${reasonColor}`}>{t.exitReason.toUpperCase()}</td>
                <td className={`px-3 py-2 font-mono ${pnlColor}`}>{t.pnl >= 0 ? '+' : ''}{fmt(t.pnl)}</td>
                <td className={`px-3 py-2 font-mono ${pnlColor}`}>{fmtPct(t.pnlPct)}</td>
                <td className="px-3 py-2 font-mono text-slate-300">{fmt(t.equity)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Input helper ───────────────────────────────────────────────────────────────

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-slate-400 font-semibold">{label}</label>
      {children}
      {note && <span className="text-xs text-slate-600">{note}</span>}
    </div>
  );
}

const inputCls = "bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 w-full";

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Backtest() {
  // ── Config state ──────────────────────────────────────────────────────────
  const today       = new Date().toISOString().slice(0, 10);
  const oneYearAgo  = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  const [capital,   setCapital]   = useState('10000');
  const [riskPct,   setRiskPct]   = useState('2');
  const [commission,setCommission]= useState('0');
  const [slippage,  setSlippage]  = useState('0');
  const [maxDd,     setMaxDd]     = useState('20');
  const [startDate, setStartDate] = useState(oneYearAgo);
  const [endDate,   setEndDate]   = useState(today);
  const [ticker,    setTicker]    = useState('NVDA');
  const [tf,        setTf]        = useState<'1Hour' | '1Day'>('1Hour');
  const [length,    setLength]    = useState('20');

  // ── Run state ─────────────────────────────────────────────────────────────
  const [computing, setComputing] = useState(false);
  const [results,   setResults]   = useState<BacktestStats | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const { refetch: fetch1h } = useQuery({
    queryKey:  ['bt-bars-1h', ticker],
    queryFn:   () => fetchBars(ticker, '1Hour'),
    enabled:   false,
    staleTime: 5 * 60_000,
  });

  const { refetch: fetch1d } = useQuery({
    queryKey:  ['bt-bars-1d', ticker],
    queryFn:   () => fetchBars(ticker, '1Day'),
    enabled:   false,
    staleTime: 5 * 60_000,
  });

  const handleRun = async () => {
    setComputing(true);
    setResults(null);
    setError(null);

    try {
      const [r1h, r1d] = await Promise.all([fetch1h(), fetch1d()]);
      if (!r1h.data || !r1d.data) throw new Error('Failed to load bar data');

      const cfg: BacktestConfig = {
        startCapital:   parseFloat(capital)   || 10_000,
        riskPct:        parseFloat(riskPct)   || 2,
        commission:     parseFloat(commission)|| 0,
        slippage:       parseFloat(slippage)  || 0,
        maxDrawdownPct: parseFloat(maxDd)     || 0,
        startTs:        Math.floor(new Date(startDate).getTime() / 1000),
        endTs:          Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000),
        opts: {
          length: parseInt(length) || 20,
          bbMult: 2.0, kcHigh: 1.0, kcMid: 1.5, kcLow: 2.0,
        },
      };

      // Yield to browser to paint "Computing…" before blocking
      await new Promise(resolve => setTimeout(resolve, 30));
      const res = runBacktest(r1h.data.bars, r1d.data.bars, cfg);
      setResults(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setComputing(false);
    }
  };

  const s = results;
  const green = (n: number) => n >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── Config sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-60 flex-none border-r border-slate-800 overflow-y-auto p-4 flex flex-col gap-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Configuration</p>

        <Field label="Ticker">
          <select value={ticker} onChange={e => setTicker(e.target.value)} className={inputCls}>
            {WATCHLIST.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>

        <Field label="Timeframe">
          <select value={tf} onChange={e => setTf(e.target.value as '1Hour' | '1Day')} className={inputCls}>
            <option value="1Hour">1 Hour</option>
            <option value="1Day">Daily</option>
          </select>
        </Field>

        <Field label="TTM Length">
          <input type="number" min={5} max={100} value={length}
            onChange={e => setLength(e.target.value)} className={inputCls} />
        </Field>

        <div className="border-t border-slate-800 pt-3 flex flex-col gap-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Capital</p>

          <Field label="Starting Capital ($)">
            <input type="number" min={100} value={capital}
              onChange={e => setCapital(e.target.value)} className={inputCls} />
          </Field>

          <Field label="Risk per Trade (%)" note="% of equity risked on each stop">
            <input type="number" min={0.1} max={25} step={0.1} value={riskPct}
              onChange={e => setRiskPct(e.target.value)} className={inputCls} />
          </Field>

          <Field label="Commission ($ / side)">
            <input type="number" min={0} step={0.01} value={commission}
              onChange={e => setCommission(e.target.value)} className={inputCls} />
          </Field>

          <Field label="Slippage ($ / share)">
            <input type="number" min={0} step={0.01} value={slippage}
              onChange={e => setSlippage(e.target.value)} className={inputCls} />
          </Field>

          <Field label="Max Drawdown Stop (%)" note="0 = disabled">
            <input type="number" min={0} max={100} value={maxDd}
              onChange={e => setMaxDd(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="border-t border-slate-800 pt-3 flex flex-col gap-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Date Range</p>

          <Field label="From">
            <input type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)} className={inputCls} />
          </Field>

          <Field label="To">
            <input type="date" value={endDate}
              onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <button
          onClick={handleRun}
          disabled={computing}
          className="mt-2 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded px-4 py-2.5 transition-colors"
        >
          {computing
            ? <><Loader2 size={13} className="animate-spin" /> Computing…</>
            : <><Play size={13} /> Run Backtest</>
          }
        </button>

        {error && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded p-2">{error}</p>
        )}
      </aside>

      {/* ── Results area ────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
        {!s && !computing && (
          <div className="flex items-center justify-center h-full text-slate-600 text-sm">
            Configure parameters and click Run Backtest.
          </div>
        )}

        {computing && (
          <div className="flex items-center justify-center h-full gap-2 text-slate-500 text-sm">
            <Loader2 size={18} className="animate-spin" /> Running backtest…
          </div>
        )}

        {s && (
          <>
            {s.stoppedEarly && (
              <div className="bg-red-900/30 border border-red-800 text-red-300 text-xs rounded px-3 py-2">
                ⚠ Drawdown circuit-breaker triggered — trading halted after {s.numTrades} trades.
              </div>
            )}

            {/* ── Summary stat cards ────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                label="Total Return"
                value={`${s.totalReturn >= 0 ? '+' : ''}$${s.totalReturn.toFixed(0)}`}
                sub={`${s.totalReturnPct >= 0 ? '+' : ''}${s.totalReturnPct.toFixed(1)}%`}
                color={green(s.totalReturn)}
              />
              <Stat label="Trades" value={String(s.numTrades)} sub={`${s.numWins}W / ${s.numLosses}L`} />
              <Stat label="Win Rate" value={`${s.winRate.toFixed(1)}%`} sub={`Expect $${s.expectancy.toFixed(0)}/trade`} color={green(s.winRate - 50)} />
              <Stat label="Profit Factor" value={s.profitFactor > 100 ? '∞' : s.profitFactor.toFixed(2)} color={green(s.profitFactor - 1)} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                label="Max Drawdown"
                value={`-${s.maxDrawdownPct.toFixed(1)}%`}
                sub={`-$${s.maxDrawdown.toFixed(0)}`}
                color="text-red-400"
              />
              <Stat label="Avg Win" value={`+$${s.avgWin.toFixed(0)}`} color="text-green-400" />
              <Stat label="Avg Loss" value={`-$${s.avgLoss.toFixed(0)}`} color="text-red-400" />
              <Stat
                label="Consec. W / L"
                value={`${s.maxConsecWins} / ${s.maxConsecLosses}`}
                sub={`Avg hold ${s.avgHoldingBars.toFixed(0)} bars`}
              />
            </div>

            {/* End capital */}
            <div className="flex items-center gap-6 text-xs text-slate-500 font-mono">
              <span>Start <span className="text-white">${s.startCapital.toLocaleString()}</span></span>
              <span>→</span>
              <span>End <span className={`font-bold ${green(s.totalReturn)}`}>${s.endCapital.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</span></span>
            </div>

            {/* ── Equity curve ──────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Equity Curve</p>
              <EquityCurve curve={s.equityCurve} startCapital={s.startCapital} />
            </div>

            {/* ── Trade history ─────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Trade History ({s.numTrades})
              </p>
              <TradeTable trades={s.trades} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
