import { computeTTM, momentumCrossedZeroUp, swingLow } from './ttm';
import type { OHLCBar, IndicatorBar, TTMOpts } from './ttm';
import type { Bar } from './api';

// ── Config ─────────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  startCapital: number;
  riskPct:      number;   // % of current equity to risk per trade (sets position size)
  commission:   number;   // $ per side (applied on entry and exit)
  slippage:     number;   // $ per share slippage (applied on entry)
  maxDrawdownPct: number; // circuit-breaker: stop trading if drawdown exceeds this %
  startTs:      number;   // unix seconds (inclusive)
  endTs:        number;   // unix seconds (inclusive)
  opts:         TTMOpts;
}

// ── Results ────────────────────────────────────────────────────────────────────

export interface TradeRecord {
  id:           number;
  entryDate:    string;
  entryPrice:   number;
  stopPrice:    number;
  targetPrice:  number;
  exitDate:     string;
  exitPrice:    number;
  exitReason:   'target' | 'stop' | 'open';
  shares:       number;
  grossPnl:     number;   // before commission/slippage
  pnl:          number;   // net P&L
  pnlPct:       number;   // % return on capital deployed
  equity:       number;   // portfolio equity after trade
  holdingBars:  number;
}

export interface BacktestStats {
  startCapital:    number;
  endCapital:      number;
  totalReturn:     number;    // $
  totalReturnPct:  number;    // %
  numTrades:       number;
  numWins:         number;
  numLosses:       number;
  winRate:         number;    // %
  avgWin:          number;    // $ net per winning trade
  avgLoss:         number;    // $ net per losing trade
  profitFactor:    number;    // gross wins / gross losses
  maxDrawdown:     number;    // $ peak-to-trough
  maxDrawdownPct:  number;    // %
  maxConsecWins:   number;
  maxConsecLosses: number;
  avgHoldingBars:  number;
  expectancy:      number;    // avg $ per trade (wins + losses combined)
  stoppedEarly:    boolean;   // hit drawdown circuit-breaker
  equityCurve:     { t: number; equity: number }[];
  trades:          TradeRecord[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function alignDailyToIntraday(bars: Bar[], ind1d: IndicatorBar[]): (IndicatorBar | null)[] {
  const dayMap = new Map<string, IndicatorBar>();
  for (const b of ind1d) {
    const day = new Date(b.t * 1000).toISOString().slice(0, 10);
    dayMap.set(day, b);
  }
  const out: (IndicatorBar | null)[] = [];
  let last: IndicatorBar | null = null;
  for (const b of bars) {
    const prev = new Date((b.t - 86_400) * 1000).toISOString().slice(0, 10);
    if (dayMap.has(prev)) last = dayMap.get(prev)!;
    out.push(last);
  }
  return out;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

export function runBacktest(
  bars1h: Bar[],
  bars1d: Bar[],
  cfg: BacktestConfig,
): BacktestStats {
  const ind1h  = computeTTM(bars1h as OHLCBar[], cfg.opts);
  const ind1d  = computeTTM(bars1d as OHLCBar[], cfg.opts);
  const daily  = alignDailyToIntraday(bars1h, ind1d);

  let equity     = cfg.startCapital;
  let peakEquity = equity;
  let maxDd      = 0;
  let maxDdPct   = 0;
  let stoppedEarly = false;

  const trades: TradeRecord[] = [];
  const equityCurve: { t: number; equity: number }[] = [
    { t: cfg.startTs, equity },
  ];

  let i = 1;
  while (i < bars1h.length && !stoppedEarly) {
    const bar = bars1h[i];

    if (bar.t < cfg.startTs) { i++; continue; }
    if (bar.t > cfg.endTs)   { break; }

    // ── Signal ───────────────────────────────────────────────────────────────
    if (!momentumCrossedZeroUp(ind1h, i)) { i++; continue; }
    const d = daily[i];
    if (!d || d.momentum === null || d.momentum <= 0) { i++; continue; }

    const entry = bar.c + cfg.slippage;               // slippage on entry
    const stop  = swingLow(bars1h as OHLCBar[], i, 20);
    const risk  = entry - stop;
    if (risk <= 0 || risk / entry > 0.25) { i++; continue; } // skip crazy-wide stops

    const target = entry + 2 * risk;

    // ── Position size: risk fixed-fraction ───────────────────────────────────
    const dollarRisk = equity * (cfg.riskPct / 100);
    const shares = Math.floor(dollarRisk / risk);
    if (shares < 1) { i++; continue; }
    if (shares * entry + cfg.commission > equity) { i++; continue; } // can't afford

    // ── Forward scan for exit ─────────────────────────────────────────────────
    let exitIdx    = -1;
    let exitReason: TradeRecord['exitReason'] = 'open';
    let exitPrice  = bar.c;

    for (let j = i + 1; j < bars1h.length && bars1h[j].t <= cfg.endTs; j++) {
      if (bars1h[j].h >= target) {
        exitIdx = j; exitReason = 'target'; exitPrice = target; break;
      }
      if (bars1h[j].l <= stop) {
        exitIdx = j; exitReason = 'stop'; exitPrice = stop - cfg.slippage; break;
      }
    }

    const holdingBars = exitIdx > 0 ? exitIdx - i : bars1h.length - 1 - i;
    const gross = shares * (exitPrice - bar.c);              // before costs
    const pnl   = shares * (exitPrice - entry) - 2 * cfg.commission;

    equity += pnl;

    // ── Drawdown tracking ─────────────────────────────────────────────────────
    if (equity > peakEquity) peakEquity = equity;
    const dd    = peakEquity - equity;
    const ddPct = (dd / peakEquity) * 100;
    if (dd > maxDd)       maxDd    = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;

    const exitT = exitIdx > 0 ? bars1h[exitIdx].t : bars1h[bars1h.length - 1].t;
    equityCurve.push({ t: exitT, equity });

    trades.push({
      id:          trades.length + 1,
      entryDate:   new Date(bar.t * 1000).toISOString(),
      entryPrice:  entry,
      stopPrice:   stop,
      targetPrice: target,
      exitDate:    exitIdx > 0
                     ? new Date(bars1h[exitIdx].t * 1000).toISOString()
                     : 'Open',
      exitPrice,
      exitReason,
      shares,
      grossPnl:    gross,
      pnl,
      pnlPct:      (pnl / (shares * bar.c)) * 100,
      equity,
      holdingBars,
    });

    // ── Circuit breaker ───────────────────────────────────────────────────────
    if (cfg.maxDrawdownPct > 0 && ddPct >= cfg.maxDrawdownPct) {
      stoppedEarly = true;
    }

    i = exitIdx > 0 ? exitIdx + 1 : i + 1;
  }

  // ── Aggregate stats ───────────────────────────────────────────────────────────
  const wins       = trades.filter(t => t.pnl > 0);
  const losses     = trades.filter(t => t.pnl <= 0);
  const grossWin   = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  let maxCW = 0, maxCL = 0, cw = 0, cl = 0;
  for (const t of trades) {
    if (t.pnl > 0) { cw++; cl = 0; if (cw > maxCW) maxCW = cw; }
    else            { cl++; cw = 0; if (cl > maxCL) maxCL = cl; }
  }

  const avgHolding = trades.length > 0
    ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length
    : 0;

  return {
    startCapital:    cfg.startCapital,
    endCapital:      equity,
    totalReturn:     equity - cfg.startCapital,
    totalReturnPct:  ((equity - cfg.startCapital) / cfg.startCapital) * 100,
    numTrades:       trades.length,
    numWins:         wins.length,
    numLosses:       losses.length,
    winRate:         trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    avgWin:          wins.length   > 0 ? grossWin  / wins.length   : 0,
    avgLoss:         losses.length > 0 ? grossLoss / losses.length : 0,
    profitFactor:    grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0,
    maxDrawdown:     maxDd,
    maxDrawdownPct:  maxDdPct,
    maxConsecWins:   maxCW,
    maxConsecLosses: maxCL,
    avgHoldingBars:  avgHolding,
    expectancy:      trades.length > 0
                       ? (grossWin - grossLoss) / trades.length
                       : 0,
    stoppedEarly,
    equityCurve,
    trades,
  };
}
