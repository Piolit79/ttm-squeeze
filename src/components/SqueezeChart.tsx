/**
 * SqueezeChart
 *
 * Renders a two-pane chart for one ticker + timeframe:
 *   Pane 1 (top)    — candlestick price + signal arrows (buy = green up, exit = red down)
 *   Pane 2 (bottom) — TTM Squeeze Pro momentum histogram + squeeze dot markers
 *
 * Visual spec matches screenshot #13 (LLY daily, TradingView):
 *   Histogram colors: cyan (↑+), blue (↓+), yellow (↓−), red (↑−)
 *   Dot colors: orange (high), red (mid), black (low), green (fired)
 */
import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  CrosshairMode,
} from "lightweight-charts";
import type { Bar, Signal } from "../lib/api";

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

interface Props {
  bars: Bar[];
  signals: Signal[];
  ticker?: string;
  timeframe?: string;
  height?: number;
}

export default function SqueezeChart({ bars, signals, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    // ── Chart setup ────────────────────────────────────────────────────────
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: "#0f1117" },
        textColor:  "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e2330" },
        horzLines: { color: "#1e2330" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2e3347" },
      timeScale: { borderColor: "#2e3347", timeVisible: true },
    });
    chartRef.current = chart;

    // ── Pane 1: Candlesticks ───────────────────────────────────────────────
    const candleSeries = chart.addCandlestickSeries({
      upColor:          "#22c55e",
      downColor:        "#ef4444",
      borderUpColor:    "#22c55e",
      borderDownColor:  "#ef4444",
      wickUpColor:      "#22c55e",
      wickDownColor:    "#ef4444",
    });

    const candleData: CandlestickData[] = bars.map(b => ({
      time:  b.t as Time,
      open:  b.o,
      high:  b.h,
      low:   b.l,
      close: b.c,
    }));
    candleSeries.setData(candleData);

    // ── Signal arrows on price chart ───────────────────────────────────────
    if (signals.length > 0) {
      const markerData = signals.map(s => {
        const t = Math.floor(new Date(s.bar_time).getTime() / 1000) as Time;
        return {
          time:     t,
          position: "belowBar" as const,
          color:    "#22c55e",
          shape:    "arrowUp" as const,
          text:     `B ${s.entry_price.toFixed(2)}`,
          size:     1,
        };
      });
      candleSeries.setMarkers(markerData);
    }

    // ── Pane 2: Momentum histogram ─────────────────────────────────────────
    const histoPane = chart.addHistogramSeries({
      priceScaleId: "momentum",
      pane:         1,
      color:        "#06b6d4",
    } as any);

    const histoData: HistogramData[] = bars
      .filter(b => b.momentum !== null)
      .map(b => ({
        time:  b.t as Time,
        value: b.momentum as number,
        color: MOM_COLOR[b.momentum_color ?? "cyan"] ?? "#06b6d4",
      }));
    histoData && histoPane.setData(histoData);

    // ── Squeeze dots on zero line (rendered as histogram with height ±0.001) ─
    // We overlay a second histogram series with tiny bars colored by dot state.
    // Dots are drawn as thin markers just above/below zero.
    const dotSeries = chart.addHistogramSeries({
      priceScaleId: "momentum",
      pane:         1,
      color:        "#22c55e",
      base:         0,
    } as any);

    const dotData = bars
      .filter(b => b.squeeze_dot)
      .map(b => ({
        time:  b.t as Time,
        value: b.squeeze_dot === "green" ? 0.001 : -0.001,  // tiny tick on zero line
        color: DOT_COLOR[b.squeeze_dot] ?? "#22c55e",
      }));
    dotSeries.setData(dotData as any);

    // ── Zero line on histogram pane ────────────────────────────────────────
    const zeroLine = chart.addLineSeries({
      priceScaleId: "momentum",
      pane:         1,
      color:        "#334155",
      lineWidth:    1,
      lastValueVisible:  false,
      priceLineVisible:  false,
      crosshairMarkerVisible: false,
    } as any);
    zeroLine.setData(bars.map(b => ({ time: b.t as Time, value: 0 })));

    // ── Responsive resize ──────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    chart.timeScale().fitContent();

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, signals, height]);

  return <div ref={containerRef} className="w-full rounded overflow-hidden" style={{ height }} />;
}
