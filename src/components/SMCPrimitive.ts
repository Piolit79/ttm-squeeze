/**
 * Custom lightweight-charts primitive that draws:
 *  - Filled rectangles (order blocks, fair value gaps)
 *  - Horizontal lines (structure levels, strong/weak high/low)
 */
import type { IChartApi, ISeriesApi, SeriesType, Time, ISeriesPrimitive } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { OrderBlock, FVG, StructureEvent, HighLow } from '../lib/smc';

export interface SMCDrawData {
  swingOBs:      OrderBlock[];
  internalOBs:   OrderBlock[];
  fvgs:          FVG[];
  swingEvts:     StructureEvent[];
  internalEvts:  StructureEvent[];
  highLow:       HighLow | null;
  lastBarTime:   number;
}

// ── Color palette ──────────────────────────────────────────────────────────────
const BULL_OB_SWING    = 'rgba(49,121,245,0.18)';
const BEAR_OB_SWING    = 'rgba(242,54,69,0.18)';
const BULL_OB_INT      = 'rgba(49,121,245,0.10)';
const BEAR_OB_INT      = 'rgba(242,54,69,0.10)';
const BULL_FVG         = 'rgba(0,255,104,0.15)';
const BEAR_FVG         = 'rgba(255,0,8,0.15)';
const BULL_STRUCT      = '#089981';
const BEAR_STRUCT      = '#F23645';
const INT_BULL_STRUCT  = 'rgba(8,153,129,0.6)';
const INT_BEAR_STRUCT  = 'rgba(242,54,69,0.6)';
const STRONG_COLOR     = '#F23645';
const WEAK_COLOR       = '#089981';

// ── Renderer ───────────────────────────────────────────────────────────────────

class SMCRenderer {
  private chart:  IChartApi;
  private series: ISeriesApi<SeriesType>;
  private data:   SMCDrawData;

  constructor(chart: IChartApi, series: ISeriesApi<SeriesType>, data: SMCDrawData) {
    this.chart  = chart;
    this.series = series;
    this.data   = data;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const W   = scope.bitmapSize.width;
      const ts  = this.chart.timeScale();

      const tx = (t: number): number | null => {
        const c = ts.timeToCoordinate(t as Time);
        return c !== null ? c * hpr : null;
      };
      const ty = (p: number): number | null => {
        const c = this.series.priceToCoordinate(p);
        return c !== null ? c * vpr : null;
      };
      // right edge = last bar time extended slightly
      const xRight = (): number => {
        const c = tx(this.data.lastBarTime);
        return c !== null ? Math.min(c + 60 * hpr, W) : W;
      };

      // ── Draw a filled box ────────────────────────────────────────────────────
      const fillBox = (fromT: number, top: number, bottom: number, color: string, border?: string) => {
        const x1 = tx(fromT); const y1 = ty(top); const y2 = ty(bottom);
        if (x1 === null || y1 === null || y2 === null) return;
        const x2 = xRight();
        const yTop  = Math.min(y1, y2);
        const yBot  = Math.max(y1, y2);
        ctx.fillStyle = color;
        ctx.fillRect(x1, yTop, x2 - x1, yBot - yTop);
        if (border) {
          ctx.strokeStyle = border;
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, yTop, x2 - x1, yBot - yTop);
        }
      };

      // ── Draw a horizontal line between two times ─────────────────────────────
      const drawLine = (fromT: number, toT: number, price: number, color: string, dash: number[]) => {
        const x1 = tx(fromT); const x2 = tx(toT); const y = ty(price);
        if (x1 === null || x2 === null || y === null) return;
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1 * hpr;
        ctx.setLineDash(dash.map(d => d * hpr));
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      // ── Draw a horizontal ray to right edge ──────────────────────────────────
      const drawRay = (fromT: number, price: number, color: string, dash: number[]) => {
        const x1 = tx(fromT); const y = ty(price);
        if (x1 === null || y === null) return;
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1 * hpr;
        ctx.setLineDash(dash.map(d => d * hpr));
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      // ── Fair value gaps (draw first, below OBs) ──────────────────────────────
      for (const fvg of this.data.fvgs) {
        if (!fvg.active) continue;
        fillBox(fvg.time, fvg.top, fvg.bottom, fvg.bias === 'bullish' ? BULL_FVG : BEAR_FVG);
      }

      // ── Swing order blocks ────────────────────────────────────────────────────
      for (const ob of this.data.swingOBs) {
        if (!ob.active) continue;
        const fill   = ob.bias === 'bullish' ? BULL_OB_SWING : BEAR_OB_SWING;
        const border = ob.bias === 'bullish' ? 'rgba(49,121,245,0.5)' : 'rgba(242,54,69,0.5)';
        fillBox(ob.time, ob.top, ob.bottom, fill, border);
      }

      // ── Internal order blocks ─────────────────────────────────────────────────
      for (const ob of this.data.internalOBs) {
        if (!ob.active) continue;
        const fill = ob.bias === 'bullish' ? BULL_OB_INT : BEAR_OB_INT;
        fillBox(ob.time, ob.top, ob.bottom, fill);
      }

      // ── Swing structure lines ─────────────────────────────────────────────────
      for (const ev of this.data.swingEvts) {
        const col = ev.bias === 'bullish' ? BULL_STRUCT : BEAR_STRUCT;
        drawLine(ev.fromTime, ev.toTime, ev.level, col, []);
      }

      // ── Internal structure lines (dashed) ─────────────────────────────────────
      for (const ev of this.data.internalEvts) {
        const col = ev.bias === 'bullish' ? INT_BULL_STRUCT : INT_BEAR_STRUCT;
        drawLine(ev.fromTime, ev.toTime, ev.level, col, [4, 3]);
      }

      // ── Strong / Weak High / Low rays ─────────────────────────────────────────
      const hl = this.data.highLow;
      if (hl) {
        if (!isNaN(hl.strongHigh)) drawRay(hl.strongHighTime, hl.strongHigh, STRONG_COLOR, [3, 3]);
        if (!isNaN(hl.weakHigh))   drawRay(hl.weakHighTime,   hl.weakHigh,   WEAK_COLOR,   [3, 3]);
        if (!isNaN(hl.strongLow))  drawRay(hl.strongLowTime,  hl.strongLow,  STRONG_COLOR, [3, 3]);
        if (!isNaN(hl.weakLow))    drawRay(hl.weakLowTime,    hl.weakLow,    WEAK_COLOR,   [3, 3]);
      }
    });
  }
}

// ── Pane view ──────────────────────────────────────────────────────────────────

class SMCPaneView {
  private _r: SMCRenderer;
  constructor(r: SMCRenderer) { this._r = r; }
  zOrder() { return 'bottom' as const; }
  renderer() { return this._r; }
}

// ── Exported primitive ─────────────────────────────────────────────────────────

export class SMCPrimitive implements ISeriesPrimitive<Time> {
  private _chart:    IChartApi | null = null;
  private _series:   ISeriesApi<SeriesType> | null = null;
  private _data:     SMCDrawData = {
    swingOBs: [], internalOBs: [], fvgs: [],
    swingEvts: [], internalEvts: [], highLow: null, lastBarTime: 0,
  };
  private _view: SMCPaneView | null = null;
  private _requestUpdate: (() => void) | null = null;

  attached(params: { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void }) {
    this._chart  = params.chart;
    this._series = params.series;
    this._requestUpdate = params.requestUpdate;
    this._rebuildView();
  }

  detached() {
    this._chart  = null;
    this._series = null;
    this._view   = null;
  }

  update(data: SMCDrawData) {
    this._data = data;
    this._rebuildView();
    this._requestUpdate?.();
  }

  paneViews(): readonly SMCPaneView[] {
    return this._view ? [this._view] : [];
  }

  private _rebuildView() {
    if (!this._chart || !this._series) return;
    const renderer = new SMCRenderer(this._chart, this._series, this._data);
    this._view = new SMCPaneView(renderer);
  }
}
