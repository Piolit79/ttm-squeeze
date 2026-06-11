export interface OHLCBar {
  t: number;
  o: number; h: number; l: number; c: number; v: number;
}

export interface IndicatorBar {
  t: number;
  squeezeDot: 'orange' | 'red' | 'black' | 'green';
  momentum: number | null;
  momentumColor: 'cyan' | 'blue' | 'yellow' | 'red_m' | null;
  squeezeOn: boolean;
  squeezeHigh: boolean;
}

export interface TTMOpts {
  length: number;
  bbMult: number;
  kcHigh: number;
  kcMid: number;
  kcLow: number;
}

const DEFAULT_OPTS: TTMOpts = { length: 20, bbMult: 2.0, kcHigh: 1.0, kcMid: 1.5, kcLow: 2.0 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function rollingMean(src: number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

function rollingStdPop(src: number[], len: number, mean: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  for (let i = len - 1; i < src.length; i++) {
    if (mean[i] === null) continue;
    let v = 0;
    for (let j = i - len + 1; j <= i; j++) v += (src[j] - (mean[i] as number)) ** 2;
    out[i] = Math.sqrt(v / len);
  }
  return out;
}

function ema(src: number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  const k = 2 / (len + 1);
  let prev: number | null = null;
  for (let i = 0; i < src.length; i++) {
    if (prev === null) { prev = src[i]; out[i] = src[i]; }
    else { prev = src[i] * k + prev * (1 - k); out[i] = prev; }
  }
  return out;
}

function wilderAtr(high: number[], low: number[], close: number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(high.length).fill(null);
  const tr: number[] = [high[0] - low[0]];
  for (let i = 1; i < high.length; i++) {
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  if (tr.length < len) return out;
  let atr = tr.slice(0, len).reduce((a, b) => a + b, 0) / len;
  out[len - 1] = atr;
  for (let i = len; i < tr.length; i++) {
    atr = (atr * (len - 1) + tr[i]) / len;
    out[i] = atr;
  }
  return out;
}

function rollingMax(src: number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  for (let i = len - 1; i < src.length; i++) {
    let m = -Infinity;
    for (let j = i - len + 1; j <= i; j++) m = Math.max(m, src[j]);
    out[i] = m;
  }
  return out;
}

function rollingMin(src: number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  for (let i = len - 1; i < src.length; i++) {
    let m = Infinity;
    for (let j = i - len + 1; j <= i; j++) m = Math.min(m, src[j]);
    out[i] = m;
  }
  return out;
}

function linreg(src: (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  for (let i = len - 1; i < src.length; i++) {
    const slice = src.slice(i - len + 1, i + 1);
    if (slice.some(v => v === null)) continue;
    const y = slice as number[];
    const xm = (len - 1) / 2;
    const ym = y.reduce((a, b) => a + b, 0) / len;
    let num = 0, den = 0;
    for (let j = 0; j < len; j++) { num += (j - xm) * (y[j] - ym); den += (j - xm) ** 2; }
    const slope = num / den;
    out[i] = slope * (len - 1) + (ym - slope * xm);
  }
  return out;
}

// ── Main compute ───────────────────────────────────────────────────────────────

export function computeTTM(bars: OHLCBar[], opts: TTMOpts = DEFAULT_OPTS): IndicatorBar[] {
  const { length: LEN, bbMult, kcHigh, kcMid, kcLow } = opts;
  const close = bars.map(b => b.c);
  const high  = bars.map(b => b.h);
  const low   = bars.map(b => b.l);

  const bbMid = rollingMean(close, LEN);
  const bbStd = rollingStdPop(close, LEN, bbMid);
  const bbUp  = bbMid.map((m, i) => m !== null && bbStd[i] !== null ? m + bbMult * (bbStd[i] as number) : null);
  const bbDn  = bbMid.map((m, i) => m !== null && bbStd[i] !== null ? m - bbMult * (bbStd[i] as number) : null);

  const kcMidArr = ema(close, LEN);
  const atrArr   = wilderAtr(high, low, close, LEN);
  const kcHiUp = kcMidArr.map((m, i) => m !== null && atrArr[i] !== null ? m + kcHigh * (atrArr[i] as number) : null);
  const kcHiDn = kcMidArr.map((m, i) => m !== null && atrArr[i] !== null ? m - kcHigh * (atrArr[i] as number) : null);
  const kcMiUp = kcMidArr.map((m, i) => m !== null && atrArr[i] !== null ? m + kcMid  * (atrArr[i] as number) : null);
  const kcMiDn = kcMidArr.map((m, i) => m !== null && atrArr[i] !== null ? m - kcMid  * (atrArr[i] as number) : null);
  const kcLoUp = kcMidArr.map((m, i) => m !== null && atrArr[i] !== null ? m + kcLow  * (atrArr[i] as number) : null);
  const kcLoDn = kcMidArr.map((m, i) => m !== null && atrArr[i] !== null ? m - kcLow  * (atrArr[i] as number) : null);

  const donHi  = rollingMax(high, LEN);
  const donLo  = rollingMin(low,  LEN);
  const donMid = donHi.map((h, i) => h !== null && donLo[i] !== null ? (h + (donLo[i] as number)) / 2 : null);
  const delta  = close.map((c, i) => {
    const bm = bbMid[i]; const dm = donMid[i];
    if (bm === null || dm === null) return null;
    return c - (dm + bm) / 2;
  });
  const mom = linreg(delta, LEN);

  return bars.map((b, i) => {
    const bu = bbUp[i]; const bd = bbDn[i];
    const hU = kcHiUp[i]; const hD = kcHiDn[i];
    const mU = kcMiUp[i]; const mD = kcMiDn[i];
    const lU = kcLoUp[i]; const lD = kcLoDn[i];

    let squeezeDot: IndicatorBar['squeezeDot'] = 'green';
    let squeezeOn = false;
    let squeezeHigh = false;

    if (bu !== null && bd !== null && hU !== null && hD !== null) {
      const inHigh = bu < hU && bd > hD;
      const inMid  = bu < (mU as number) && bd > (mD as number);
      const inLow  = bu < (lU as number) && bd > (lD as number);
      squeezeHigh = inHigh;
      squeezeOn   = inLow;
      squeezeDot  = inHigh ? 'orange' : inMid ? 'red' : inLow ? 'black' : 'green';
    }

    const m    = mom[i];
    const mPrv = i > 0 ? mom[i - 1] : null;
    let momentumColor: IndicatorBar['momentumColor'] = null;
    if (m !== null && mPrv !== null) {
      if (m >= 0) momentumColor = m > mPrv ? 'cyan' : 'blue';
      else        momentumColor = m < mPrv ? 'red_m' : 'yellow';
    }

    return { t: b.t, squeezeDot, momentum: m, momentumColor, squeezeOn, squeezeHigh };
  });
}

export function momentumCrossedZeroUp(ind: IndicatorBar[], i: number): boolean {
  if (i < 1) return false;
  const cur = ind[i].momentum; const prv = ind[i - 1].momentum;
  return cur !== null && prv !== null && cur > 0 && prv <= 0;
}

export function swingLow(bars: OHLCBar[], i: number, lookback = 20): number {
  const start = Math.max(0, i - lookback + 1);
  return Math.min(...bars.slice(start, i + 1).map(b => b.l));
}
