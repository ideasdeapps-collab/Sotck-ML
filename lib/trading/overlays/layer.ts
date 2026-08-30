import {
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { BoxPrimitive, type Box } from './boxPrimitive';
import { CalloutPrimitive, type Callout } from './calloutPrimitive';

/**
 * One place that owns everything drawn on top of the candles.
 *
 * Each overlay is addressed by a stable id, so toggling one off removes only
 * its own artefacts. Without this, ChartPanel would have to tear the whole
 * chart down and rebuild it whenever a checkbox changed — which is what the
 * previous single-useEffect version effectively did on every ticker change.
 */

/** Alto inicial, en píxeles, de cada panel añadido bajo las velas. */
const EXTRA_PANE_HEIGHT = 120;

export type LinePoint = { time: Time; value: number };

export type LineOptions = {
  color: string;
  lineWidth?: 1 | 2 | 3 | 4;
  dashed?: boolean;
  title?: string;
  /** Panel donde vive la serie. 0 (por defecto) es el de las velas. */
  pane?: number;
  /** Fija la escala del panel en lugar de dejar que se autoajuste. */
  fixedRange?: { min: number; max: number };
};

export type PriceLineSpec = {
  price: number;
  color: string;
  title: string;
  width?: 1 | 2 | 3 | 4;
  dashed?: boolean;
};

export type OverlayLayer = {
  line(id: string, points: LinePoint[], options: LineOptions): void;
  priceLines(id: string, levels: PriceLineSpec[]): void;
  boxes(id: string, boxes: Box[]): void;
  callouts(id: string, callouts: Callout[]): void;
  markers(id: string, markers: SeriesMarker<Time>[]): void;
  remove(id: string): void;
  destroy(): void;
};

export function createOverlayLayer(
  chart: IChartApi,
  anchorSeries: ISeriesApi<'Candlestick', Time>
): OverlayLayer {
  const lines = new Map<string, ISeriesApi<'Line', Time>>();
  /** Panel de cada serie, para poder recogerlo cuando se queda vacío. */
  const linePanes = new Map<string, number>();
  const priceLines = new Map<string, IPriceLine[]>();
  const boxLayers = new Map<string, BoxPrimitive>();
  const calloutLayers = new Map<string, CalloutPrimitive>();
  const markerGroups = new Map<string, SeriesMarker<Time>[]>();

  let markerApi: ISeriesMarkersPluginApi<Time> | null = null;
  let destroyed = false;

  function repaintMarkers() {
    const merged = Array.from(markerGroups.values())
      .flat()
      // lightweight-charts requires markers in ascending time order.
      .sort((a, b) => Number(a.time) - Number(b.time));

    if (merged.length === 0) {
      markerApi?.setMarkers([]);
      return;
    }

    if (!markerApi) markerApi = createSeriesMarkers(anchorSeries, []);
    markerApi.setMarkers(merged);
  }

  function removeLine(id: string) {
    const series = lines.get(id);
    if (!series) return;

    chart.removeSeries(series);
    lines.delete(id);

    const pane = linePanes.get(id);
    linePanes.delete(id);

    // Un panel extra sin series deja una franja vacía debajo de las velas, así
    // que se recoge en cuanto sale la última: apagar el overlay tiene que
    // devolver el gráfico exactamente a como estaba.
    if (pane === undefined || pane === 0) return;

    const panes = chart.panes();
    if (pane < panes.length && panes[pane].getSeries().length === 0) chart.removePane(pane);
  }

  function removePriceLines(id: string) {
    const handles = priceLines.get(id);
    if (!handles) return;
    for (const handle of handles) anchorSeries.removePriceLine(handle);
    priceLines.delete(id);
  }

  function removeBoxes(id: string) {
    const primitive = boxLayers.get(id);
    if (!primitive) return;
    anchorSeries.detachPrimitive(primitive);
    boxLayers.delete(id);
  }

  function removeCallouts(id: string) {
    const primitive = calloutLayers.get(id);
    if (!primitive) return;
    anchorSeries.detachPrimitive(primitive);
    calloutLayers.delete(id);
  }

  return {
    line(id, points, options) {
      if (destroyed) return;

      if (points.length === 0) {
        removeLine(id);
        return;
      }

      const pane = options.pane ?? 0;
      let series = lines.get(id);

      if (!series) {
        series = chart.addSeries(
          LineSeries,
          {
            color: options.color,
            lineWidth: options.lineWidth ?? 2,
            lineStyle: options.dashed ? LineStyle.Dashed : LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            title: options.title ?? '',
            ...(options.fixedRange
              ? {
                  autoscaleInfoProvider: () => ({
                    priceRange: { minValue: options.fixedRange!.min, maxValue: options.fixedRange!.max },
                  }),
                }
              : {}),
          },
          pane
        );

        lines.set(id, series);
        linePanes.set(id, pane);

        // Un oscilador no necesita la mitad del gráfico; se fija al crearlo y
        // el usuario puede seguir arrastrando el separador.
        if (pane > 0 && chart.panes()[pane]?.getSeries().length === 1) {
          chart.panes()[pane].setHeight(EXTRA_PANE_HEIGHT);
        }
      }

      series.setData(points);
    },

    priceLines(id, levels) {
      if (destroyed) return;
      removePriceLines(id);
      if (levels.length === 0) return;

      priceLines.set(
        id,
        levels.map((level) =>
          anchorSeries.createPriceLine({
            price: level.price,
            color: level.color,
            lineWidth: level.width ?? 1,
            lineStyle: level.dashed ? LineStyle.Dashed : LineStyle.Solid,
            axisLabelVisible: true,
            title: level.title,
          })
        )
      );
    },

    boxes(id, boxes) {
      if (destroyed) return;

      if (boxes.length === 0) {
        removeBoxes(id);
        return;
      }

      let primitive = boxLayers.get(id);
      if (!primitive) {
        primitive = new BoxPrimitive();
        anchorSeries.attachPrimitive(primitive);
        boxLayers.set(id, primitive);
      }

      primitive.setBoxes(boxes);
    },

    callouts(id, callouts) {
      if (destroyed) return;

      if (callouts.length === 0) {
        removeCallouts(id);
        return;
      }

      let primitive = calloutLayers.get(id);
      if (!primitive) {
        primitive = new CalloutPrimitive();
        anchorSeries.attachPrimitive(primitive);
        calloutLayers.set(id, primitive);
      }

      primitive.setCallouts(callouts);
    },

    markers(id, markers) {
      if (destroyed) return;

      if (markers.length === 0) markerGroups.delete(id);
      else markerGroups.set(id, markers);

      repaintMarkers();
    },

    remove(id) {
      if (destroyed) return;
      removeLine(id);
      removePriceLines(id);
      removeBoxes(id);
      removeCallouts(id);
      markerGroups.delete(id);
      repaintMarkers();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      // The chart itself is removed by the caller; only the plugin handles
      // need explicit disposal.
      markerApi?.detach();
      markerApi = null;
      markerGroups.clear();
      lines.clear();
      linePanes.clear();
      priceLines.clear();
      boxLayers.clear();
      calloutLayers.clear();
    },
  };
}
