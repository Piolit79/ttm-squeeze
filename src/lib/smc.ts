import type { OHLCBar } from './ttm';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SMCOpts {
  swingsLength:    number;   // default 50 — window for swing pivots
  showInternals:   boolean;
  showSwings:      boolean;
  showOrderBlocks: boolean;
  internalObCount: number;   // max internal OBs to keep
  swingObCount:    number;   // max swing OBs to keep
  showFVGs:        boolean;
  showHighLow:     boolean;
}

export const DEFAULT_SMC_OPTS: SMCOpts = {
  swingsLength:    50,
  showInternals:   true,
  showSwings:      true,
  showOrderBlocks: true,
  internalObCount: 5,
  swingObCount:    5,
  showFVGs:        true,
  showHighLow:     true,
};

export type Bias = 'bullish' | 'bearish';

export interface StructureEvent {
  type:       'BOS' | 'CHoCH';
  bias:       Bias;
  level:      number;
  fromTime:   number;  // unix seconds — pivot bar
  toTime:     number;  // unix seconds — break bar
  internal:   boolean;
}

export interface OrderBlock {
  top:      number;
  bottom:   number;
  time:     number;  // bar timestamp (left edge)
  bias:     Bias;
  internal: boolean;
  active:   boolean; // false = mitigated (price ran through it)
}

export interface FVG {
  top:    number;
  bottom: number;
  bias:   Bias;
  time:   number;  // middle bar timestamp (left edge of gap)
  active: boolean;
}

export interface HighLow {
  strongHigh:     number;
  strongHighTime: number;
  weakHigh:       number;
  weakHighTime:   number;
  strongLow:      number;
  strongLowTime:  number;
  weakLow:        number;
  weakLowTime:    number;
}

export interface SMCResult {
  swingStructure:    StructureEvent[];
  internalStructure: StructureEvent[];
  swingOBs:          OrderBlock[];
  internalOBs:       OrderBlock[];
  fvgs:              FVG[];
  highLow:           HighLow | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function wilderATR(bars: OHLCBar[]): number[] {
  const n = bars.length;
  const atr = new Array(n).fill(0);
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    );
    if (i <= 200) {
      sum += tr;
      atr[i] = sum / i;
    } else {
      atr[i] = atr[i - 1] * (199 / 200) + tr / 200;
    }
  }
  return atr;
}

// Is bars[i - size] a pivot HIGH? (its high exceeds all of bars[i-size+1 .. i])
function isPivotHigh(bars: OHLCBar[], i: number, size: number): boolean {
  if (i < size) return false;
  const ph = bars[i - size].h;
  for (let k = i - size + 1; k <= i; k++) {
    if (bars[k].h >= ph) return false;
  }
  return true;
}

// Is bars[i - size] a pivot LOW?
function isPivotLow(bars: OHLCBar[], i: number, size: number): boolean {
  if (i < size) return false;
  const pl = bars[i - size].l;
  for (let k = i - size + 1; k <= i; k++) {
    if (bars[k].l <= pl) return false;
  }
  return true;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

export function computeSMC(bars: OHLCBar[], opts: SMCOpts): SMCResult {
  const n = bars.length;
  const EMPTY: SMCResult = {
    swingStructure: [], internalStructure: [],
    swingOBs: [], internalOBs: [], fvgs: [], highLow: null,
  };
  if (n < opts.swingsLength + 5) return EMPTY;

  const atr = wilderATR(bars);

  // Parsed highs/lows for order-block finding (high-vol bars are inverted)
  const ph = new Array(n).fill(0);  // parsedHighs
  const pl = new Array(n).fill(0);  // parsedLows
  for (let i = 0; i < n; i++) {
    const hv = (bars[i].h - bars[i].l) >= 2 * atr[i];
    ph[i] = hv ? bars[i].l : bars[i].h;
    pl[i] = hv ? bars[i].h : bars[i].l;
  }

  // ── State: swing pivots ──────────────────────────────────────────────────────
  let swingLeg = 0;
  let sHighLv = NaN, sHighT = 0, sHighIdx = 0, sHighX = false;
  let sLowLv  = NaN, sLowT  = 0, sLowIdx  = 0, sLowX  = false;
  let swingTrend = 0;  // +1 bullish, -1 bearish

  // ── State: internal pivots (size=5) ─────────────────────────────────────────
  let intLeg = 0;
  let iHighLv = NaN, iHighT = 0, iHighIdx = 0, iHighX = false;
  let iLowLv  = NaN, iLowT  = 0, iLowIdx  = 0, iLowX  = false;
  let intTrend = 0;

  // ── State: trailing extremes (for strong/weak high/low) ─────────────────────
  let trHigh = -Infinity, trHighT = 0;
  let trLow  =  Infinity, trLowT  = 0;

  const swingStructure:    StructureEvent[] = [];
  const internalStructure: StructureEvent[] = [];
  const swingOBs:          OrderBlock[]     = [];
  const internalOBs:       OrderBlock[]     = [];
  const fvgs:              FVG[]            = [];

  const INT_SIZE   = 5;
  const SWING_SIZE = opts.swingsLength;
  const start = Math.max(SWING_SIZE, INT_SIZE) + 1;

  for (let i = start; i < n; i++) {
    const bar = bars[i];

    // ── Trailing extremes ──────────────────────────────────────────────────────
    if (bar.h >= trHigh) { trHigh = bar.h; trHighT = bar.t; }
    if (bar.l <= trLow)  { trLow  = bar.l; trLowT  = bar.t; }

    // ── Swing pivot detection ──────────────────────────────────────────────────
    const prevSL = swingLeg;
    if      (isPivotHigh(bars, i, SWING_SIZE)) swingLeg = 0;
    else if (isPivotLow( bars, i, SWING_SIZE)) swingLeg = 1;

    if (prevSL === 1 && swingLeg === 0) {
      // Pivot HIGH confirmed at bars[i - SWING_SIZE]
      sHighLv = bars[i - SWING_SIZE].h;
      sHighT  = bars[i - SWING_SIZE].t;
      sHighIdx = i - SWING_SIZE;
      sHighX  = false;
    } else if (prevSL === 0 && swingLeg === 1) {
      // Pivot LOW confirmed at bars[i - SWING_SIZE]
      sLowLv  = bars[i - SWING_SIZE].l;
      sLowT   = bars[i - SWING_SIZE].t;
      sLowIdx = i - SWING_SIZE;
      sLowX   = false;
    }

    // ── Internal pivot detection ───────────────────────────────────────────────
    const prevIL = intLeg;
    if      (isPivotHigh(bars, i, INT_SIZE)) intLeg = 0;
    else if (isPivotLow( bars, i, INT_SIZE)) intLeg = 1;

    if (prevIL === 1 && intLeg === 0) {
      iHighLv  = bars[i - INT_SIZE].h;
      iHighT   = bars[i - INT_SIZE].t;
      iHighIdx = i - INT_SIZE;
      iHighX   = false;
    } else if (prevIL === 0 && intLeg === 1) {
      iLowLv   = bars[i - INT_SIZE].l;
      iLowT    = bars[i - INT_SIZE].t;
      iLowIdx  = i - INT_SIZE;
      iLowX    = false;
    }

    // ── Mitigate order blocks (price runs through them) ────────────────────────
    for (const ob of swingOBs) {
      if (!ob.active) continue;
      if (ob.bias === 'bearish' && bar.h > ob.top)    ob.active = false;
      if (ob.bias === 'bullish' && bar.l < ob.bottom) ob.active = false;
    }
    for (const ob of internalOBs) {
      if (!ob.active) continue;
      if (ob.bias === 'bearish' && bar.h > ob.top)    ob.active = false;
      if (ob.bias === 'bullish' && bar.l < ob.bottom) ob.active = false;
    }

    // ── Mitigate FVGs ──────────────────────────────────────────────────────────
    for (const fvg of fvgs) {
      if (!fvg.active) continue;
      if (fvg.bias === 'bullish' && bar.l < fvg.bottom) fvg.active = false;
      if (fvg.bias === 'bearish' && bar.h > fvg.top)    fvg.active = false;
    }

    // ── Swing BOS / CHoCH ──────────────────────────────────────────────────────
    if (!isNaN(sHighLv) && !sHighX && bar.c > sHighLv) {
      const type = swingTrend === -1 ? 'CHoCH' : 'BOS';
      swingStructure.push({ type, bias: 'bullish', level: sHighLv, fromTime: sHighT, toTime: bar.t, internal: false });
      sHighX = true;
      swingTrend = 1;
      if (opts.showOrderBlocks) {
        let minPL = Infinity, obIdx = sHighIdx;
        for (let k = sHighIdx; k < i; k++) { if (pl[k] < minPL) { minPL = pl[k]; obIdx = k; } }
        swingOBs.unshift({ top: ph[obIdx], bottom: pl[obIdx], time: bars[obIdx].t, bias: 'bullish', internal: false, active: true });
      }
    }

    if (!isNaN(sLowLv) && !sLowX && bar.c < sLowLv) {
      const type = swingTrend === 1 ? 'CHoCH' : 'BOS';
      swingStructure.push({ type, bias: 'bearish', level: sLowLv, fromTime: sLowT, toTime: bar.t, internal: false });
      sLowX = true;
      swingTrend = -1;
      if (opts.showOrderBlocks) {
        let maxPH = -Infinity, obIdx = sLowIdx;
        for (let k = sLowIdx; k < i; k++) { if (ph[k] > maxPH) { maxPH = ph[k]; obIdx = k; } }
        swingOBs.unshift({ top: ph[obIdx], bottom: pl[obIdx], time: bars[obIdx].t, bias: 'bearish', internal: false, active: true });
      }
    }

    // ── Internal BOS / CHoCH ──────────────────────────────────────────────────
    // Confluence filter: skip if internal level == swing level
    if (!isNaN(iHighLv) && !iHighX && iHighLv !== sHighLv && bar.c > iHighLv) {
      const type = intTrend === -1 ? 'CHoCH' : 'BOS';
      internalStructure.push({ type, bias: 'bullish', level: iHighLv, fromTime: iHighT, toTime: bar.t, internal: true });
      iHighX = true;
      intTrend = 1;
      if (opts.showOrderBlocks) {
        let minPL = Infinity, obIdx = iHighIdx;
        for (let k = iHighIdx; k < i; k++) { if (pl[k] < minPL) { minPL = pl[k]; obIdx = k; } }
        internalOBs.unshift({ top: ph[obIdx], bottom: pl[obIdx], time: bars[obIdx].t, bias: 'bullish', internal: true, active: true });
      }
    }

    if (!isNaN(iLowLv) && !iLowX && iLowLv !== sLowLv && bar.c < iLowLv) {
      const type = intTrend === 1 ? 'CHoCH' : 'BOS';
      internalStructure.push({ type, bias: 'bearish', level: iLowLv, fromTime: iLowT, toTime: bar.t, internal: true });
      iLowX = true;
      intTrend = -1;
      if (opts.showOrderBlocks) {
        let maxPH = -Infinity, obIdx = iLowIdx;
        for (let k = iLowIdx; k < i; k++) { if (ph[k] > maxPH) { maxPH = ph[k]; obIdx = k; } }
        internalOBs.unshift({ top: ph[obIdx], bottom: pl[obIdx], time: bars[obIdx].t, bias: 'bearish', internal: true, active: true });
      }
    }

    // ── Fair Value Gaps ────────────────────────────────────────────────────────
    if (opts.showFVGs && i >= 2) {
      const b0 = bars[i], b1 = bars[i - 1], b2 = bars[i - 2];
      if (b0.l > b2.h) fvgs.push({ top: b0.l, bottom: b2.h, bias: 'bullish', time: b1.t, active: true });
      if (b0.h < b2.l) fvgs.push({ top: b2.l, bottom: b0.h, bias: 'bearish', time: b1.t, active: true });
    }
  }

  // ── Build HighLow from trailing extremes + trend ──────────────────────────────
  let highLow: HighLow | null = null;
  if (opts.showHighLow && n > 0) {
    // Strong = in direction of trend; Weak = against trend
    const strongH = swingTrend === -1;
    const strongL = swingTrend === 1;
    highLow = {
      strongHigh:     strongH ? trHigh : NaN,
      strongHighTime: strongH ? trHighT : 0,
      weakHigh:       !strongH ? trHigh : NaN,
      weakHighTime:   !strongH ? trHighT : 0,
      strongLow:      strongL ? trLow : NaN,
      strongLowTime:  strongL ? trLowT : 0,
      weakLow:        !strongL ? trLow : NaN,
      weakLowTime:    !strongL ? trLowT : 0,
    };
  }

  return {
    swingStructure,
    internalStructure,
    swingOBs:   swingOBs.slice(0, opts.swingObCount * 4),
    internalOBs: internalOBs.slice(0, opts.internalObCount * 4),
    fvgs:       fvgs.slice(-50),  // keep most recent 50
    highLow,
  };
}
