"""
price_store.py — Caché compartida de precios en Supabase (Fase 1)
=================================================================
Los usuarios LEEN precios desde aquí (sin tocar Polygon). Solo el proceso de
refresco (workflow diario, o el primer acceso si falta) ESCRIBE desde Polygon.

Esto desacopla el número de usuarios de la cuota de 5 llamadas/min de Polygon:
por muchos usuarios que consulten a la vez, solo leen de Supabase.

Requiere: SUPABASE_URL + SUPABASE_SERVICE_KEY, y la tabla price_cache
(ver supabase/schema_v3_price_cache.sql).
"""

from __future__ import annotations
import os
import datetime as dt

import pandas as pd
import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)

# Cuántos días se consideran "frescos" para no re-escribir innecesariamente
FRESH_DAYS = int(os.getenv("PRICE_CACHE_FRESH_DAYS", "1"))


def enabled() -> bool:
    return _ENABLED


def _h(prefer: str | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    return h


# --------------------------------------------------------------------------- #
# Lectura
# --------------------------------------------------------------------------- #
def read_prices(ticker: str, years: int = 2) -> pd.DataFrame | None:
    """
    Devuelve las barras diarias cacheadas para 'ticker' (últimos ~years años)
    como DataFrame con columnas [date, open, high, low, close, volume], o None
    si no hay caché o Supabase está deshabilitado.
    """
    if not _ENABLED:
        return None
    start = (dt.date.today() - dt.timedelta(days=int(years * 365.25))).isoformat()
    r = requests.get(f"{SUPABASE_URL}/rest/v1/price_cache", headers=_h(),
                     params={"ticker": f"eq.{ticker.upper()}", "date": f"gte.{start}",
                             "order": "date.asc",
                             "select": "date,open,high,low,close,volume"},
                     timeout=25)
    if not r.ok:
        return None
    rows = r.json()
    if not rows:
        return None
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df[["date", "open", "high", "low", "close", "volume"]].sort_values("date").reset_index(drop=True)


def last_cached_date(ticker: str) -> dt.date | None:
    """Fecha más reciente cacheada para el ticker (o None)."""
    if not _ENABLED:
        return None
    r = requests.get(f"{SUPABASE_URL}/rest/v1/price_cache", headers=_h(),
                     params={"ticker": f"eq.{ticker.upper()}", "order": "date.desc",
                             "limit": "1", "select": "date"}, timeout=15)
    if not r.ok or not r.json():
        return None
    return dt.date.fromisoformat(r.json()[0]["date"])


# --------------------------------------------------------------------------- #
# Escritura (solo el backend con service_role)
# --------------------------------------------------------------------------- #
def write_prices(ticker: str, df: pd.DataFrame) -> int:
    """
    Upsert de las barras diarias del DataFrame en price_cache.
    Devuelve el número de filas enviadas. Usa Prefer: resolution=merge-duplicates
    para no duplicar (clave primaria ticker+date).
    """
    if not _ENABLED or df is None or df.empty:
        return 0
    rows = []
    for _, r in df.iterrows():
        rows.append({
            "ticker": ticker.upper(),
            "date": pd.to_datetime(r["date"]).date().isoformat(),
            "open": None if pd.isna(r.get("open")) else float(r["open"]),
            "high": None if pd.isna(r.get("high")) else float(r["high"]),
            "low": None if pd.isna(r.get("low")) else float(r["low"]),
            "close": float(r["close"]),
            "volume": None if pd.isna(r.get("volume")) else float(r["volume"]),
        })
    # Envía en lotes para no exceder límites de payload
    total = 0
    B = 1000
    for i in range(0, len(rows), B):
        chunk = rows[i:i + B]
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/price_cache",
            headers=_h("resolution=merge-duplicates,return=minimal"),
            json=chunk, timeout=40)
        resp.raise_for_status()
        total += len(chunk)
    return total
