"""
features_1m_dir.py — Features del modelo de DIRECCIÓN de 1 minuto
=================================================================
UNA sola definición, usada por el entrenamiento (train_xgb_1m_dir.py) y por la
inferencia (api/signal_1m.py): la inferencia llama a esta misma función sobre
las últimas HISTORY_SESSIONS sesiones y se queda con la última fila. Sin gemelo
incremental no hay dos definiciones que puedan divergir en silencio.

Regla de oro: la fila t solo usa lo disponible al CIERRE de la barra t —barras
con inicio ≤ t, noticias publicadas antes de t+1 min y agregados de sesiones
ANTERIORES—. tests/test_features_1m_dir.py lo comprueba alterando el futuro.

Retornos y volatilidades van en unidades de σ del ticker (σ de 1 min de las 20
sesiones previas) para que un modelo agrupado compare NVDA con QQQ.
"""

from __future__ import annotations
import datetime as dt

import numpy as np
import pandas as pd

from events_1m import load_fomc_days, macro_flags

TICKERS = ("NVDA", "QQQ", "SNDK", "TSM", "AVGO", "META", "AMAT", "MU")
CONTEXT_SYMBOLS = ("SPY", "QQQ", "SMH")

BARS_PER_SESSION = 390
SIGMA_DAYS = 20          # σ y β: sesiones previas
SIGMA_MIN_DAYS = 5
TOD_DAYS = 20            # z-score del volumen contra la misma hora del día
GAP_DAYS = 60            # z-score del gap: sesiones previas (spec: "z-score del gap
                         # contra sus 60 días"). SIGMA_DAYS/TOD_DAYS deben ser ≤ GAP_DAYS
                         # para que HISTORY_SESSIONS (derivado de GAP_DAYS) también les
                         # alcance a ellos.
RET_WINDOWS = (1, 5, 15, 30, 60)
CTX_WINDOWS = (1, 5, 15)
EVENT_GAP_Z = 3.0
DAYS_SINCE_CAP = 30
NEWS_SINCE_CAP_MIN = 3 * 1440
FOMC_DECISION_MIN = 14 * 60
FOMC_NONE = 999.0
assert SIGMA_DAYS <= GAP_DAYS and TOD_DAYS <= GAP_DAYS

# Sesiones que necesita la fila de HOY para salir idéntica a la del entrenamiento:
# 60 de gap (GAP_DAYS) para cada una de las 30 sesiones que mira days_since_event,
# más la propia sesión de hoy. gap_z se mide contra la dispersión de sus propias
# GAP_DAYS sesiones previas (no contra σ_1m·√390, ver comentario en gap_z más abajo),
# así que es GAP_DAYS —no SIGMA_DAYS— quien fija la ventana de historia necesaria.
HISTORY_SESSIONS = GAP_DAYS + DAYS_SINCE_CAP + 1

KEEP_COLS = ["dt_et", "day", "bar_idx", "close", "sig"]
FEATURE_COLS = [
    "tod_sin", "tod_cos", "bars_left",
    "ret_from_open_z", "dist_vwap_z", "gap_z",
    *[f"ret_{k}_z" for k in RET_WINDOWS],
    "rv_15_z", "rv_60_z", "range_z", "vol_tod_z", "cumvol_tod_z",
    "n_rel", "vw_dev_z", "size_rel",
    *[f"{s.lower()}_ret_{k}_z" for s in CONTEXT_SYMBOLS for k in CTX_WINDOWS],
    "beta_mkt", "rs_15_z", "rs_60_z",
    "news_60m", "news_24h", "sent_24h", "mins_since_news",
    "event_day", "days_since_event", "is_fomc_day", "is_nfp_day", "fomc_mins_to_decision",
    "ticker",
]


# --------------------------------------------------------------------------- #
# Piezas
# --------------------------------------------------------------------------- #
def _base(bars: pd.DataFrame) -> pd.DataFrame:
    out = bars.sort_values("dt_et").reset_index(drop=True).copy()
    out["day"] = out["dt_et"].dt.date
    # bar_idx viene del RELOJ (09:30 → 0), no de cumcount(): así un minuto faltante
    # o un medio día no desalinean las features de hora-del-día (tod_sin/cos,
    # bars_left, _tod_z) respecto al resto de sesiones. ret_k (más abajo) sigue
    # contando BARRAS, no minutos: con huecos, "ret_5" mira 5 barras atrás aunque
    # eso sean más de 5 minutos de reloj.
    out["bar_idx"] = (out["dt_et"].dt.hour * 60 + out["dt_et"].dt.minute - 570).astype("int64")
    # Retorno de 1 min que NO cruza el cambio de sesión.
    out["ret"] = np.log(out["close"] / out.groupby("day")["close"].shift(1))
    return out


def daily_sigma(df: pd.DataFrame) -> pd.Series:
    """σ de 1 min de las SIGMA_DAYS sesiones PREVIAS, por día (shift(1): hoy no cuenta)."""
    sumsq = (df["ret"] ** 2).groupby(df["day"]).sum()
    count = df["ret"].notna().groupby(df["day"]).sum().astype(float)
    roll = lambda s: s.rolling(SIGMA_DAYS, min_periods=SIGMA_MIN_DAYS).sum().shift(1)
    return np.sqrt(roll(sumsq) / roll(count).replace(0, np.nan))


def _ret_k(close: pd.Series, day: pd.Series, k: int) -> pd.Series:
    return np.log(close / close.groupby(day).shift(k))


def _expanding_mean(s: pd.Series, day: pd.Series) -> pd.Series:
    total = s.fillna(0.0).groupby(day).cumsum()
    count = s.notna().astype(float).groupby(day).cumsum()
    return total / count.replace(0, np.nan)


def _tod_z(values: pd.Series, day: pd.Series, bar_idx: pd.Series) -> pd.Series:
    """z-score contra la MISMA bar_idx (barra del reloj) en las TOD_DAYS sesiones
    previas. Vectorizado con un pivot día×bar_idx: antes eran dos
    `groupby(bar_idx).transform(lambda ...)` (~78 % del runtime de build_features
    con HISTORY_SESSIONS=51; con HISTORY_SESSIONS=91 el costo solo crecía). Un
    pivot + rolling por columnas es la misma cuenta pero vectorizada en C.

    Semántica (documentada porque cambia con el pivot): la ventana es de
    TOD_DAYS SESIONES CALENDARIO previas, no "TOD_DAYS sesiones que tengan esa
    bar_idx". Un día que no tenga esa bar_idx (medio día, minuto faltante)
    aporta NaN a esa columna y el rolling lo salta (min_periods sigue exigiendo
    SIGMA_MIN_DAYS valores no-NaN dentro de esa ventana de TOD_DAYS filas).
    Entrenamiento e inferencia llaman a la misma función, así que ambos ven
    exactamente la misma semántica."""
    pivot = (pd.DataFrame({"day": day.to_numpy(), "bar_idx": bar_idx.to_numpy(),
                           "v": values.to_numpy()})
             .groupby(["day", "bar_idx"])["v"].first().unstack("bar_idx"))
    prev = pivot.shift(1).rolling(TOD_DAYS, min_periods=SIGMA_MIN_DAYS)
    mean, std = prev.mean(), prev.std()
    z = (pivot - mean) / std.replace(0, np.nan)
    row_pos = z.index.get_indexer(day.to_numpy())
    col_pos = z.columns.get_indexer(bar_idx.to_numpy())
    return pd.Series(z.to_numpy()[row_pos, col_pos], index=values.index)


def _context_frame(bars: pd.DataFrame | None, sym: str) -> pd.DataFrame | None:
    """Retornos del contexto en σ propios + crudos (para β y fuerza relativa)."""
    if bars is None or len(bars) == 0:
        return None
    c = _base(bars)
    sig = c["day"].map(daily_sigma(c))
    p = sym.lower()
    out = pd.DataFrame({"dt_et": c["dt_et"]})
    for k in CTX_WINDOWS:
        out[f"{p}_ret_{k}_z"] = _ret_k(c["close"], c["day"], k) / (sig * np.sqrt(k))
    out[f"_{p}_ret"] = c["ret"]
    for k in (15, 60):
        out[f"_{p}_raw_{k}"] = _ret_k(c["close"], c["day"], k)
    return out


def _utc_ns(ts: pd.Series) -> np.ndarray:
    return (ts.dt.tz_convert("UTC").dt.tz_localize(None)
            .astype("datetime64[ns]").to_numpy().astype("int64"))


def _news_block(bar_end: pd.Series, news: pd.DataFrame | None) -> dict[str, np.ndarray]:
    n = len(bar_end)
    if news is None or len(news) == 0:
        return {"news_60m": np.zeros(n), "news_24h": np.zeros(n), "sent_24h": np.zeros(n),
                "mins_since_news": np.full(n, float(NEWS_SINCE_CAP_MIN))}
    news = news.sort_values("ts")
    ts = _utc_ns(news["ts"])
    t = _utc_ns(bar_end)
    minute = 60 * 10**9
    # side="right": una noticia publicada justo al cierre de la barra ya cuenta.
    upto = np.searchsorted(ts, t, side="right")
    from_60 = np.searchsorted(ts, t - 60 * minute, side="right")
    from_24h = np.searchsorted(ts, t - 1440 * minute, side="right")
    csum = np.concatenate([[0], np.cumsum(news["sent"].to_numpy(dtype=float))])
    last = np.where(upto > 0, ts[np.maximum(upto - 1, 0)], np.iinfo(np.int64).min)
    since = np.where(upto > 0, (t - last) / minute, np.inf)
    return {
        "news_60m": (upto - from_60).astype(float),
        "news_24h": (upto - from_24h).astype(float),
        "sent_24h": csum[upto] - csum[from_24h],
        "mins_since_news": np.minimum(since, NEWS_SINCE_CAP_MIN).astype(float),
    }


# --------------------------------------------------------------------------- #
# Orquestador
# --------------------------------------------------------------------------- #
def build_features(bars: pd.DataFrame, ticker: str, context: dict[str, pd.DataFrame],
                   news: pd.DataFrame | None,
                   fomc_days: set[dt.date] | None = None) -> pd.DataFrame:
    t = ticker.upper()
    if t not in TICKERS:
        raise ValueError(f"{t} no está entre los tickers del modelo de dirección: {TICKERS}")
    fomc_days = load_fomc_days() if fomc_days is None else fomc_days

    df = _base(bars)

    # Contexto primero: el merge rehace el índice y todo lo demás cuelga de él.
    ctx_cols = []
    for sym in CONTEXT_SYMBOLS:
        frame = _context_frame(context.get(sym), sym)
        p = sym.lower()
        cols = [f"{p}_ret_{k}_z" for k in CTX_WINDOWS] + [f"_{p}_ret", f"_{p}_raw_15", f"_{p}_raw_60"]
        if frame is None:
            for col in cols:
                df[col] = np.nan
        else:
            df = df.merge(frame, on="dt_et", how="left")
        ctx_cols += cols
    # Una barra de contexto ausente hereda la anterior de la MISMA sesión.
    df[ctx_cols] = df.groupby("day")[ctx_cols].ffill()

    day = df["day"]
    sig_day = daily_sigma(df)
    df["sig"] = day.map(sig_day)
    sig = df["sig"]

    m = df["bar_idx"].clip(upper=BARS_PER_SESSION - 1)
    df["tod_sin"] = np.sin(2 * np.pi * m / BARS_PER_SESSION)
    df["tod_cos"] = np.cos(2 * np.pi * m / BARS_PER_SESSION)
    df["bars_left"] = (BARS_PER_SESSION - 1 - m).clip(lower=0) / BARS_PER_SESSION

    open_px = df.groupby("day")["open"].transform("first")
    df["ret_from_open_z"] = np.log(df["close"] / open_px) / (sig * np.sqrt(df["bar_idx"] + 1))

    tp = (df["high"] + df["low"] + df["close"]) / 3
    vwap = (tp * df["volume"]).groupby(day).cumsum() / df["volume"].groupby(day).cumsum().replace(0, np.nan)
    df["dist_vwap_z"] = ((df["close"] - vwap) / vwap) / sig

    close_by_day = df.groupby("day")["close"].last()
    open_by_day = df.groupby("day")["open"].first()
    gap_by_day = np.log(open_by_day / close_by_day.shift(1))
    # Spec: "z-score del gap contra sus 60 días" — NO σ_1m·√390 (esa es una proxy
    # de vol diaria muchísimo mayor que la dispersión real del propio gap, así que
    # con ella un gap de earnings típico del 3-5 % nunca cruzaba EVENT_GAP_Z).
    # Desviación estándar MUESTRAL (ddof=1, rolling().std(), no RMS contra 0: el
    # gap medio no es exactamente 0, hay deriva) de las GAP_DAYS sesiones previas,
    # shift(1) para que el gap de hoy no entre en su propio denominador.
    gap_std_day = gap_by_day.rolling(GAP_DAYS, min_periods=SIGMA_MIN_DAYS).std().shift(1)
    gap_z_day = gap_by_day / gap_std_day.replace(0, np.nan)
    df["gap_z"] = day.map(gap_z_day)

    for k in RET_WINDOWS:
        df[f"ret_{k}_z"] = _ret_k(df["close"], day, k) / (sig * np.sqrt(k))
    for w in (15, 60):
        rv = df.groupby("day")["ret"].transform(lambda s: s.rolling(w, min_periods=5).std())
        df[f"rv_{w}_z"] = rv / sig
    df["range_z"] = ((df["high"] - df["low"]) / df["close"]) / sig
    df["vol_tod_z"] = _tod_z(np.log1p(df["volume"]), day, df["bar_idx"])
    df["cumvol_tod_z"] = _tod_z(np.log1p(df["volume"].groupby(day).cumsum()), day, df["bar_idx"])

    n = df["n"].astype(float).replace(0, np.nan)
    df["n_rel"] = n / _expanding_mean(n, day)
    df["vw_dev_z"] = ((df["close"] - df["vw"]) / df["close"]) / sig
    size = df["volume"] / n
    df["size_rel"] = size / _expanding_mean(size, day)

    # β y fuerza relativa contra el mercado (QQQ; para el propio QQQ, SPY).
    mkt = "spy" if t == "QQQ" else "qqq"
    x, y = df[f"_{mkt}_ret"], df["ret"]
    valid = x.notna() & y.notna()
    sxy = (x * y).where(valid).groupby(day).sum()
    sxx = (x * x).where(valid).groupby(day).sum()
    roll = lambda s: s.rolling(SIGMA_DAYS, min_periods=SIGMA_MIN_DAYS).sum().shift(1)
    df["beta_mkt"] = day.map(roll(sxy) / roll(sxx).replace(0, np.nan))
    for k in (15, 60):
        df[f"rs_{k}_z"] = ((_ret_k(df["close"], day, k) - df["beta_mkt"] * df[f"_{mkt}_raw_{k}"])
                           / (sig * np.sqrt(k)))

    for name, values in _news_block(df["dt_et"] + pd.Timedelta(minutes=1), news).items():
        df[name] = values

    # Eventos: el gap se conoce en la apertura, así que marcar el día entero no filtra.
    event_by_day = (gap_z_day.abs() > EVENT_GAP_Z)
    since, counter = {}, DAYS_SINCE_CAP
    for d, is_event in event_by_day.items():
        counter = 0 if is_event else min(counter + 1, DAYS_SINCE_CAP)
        since[d] = counter
    df["event_day"] = day.map(event_by_day.astype(float))
    df["days_since_event"] = day.map(since).astype(float)
    flags = macro_flags(sorted(day.unique()), fomc_days)
    df["is_fomc_day"] = day.map(flags["is_fomc_day"])
    df["is_nfp_day"] = day.map(flags["is_nfp_day"])
    mins = df["dt_et"].dt.hour * 60 + df["dt_et"].dt.minute
    df["fomc_mins_to_decision"] = np.where(df["is_fomc_day"] == 1.0,
                                           FOMC_DECISION_MIN - mins, FOMC_NONE).astype(float)

    out = df[df["sig"].notna()].reset_index(drop=True)
    out["ticker"] = pd.Categorical([t] * len(out), categories=list(TICKERS))
    return out[KEEP_COLS + FEATURE_COLS]
