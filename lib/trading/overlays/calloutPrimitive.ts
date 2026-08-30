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
 * Bocadillos anclados a una vela.
 *
 * Los marcadores nativos de lightweight-charts dan una etiqueta pequeña pegada
 * a la barra; una señal de compra necesita leerse de un vistazo sobre el
 * gráfico, con su resultado al lado. Es la misma idea que `boxPrimitive.ts`
 * —una primitiva de serie que pinta lo que la librería no trae— con dos
 * diferencias: va DELANTE de las velas, no detrás, y se recorta al ancho del
 * canvas para no salirse por los bordes.
 */

export type Callout = {
  time: Time;
  /** Precio al que apunta el pico. */
  price: number;
  text: string;
  /** Segunda línea, más pequeña — el recorrido posterior. */
  sub?: string;
  fill: string;
  textColor: string;
  /** Dónde se coloca el globo respecto al punto de anclaje. */
  placement: 'above' | 'below';
};

type CalloutCoords = { x: number; y: number; callout: Callout };

const PADDING_X = 8;
const PADDING_Y = 5;
const RADIUS = 5;
/** Separación entre la punta del pico y la vela. */
const GAP = 10;
const TAIL = 6;
const FONT_MAIN = 11;
const FONT_SUB = 10;
/**
 * Por debajo de este ancho de gráfico la segunda línea se cae.
 *
 * En un teléfono el globo con detalle ocupa casi medio canvas: los bocadillos
 * se pisan entre ellos y el texto se recorta. La etiqueta sola sí cabe, y es lo
 * que hay que leer; el detalle sigue estando en el panel de señales.
 */
const SUB_MIN_WIDTH = 520;

/** Rectángulo redondeado sin depender de `ctx.roundRect`. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

type Placed = { left: number; top: number; width: number; height: number; anchorX: number; anchorY: number; callout: Callout };

/** ¿Se pisan dos globos, con un margen de aire entre ellos? */
function overlaps(a: Placed, b: Placed, gap: number): boolean {
  return (
    a.left < b.left + b.width + gap &&
    a.left + a.width + gap > b.left &&
    a.top < b.top + b.height + gap &&
    a.top + a.height + gap > b.top
  );
}

class CalloutRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly callouts: CalloutCoords[]) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      const canvasWidth = scope.bitmapSize.width;
      const canvasHeight = scope.bitmapSize.height;
      const roomForSub = canvasWidth / hRatio >= SUB_MIN_WIDTH;

      const fontMain = `600 ${Math.round(FONT_MAIN * vRatio)}px ui-sans-serif, system-ui, sans-serif`;
      const fontSub = `${Math.round(FONT_SUB * vRatio)}px ui-sans-serif, system-ui, sans-serif`;

      const padX = PADDING_X * hRatio;
      const padY = PADDING_Y * vRatio;
      const lineMain = FONT_MAIN * 1.35 * vRatio;
      const lineSub = FONT_SUB * 1.35 * vRatio;
      const gap = GAP * vRatio;
      const tail = TAIL * hRatio;
      const air = 3 * vRatio;

      // --- 1. Geometría -----------------------------------------------------
      const placed: Placed[] = [];

      for (const { x, y, callout } of this.callouts) {
        const sub = roomForSub ? callout.sub : undefined;

        ctx.font = fontMain;
        const mainWidth = ctx.measureText(callout.text).width;
        ctx.font = fontSub;
        const subWidth = sub ? ctx.measureText(sub).width : 0;

        const width = Math.max(mainWidth, subWidth) + padX * 2;
        const height = lineMain + (sub ? lineSub : 0) + padY * 2;

        const anchorX = x * hRatio;
        const anchorY = y * vRatio;
        const above = callout.placement === 'above';

        // Recortado al canvas: un globo cerca del borde se saldría.
        const left = Math.max(
          2 * hRatio,
          Math.min(anchorX - width / 2, canvasWidth - width - 2 * hRatio)
        );

        const box: Placed = {
          left,
          top: above ? anchorY - gap - height : anchorY + gap,
          width,
          height,
          anchorX,
          anchorY,
          callout: sub === callout.sub ? callout : { ...callout, sub },
        };

        // --- 2. Sin pisarse ------------------------------------------------
        // Dos señales seguidas dejan sus globos a la misma altura y el de
        // debajo se vuelve ilegible. Se aparta del anclaje hasta que quepa; el
        // pico se estira solo, así que sigue señalando su vela.
        let guard = 0;
        while (placed.some((other) => overlaps(box, other, air)) && guard < 8) {
          box.top += (above ? -1 : 1) * (height + air * 2);
          guard += 1;
        }

        // Apartarse puede empujar el globo fuera del gráfico. Antes ilegible
        // que invisible: se vuelve a meter dentro aunque roce a un vecino.
        box.top = Math.max(2 * vRatio, Math.min(box.top, canvasHeight - height - 2 * vRatio));

        placed.push(box);
      }

      // --- 3. Pintado -------------------------------------------------------
      for (const box of placed) {
        const { callout, left, top, width, height, anchorX, anchorY } = box;
        const above = callout.placement === 'above';

        ctx.save();
        ctx.fillStyle = callout.fill;

        // El pico, desde el borde del globo hasta la vela. Se dibuja como
        // triángulo hasta el anclaje real, así que funciona igual si el globo
        // tuvo que apartarse.
        const edge = above ? top + height : top;
        const tipX = Math.max(left + tail, Math.min(anchorX, left + width - tail));
        ctx.beginPath();
        ctx.moveTo(tipX - tail, edge);
        ctx.lineTo(tipX + tail, edge);
        ctx.lineTo(anchorX, anchorY);
        ctx.closePath();
        ctx.fill();

        roundedRect(ctx, left, top, width, height, RADIUS * hRatio);
        ctx.fill();

        ctx.fillStyle = callout.textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const centre = left + width / 2;

        ctx.font = fontMain;
        ctx.fillText(callout.text, centre, top + padY);

        if (callout.sub) {
          ctx.font = fontSub;
          ctx.fillText(callout.sub, centre, top + padY + lineMain);
        }

        ctx.restore();
      }
    });
  }
}

class CalloutPaneView implements IPrimitivePaneView {
  constructor(private readonly source: CalloutPrimitive) {}

  /** Delante de las velas: una señal tapada por una vela no sirve de nada. */
  zOrder(): PrimitivePaneViewZOrder {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return new CalloutRenderer(this.source.coordinates());
  }
}

export class CalloutPrimitive implements ISeriesPrimitive<Time> {
  private callouts: Callout[] = [];
  private coords: CalloutCoords[] = [];
  private attachedTo: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private readonly views = [new CalloutPaneView(this)];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.attachedTo = param;
  }

  detached(): void {
    this.attachedTo = null;
  }

  setCallouts(callouts: Callout[]): void {
    this.callouts = callouts;
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
    const next: CalloutCoords[] = [];

    for (const callout of this.callouts) {
      const x = timeScale.timeToCoordinate(callout.time);
      const y = series.priceToCoordinate(callout.price);
      if (x === null || y === null) continue;
      next.push({ x, y, callout });
    }

    this.coords = next;
  }

  coordinates(): CalloutCoords[] {
    return this.coords;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}
