'use client';

import { useEffect, useRef, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { OVERLAYS, OVERLAY_GROUPS, type OverlayId } from '@/lib/trading/overlays/registry';

type Props = {
  /** Reason each overlay is unavailable, or null when it can be drawn. */
  blocked: Record<OverlayId, string | null>;
  loading: boolean;
};

export default function OverlayControls({ blocked, loading }: Props) {
  const { overlays, setOverlay } = useTradingStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on an outside click, the way every other dropdown behaves.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const active = OVERLAYS.filter((overlay) => overlays[overlay.id] && blocked[overlay.id] === null).length;

  return (
    <div className="overlay-controls" ref={rootRef}>
      <button type="button" className="overlay-controls__toggle" onClick={() => setOpen((value) => !value)}>
        Overlays {active > 0 ? `· ${active}` : ''} {loading ? '⟳' : open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="overlay-controls__menu">
          {OVERLAY_GROUPS.map((group) => (
            <section key={group}>
              <h4>{group}</h4>
              {OVERLAYS.filter((overlay) => overlay.group === group).map((overlay) => {
                const reason = blocked[overlay.id];
                const disabled = reason !== null;

                return (
                  <label
                    key={overlay.id}
                    className={disabled ? 'is-disabled' : ''}
                    title={reason ?? overlay.hint}
                  >
                    <input
                      type="checkbox"
                      checked={overlays[overlay.id] && !disabled}
                      disabled={disabled}
                      onChange={(event) => setOverlay(overlay.id, event.target.checked)}
                    />
                    <span>{overlay.label}</span>
                    {disabled && <em>{reason}</em>}
                  </label>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
