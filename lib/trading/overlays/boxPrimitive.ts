import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

/**
 * Time/price-bounded rectangles.
 *
 * Fair value gaps, order blocks and the opening range are all zones, not
 * levels — drawing them as a pair of horizontal lines loses the thing that
 * makes them readable. lightweight-charts has no built-in box, so this is a
 * small series primitive that paints them behind the candles.
 */

export type Box = {
  from: Time;
  /** `null` runs the box to the right edge of the chart — an open-ended zone. */
  to: Time | null;
  top: number;
  bottom: number;
  fill: string;
  border: string;
  label?: string;
  /** Which end of the box the label sits at. Default 'left'. */
  labelAlign?: 'left' | 'right';
  dashed?: boolean;
};

type BoxCoords = { left: number; right: number; top: number; bottom: number; box: Box };

class BoxRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly boxes: BoxCoords[]) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;

      for (const { left, right, top, bottom, box } of this.boxes) {
        const x = Math.round(left * hRatio);
        const y = Math.round(top * vRatio);
        const width = Math.max(Math.round((right - left) * hRatio), 1);
        // A zone can be arbitrarily thin; keep it visible at 1px.
        const height = Math.max(Math.round((bottom - top) * vRatio), 1);

        ctx.fillStyle = box.fill;
        ctx.fillRect(x, y, width, height);

        ctx.save();
        ctx.strokeStyle = box.border;
        ctx.lineWidth = Math.max(hRatio, 1);
        if (box.dashed) ctx.setLineDash([4 * hRatio, 3 * hRatio]);
        ctx.strokeRect(x, y, width, height);
        ctx.restore();

        if (box.label) {
          ctx.fillStyle = box.border;
          ctx.font = `${Math.round(10 * vRatio)}px ui-sans-serif, system-ui, sans-serif`;
          const padding = 6 * hRatio;
          const right = box.labelAlign === 'right';
          ctx.textAlign = right ? 'right' : 'left';
          ctx.fillText(box.label, right ? x + width - padding : x + padding, y + 12 * vRatio);
          // textAlign is sticky on the shared context; reset it for the next box.
          ctx.textAlign = 'left';
        }
      }
    });
  }
}

class BoxPaneView implements IPrimitivePaneView {
  constructor(private readonly source: BoxPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return new BoxRenderer(this.source.coordinates());
  }
}

export class BoxPrimitive implements ISeriesPrimitive<Time> {
  private boxes: Box[] = [];
  private coords: BoxCoords[] = [];
  private attachedTo: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private readonly views = [new BoxPaneView(this)];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.attachedTo = param;
  }

  detached(): void {
    this.attachedTo = null;
  }

  setBoxes(boxes: Box[]): void {
    this.boxes = boxes;
    this.updateAllViews();
    this.attachedTo?.requestUpdate();
  }

  updateAllViews(): void {
    const param = this.attachedTo;
    if (!param) {
      this.coords = [];
      return;
    }

    const series = param.series as ISeriesApi<SeriesType, Time>;
    const timeScale = param.chart.timeScale();
    const rightEdge = timeScale.width();
    const next: BoxCoords[] = [];

    for (const box of this.boxes) {
      const top = series.priceToCoordinate(Math.max(box.top, box.bottom));
      const bottom = series.priceToCoordinate(Math.min(box.top, box.bottom));
      if (top === null || bottom === null) continue;

      const left = timeScale.timeToCoordinate(box.from);
      if (left === null) continue;

      // A zone that runs to the current bar has no right edge on the scale yet;
      // `to: null` says so explicitly.
      const right = box.to === null ? rightEdge : (timeScale.timeToCoordinate(box.to) ?? rightEdge);

      next.push({ left, right: Math.max(right, left + 1), top, bottom, box });
    }

    this.coords = next;
  }

  coordinates(): BoxCoords[] {
    return this.coords;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}
