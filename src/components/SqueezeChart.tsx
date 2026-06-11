/**
 * SqueezeChart — two stacked charts with synchronized time scales:
 *   Top pane:    candlestick + buy/exit arrows + SMC overlay
 *   Bottom pane: TTM momentum histogram + squeeze dot markers
 */
import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type Time,
  CrosshairMode,
} from "lightweight-charts";
import type { Bar, Signal } from "../lib/api";
import { computeTTM, type TTMOpts, type OHLCBar } from "../lib/ttm";
import { computeSMC, type SMCOpts } from "../lib/smc";
import { SMCPrimitive, type SMCDrawData } from "./SMCPrimitive";

const DOT_COLOR: Record<string, string> = {
  orange: "#f97316",
  red:    "#ef4444",
  black:  "#64748b",
  green:  "#22c55e",
};

const MOM_COLOR: Record<string, string> = {
  cyan:  "#06b6d4",
  blue:  "#3b82f6",
  yellow:"#eab308",
  red_m: "#ef4444",
};

const CHART_BASE: Parameters<typeof createChart>[1] = {
  layout: { background: { color: "#0f1117" }, textColor: "#94a3b8" },
  grid:   { vertLines: { color: "#1e2330" }, horzLines: { color: "#1e2330" } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: "#2e3347" },
  handleScroll: { mouseWheel: true, pressedMouseMove: true },
  handleScale:  { mouseWheel: true, pinch: true },
};

interface ExitMarker { time: number; type: 'target' | 'stop'; price: number }

function findExits(bars: Bar[], signals: Signal[]): ExitMarker[] {
  const exits: ExitMarker[] = [];
  for (const sig of signals) {
    const sigT   = Math.floor(new Date(sig.bar_time).getTime() / 1000);
    const sigIdx = bars.findIndex(b => b.t === sigT);
    if (sigIdx < 0) continue;
    for (let i = sigIdx + 1; i < bars.length; i++) {
      if (bars[i].h >= sig.target_price) {
        exits.push({ time: bars[i].t, type: 'target', price: sig.target_price });
        break;
      }
      if (bars[i].l <= sig.stop_price) {
        exits.push({ time: bars[i].t, type: 'stop', price: sig.stop_price });
        break;
      }
    }
  }
  return exits;
}

interface Props {
  bars:        Bar[];
  signals:     Signal[];
  opts:        TTMOpts;
  smcOpts?:    SMCOpts;
  priceHeight?: number;
  momHeight?:   number;
}

export default function SqueezeChart({
  bars, signals, opts, smcOpts,
  priceHeight = 320, momHeight = 160,
}: Props) {
  const priceRef  = useRef<HTMLDivElement>(null);
  const momRef    = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<{ p: IChartApi; m: IChartApi } | null>(null);

  useEffect(() => {
    if (!priceRef.current || !momRef.current || bars.length === 0) return;

    const ind   = computeTTM(bars as OHLCBar[], opts);
    const exits = findExits(bars, signals);

    // ── Price chart (top) ─────────────────────────────────────────────────────
    const pc = createChart(priceRef.current, {
      ...CHART_BASE,
      width:  priceRef.current.clientWidth,
      height: priceHeight,
      timeScale: { borderColor: "#2e3347", timeVisible: false },
    });

    const candle = pc.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });
    candle.setData(bars.map(b => ({
      time: b.t as Time, open: b.o, high: b.h, low: b.l, close: b.c,
    })));

    // ── SMC overlay ───────────────────────────────────────────────────────────
    if (smcOpts) {
      const smc     = computeSMC(bars as OHLCBar[], smcOpts);
      const prim    = new SMCPrimitive();
      const drawData: SMCDrawData = {
        swingOBs:     smcOpts.showOrderBlocks ? smc.swingOBs    : [],
        internalOBs:  smcOpts.showOrderBlocks ? smc.internalOBs : [],
        fvgs:         smcOpts.showFVGs        ? smc.fvgs        : [],
        swingEvts:    smcOpts.showSwings      ? smc.swingStructure    : [],
        internalEvts: smcOpts.showInternals   ? smc.internalStructure : [],
        highLow:      smcOpts.showHighLow     ? smc.highLow     : null,
        lastBarTime:  bars[bars.length - 1].t,
      };
      candle.attachPrimitive(prim);
      prim.update(drawData);

      // BOS/CHoCH markers on the price chart
      const smcMarkers = [
        ...smc.swingStructure.map(e => ({
          time:     e.toTime as Time,
          position: (e.bias === 'bullish' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
          color:    e.bias === 'bullish' ? '#089981' : '#F23645',
          shape:    (e.bias === 'bullish' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
          text:     e.type,
          size:     1,
        })),
        ...(smcOpts.showInternals ? smc.internalStructure.map(e => ({
          time:     e.toTime as Time,
          position: (e.bias === 'bullish' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
          color:    e.bias === 'bullish' ? 'rgba(8,153,129,0.7)' : 'rgba(242,54,69,0.7)',
          shape:    (e.bias === 'bullish' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
          text:     e.type,
          size:     1,
        })) : []),
      ].sort((a, b) => (a.time as number) - (b.time as number));

      // Merge with TTM buy/exit markers
      const buyMarkers = signals.map(s => ({
        time:     Math.floor(new Date(s.bar_time).getTime() / 1000) as Time,
        position: 'belowBar' as const,
        color:    "#22c55e",
        shape:    'arrowUp' as const,
        text:     `B $${s.entry_price.toFixed(2)}`,
        size:     1,
      }));
      const exitMarkers = exits.map(e => ({
        time:     e.time as Time,
        position: 'aboveBar' as const,
        color:    e.type === 'target' ? "#eab308" : "#ef4444",
        shape:    'arrowDown' as const,
        text:     e.type === 'target' ? `T $${e.price.toFixed(2)}` : `S $${e.price.toFixed(2)}`,
        size:     1,
      }));
      const allMarkers = [...buyMarkers, ...exitMarkers, ...smcMarkers]
        .sort((a, b) => (a.time as number) - (b.time as number));
      if (allMarkers.length > 0) candle.setMarkers(allMarkers);
    } else {
      // No SMC — just TTM signals
      const buyMarkers = signals.map(s => ({
        time:     Math.floor(new Date(s.bar_time).getTime() / 1000) as Time,
        position: 'belowBar' as const,
        color:    "#22c55e",
        shape:    'arrowUp' as const,
        text:     `B $${s.entry_price.toFixed(2)}`,
        size:     1,
      }));
      const exitMarkers = exits.map(e => ({
        time:     e.time as Time,
        position: 'aboveBar' as const,
        color:    e.type === 'target' ? "#eab308" : "#ef4444",
        shape:    'arrowDown' as const,
        text:     e.type === 'target' ? `T $${e.price.toFixed(2)}` : `S $${e.price.toFixed(2)}`,
        size:     1,
      }));
      const allMarkers = [...buyMarkers, ...exitMarkers]
        .sort((a, b) => (a.time as number) - (b.time as number));
      if (allMarkers.length > 0) candle.setMarkers(allMarkers);
    }

    // ── Momentum chart (bottom) ───────────────────────────────────────────────
    const mc = createChart(momRef.current, {
      ...CHART_BASE,
      width:  momRef.current.clientWidth,
      height: momHeight,
      timeScale: { borderColor: "#2e3347", timeVisible: true },
    });

    const histo = mc.addHistogramSeries({ color: "#06b6d4" });
    histo.setData(
      bars
        .map((b, i) => ({ b, i }))
        .filter(({ i }) => ind[i].momentum !== null)
        .map(({ b, i }) => ({
          time:  b.t as Time,
          value: ind[i].momentum as number,
          color: MOM_COLOR[ind[i].momentumColor ?? 'cyan'] ?? '#06b6d4',
        })),
    );

    const dots = mc.addHistogramSeries({ color: "#22c55e", base: 0 } as Parameters<typeof mc.addHistogramSeries>[0]);
    dots.setData(bars.map((b, i) => ({
      time:  b.t as Time,
      value: ind[i].squeezeDot === 'green' ? 0.001 : -0.001,
      color: DOT_COLOR[ind[i].squeezeDot],
    })));

    const zero = mc.addLineSeries({
      color: "#334155", lineWidth: 1,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    zero.setData(bars.map(b => ({ time: b.t as Time, value: 0 })));

    // ── Sync scroll/zoom ──────────────────────────────────────────────────────
    let syncing = false;
    pc.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!syncing && range !== null) { syncing = true; mc.timeScale().setVisibleLogicalRange(range); syncing = false; }
    });
    mc.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!syncing && range !== null) { syncing = true; pc.timeScale().setVisibleLogicalRange(range); syncing = false; }
    });

    pc.timeScale().fitContent();

    // ── Resize ────────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (priceRef.current) pc.applyOptions({ width: priceRef.current.clientWidth });
      if (momRef.current)   mc.applyOptions({ width: momRef.current.clientWidth });
    });
    ro.observe(priceRef.current);

    chartsRef.current = { p: pc, m: mc };

    return () => {
      ro.disconnect();
      pc.remove();
      mc.remove();
      chartsRef.current = null;
    };
  }, [bars, signals, opts.length, opts.bbMult, opts.kcHigh, opts.kcMid, opts.kcLow, priceHeight, momHeight,
      smcOpts?.swingsLength, smcOpts?.showInternals, smcOpts?.showSwings, smcOpts?.showOrderBlocks,
      smcOpts?.showFVGs, smcOpts?.showHighLow, smcOpts?.internalObCount, smcOpts?.swingObCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full">
      <div ref={priceRef} className="w-full" />
      <div className="h-px bg-slate-800" />
      <div ref={momRef} className="w-full" />
    </div>
  );
}
