"""
train_xgb_1m_dir.py — Modelo XGBoost de DIRECCIÓN a 5/15/30 min (1 minuto)
=========================================================================
AISLADO de train_xgb_1m.py: no predice el retorno del siguiente minuto (ruido,
~50 % durante semanas de reentrenos) sino si el precio subirá o bajará más allá
de una banda de ruido en h minutos, con probabilidad. Un modelo AGRUPADO por
horizonte (8 tickers líquidos, el ticker como feature categórica).

Validación: walk-forward por días (cada fold entrena con todo lo anterior y
prueba el bloque siguiente). El umbral de confianza τ se elige con los folds
previos y se mide en el último; las filas del holdout están correlacionadas
dentro de cada día (mismo camino de precio) y entre tickers (se mueven juntos
intradía), así que `has_edge` NO usa un Wilson i.i.d. sobre filas sueltas —lo
infla— sino un bootstrap por DÍA completo (`block_bootstrap`) más la
consistencia entre folds anteriores. El Wilson i.i.d. se conserva como dato
informativo en `holdout.wilson_lo`, sin decidir.

Uso:
    python training/train_xgb_1m_dir.py --sessions 252
"""

from __future__ import annotations
import os
import sys
import json
import math
import argparse
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from xgboost import XGBClassifier
from sklearn.metrics import roc_auc_score

sys.path.append(os.path.dirname(__file__))
from features_1m_dir import (  # noqa: E402
    TICKERS, CONTEXT_SYMBOLS, FEATURE_COLS, HISTORY_SESSIONS, build_features,
)
from data_1m import load_bars  # noqa: E402
from news_1m import load_news  # noqa: E402

HORIZONS = (5, 15, 30)
DEAD_BAND = 0.25
N_FOLDS = 6
MIN_TRAIN_DAYS = 60
MIN_COVERAGE = 0.10
TAU_GRID = np.round(np.arange(0.0, 0.2001, 0.005), 3)
BOOT_N = 1000     # remuestreos del bootstrap por día (F1)
BOOT_PCTL = 5      # percentil inferior que deciden boot_lo / boot_edge_lo

ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_DIR = ROOT / "api" / "artifacts" / "1m_dir"

XGB_PARAMS = dict(
    n_estimators=600, max_depth=5, learning_rate=0.03, subsample=0.8,
    colsample_bytree=0.7, min_child_weight=50, reg_lambda=5.0,
    objective="binary:logistic", eval_metric="logloss", tree_method="hist",
    enable_categorical=True, max_cat_to_onehot=16, early_stopping_rounds=50,
    n_jobs=-1, random_state=42)


# --------------------------------------------------------------------------- #
# Labels y dataset
# --------------------------------------------------------------------------- #
def make_labels(feat: pd.DataFrame, h: int) -> tuple[pd.Series, pd.Series]:
    """r_h sin cruzar el cierre; y=1/0 fuera de la banda muerta, NaN dentro."""
    fut = feat.groupby("day")["close"].shift(-h)
    r = np.log(fut / feat["close"])
    band = DEAD_BAND * feat["sig"] * np.sqrt(h)
    y = pd.Series(np.nan, index=feat.index)
    y[r > band] = 1.0
    y[r < -band] = 0.0
    return r, y


def assemble(features_by_ticker: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Labels POR ticker (el shift no debe cruzar de un ticker a otro) y concat."""
    frames = []
    for feat in features_by_ticker.values():
        f = feat.copy()
        for h in HORIZONS:
            f[f"r_{h}"], f[f"y_{h}"] = make_labels(f, h)
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


# --------------------------------------------------------------------------- #
# Validación
# --------------------------------------------------------------------------- #
def walk_forward_folds(days, n_folds: int = N_FOLDS,
                       min_train_days: int = MIN_TRAIN_DAYS) -> list[tuple[list, list]]:
    days = sorted(set(days))
    if len(days) < min_train_days + n_folds:
        raise ValueError(f"Pocas sesiones ({len(days)}) para {n_folds} folds "
                         f"con {min_train_days} de entrenamiento mínimo.")
    blocks = np.array_split(np.arange(min_train_days, len(days)), n_folds)
    return [(days[:b[0]], [days[i] for i in b]) for b in blocks]


def wilson_lower(k: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = k / n
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre - margin) / den


def confident_stats(p: np.ndarray, y: np.ndarray, tau: float) -> dict:
    mask = np.abs(p - 0.5) >= tau
    n = int(mask.sum())
    k = int(((p[mask] >= 0.5).astype(int) == y[mask]).sum())
    return {"n": n, "coverage": n / len(p) if len(p) else 0.0,
            "precision": k / n if n else None, "wilson_lo": wilson_lower(k, n)}


def choose_tau(p: np.ndarray, y: np.ndarray, min_coverage: float = MIN_COVERAGE) -> float:
    """τ que maximiza la cota de Wilson del acierto confiado, con cobertura mínima."""
    best_tau, best_lo = 0.0, -1.0
    for tau in TAU_GRID:
        s = confident_stats(p, y, tau)
        if s["coverage"] < min_coverage:
            break           # la cobertura solo baja al subir τ
        if s["wilson_lo"] > best_lo:
            best_tau, best_lo = float(tau), s["wilson_lo"]
    return best_tau


def block_bootstrap(p: np.ndarray, y: np.ndarray, day: np.ndarray, tau: float,
                    baseline_preds: dict[str, np.ndarray], n_boot: int = BOOT_N,
                    seed: int = 0) -> dict:
    """Bootstrap por DÍA completo, no por fila: dentro de un día las filas
    comparten camino de precio (h=30 son 29/30 el mismo futuro) y los 8 tickers
    se mueven juntos intradía (ρ≈0.6–0.8), así que remuestrear filas sueltas
    subestima el error y un Wilson i.i.d. sobre ellas puede dar luz verde a un
    modelo que solo montó una tendencia de unas pocas sesiones.

    Se remuestrean sesiones completas con reemplazo (mismo nº de días que el
    holdout) y en cada remuestreo se recalculan, sobre las filas CONFIADAS
    (|p−0.5|≥τ): el acierto del modelo y su ventaja sobre el mejor baseline en
    esas mismas filas. `boot_lo`/`boot_edge_lo` son el percentil `BOOT_PCTL`
    (5) de esas `n_boot` réplicas. Vectorizado: se agregan aciertos y conteos
    POR DÍA una sola vez y el remuestreo solo indexa y suma esos vectores."""
    day = np.asarray(day)
    conf = np.abs(p - 0.5) >= tau
    if len(day) == 0 or not conf.any():
        return {"boot_lo": 0.0, "boot_edge_lo": 0.0}

    model_hit = ((p >= 0.5).astype(int) == y).astype(float)
    base_hit = {name: (pred == y).astype(float) for name, pred in baseline_preds.items()}

    days = np.unique(day)
    n_days = len(days)
    day_idx = np.searchsorted(days, day)

    n_conf = np.bincount(day_idx[conf], minlength=n_days).astype(float)
    hits_model = np.bincount(day_idx[conf], weights=model_hit[conf], minlength=n_days)
    hits_base = {name: np.bincount(day_idx[conf], weights=hit[conf], minlength=n_days)
                 for name, hit in base_hit.items()}

    rng = np.random.default_rng(seed)
    sample = rng.integers(0, n_days, size=(n_boot, n_days))
    n_conf_b = n_conf[sample].sum(axis=1)
    hits_model_b = hits_model[sample].sum(axis=1)
    valid = n_conf_b > 0
    denom = np.where(valid, n_conf_b, 1.0)

    acc_b = np.full(n_boot, np.nan)
    acc_b[valid] = hits_model_b[valid] / denom[valid]

    if hits_base:
        base_acc_b = np.stack([hits_base[name][sample].sum(axis=1) / denom
                               for name in hits_base], axis=1)
        base_acc_b[~valid] = np.nan
        best_base_b = np.nanmax(base_acc_b, axis=1)
    else:
        best_base_b = np.full(n_boot, 0.5)

    edge_b = acc_b - best_base_b
    boot_lo = float(np.nanpercentile(acc_b, BOOT_PCTL)) if np.isfinite(acc_b).any() else 0.0
    boot_edge_lo = float(np.nanpercentile(edge_b, BOOT_PCTL)) if np.isfinite(edge_b).any() else 0.0
    return {"boot_lo": boot_lo, "boot_edge_lo": boot_edge_lo}


def fold_consistency_score(oof: np.ndarray, y: np.ndarray, day: pd.Series, tau: float,
                           earlier_folds: list[tuple[list, list]]) -> float:
    """Consistencia entre folds ANTERIORES (no el holdout): a τ fijo, qué
    fracción acertó más de la mitad de sus propias filas confiadas.

    Un fold anterior SIN ninguna fila confiada cuenta como FALLO, no se
    descarta: el denominador es siempre el nº de folds anteriores. Si se
    descartara, un τ que vacía de confianza los folds más tempranos (p. ej.
    porque ahí el modelo aún predecía con poco margen) subiría la
    consistencia por pura falta de datos, en vez de reflejar que esos folds
    no respaldan nada."""
    if not earlier_folds:
        return 0.0
    hits = 0
    for _, test_days_i in earlier_folds:
        mask_i = day.isin(test_days_i).to_numpy()
        p_i, y_i = oof[mask_i], y[mask_i]
        conf_i = np.abs(p_i - 0.5) >= tau
        acc_i = (float(((p_i[conf_i] >= 0.5).astype(int) == y_i[conf_i]).mean())
                if conf_i.any() else 0.0)
        hits += acc_i > 0.5
    return hits / len(earlier_folds)


def gate(stats: dict, min_coverage: float = MIN_COVERAGE) -> bool:
    """has_edge exige, todo sobre las mismas filas confiadas del holdout:
    cobertura mínima, que el bootstrap por día no cruce el 50 % (`boot_lo`) ni
    pierda ante el mejor baseline (`boot_edge_lo` > 0), y que al menos 2/3 de
    los folds walk-forward ANTERIORES, ya con τ fijo, hayan acertado más de la
    mitad de sus filas confiadas (`fold_consistency`) — un único fold favorable
    no basta cuando las filas están correlacionadas dentro del día."""
    return bool(stats["coverage"] >= min_coverage and stats["boot_lo"] > 0.5
                and stats["boot_edge_lo"] > 0 and stats["fold_consistency"] >= 2 / 3)


def _acc(pred: np.ndarray, y: np.ndarray) -> float | None:
    return float((pred == y).mean()) if len(y) else None


def _baseline_preds(frame: pd.DataFrame, majority: int) -> dict[str, np.ndarray]:
    """Si falta el dato (NaN), cae a la clase mayoritaria: NaN >= 0 y NaN < 0 son
    ambas False en numpy, así que sin este resguardo las dos señales predecían
    "baja" en silencio cada vez que faltaba el z-score, en vez de abstenerse."""
    mom = frame["ret_15_z"].to_numpy()
    rev = frame["dist_vwap_z"].to_numpy()
    momentum = np.where(np.isnan(mom), majority, (mom >= 0).astype(int))
    reversion = np.where(np.isnan(rev), majority, (rev < 0).astype(int))
    return {
        "majority": np.full(len(frame), majority),
        "momentum": momentum.astype(int),
        "reversion": reversion.astype(int),
    }


# --------------------------------------------------------------------------- #
# Entrenamiento de un horizonte
# --------------------------------------------------------------------------- #
def train_horizon(ds: pd.DataFrame, h: int, n_folds: int = N_FOLDS,
                  min_train_days: int = MIN_TRAIN_DAYS, params: dict | None = None):
    params = {**XGB_PARAMS, **(params or {})}
    lab = ds[ds[f"y_{h}"].notna()].reset_index(drop=True)
    X, y = lab[FEATURE_COLS], lab[f"y_{h}"].astype(int).to_numpy()
    day = lab["day"]
    folds = walk_forward_folds(day, n_folds, min_train_days)

    # Filas SIN etiqueta (dentro de la banda muerta) de los días de test: la
    # inferencia real las puntúa igual que las etiquetadas (F2), así que el
    # holdout también debe verlas para no sobrestimar la precisión de signo.
    unlab = ds[ds[f"y_{h}"].isna() & ds[f"r_{h}"].notna()].reset_index(drop=True)
    X_unlab = unlab[FEATURE_COLS]
    unlab_last_mask = unlab["day"].isin(folds[-1][1]).to_numpy()

    oof = np.full(len(lab), np.nan)
    fold_metrics, best_iters = [], []
    p_unlab_last = np.array([])
    for i, (train_days, test_days) in enumerate(folds):
        # Early stopping con el último 10 % de días de TRAIN, nunca con test.
        cut = max(1, int(len(train_days) * 0.9))
        fit = day.isin(train_days[:cut]).to_numpy()
        val = day.isin(train_days[cut:]).to_numpy()
        test = day.isin(test_days).to_numpy()

        model = XGBClassifier(**params)
        model.fit(X[fit], y[fit], eval_set=[(X[val], y[val])], verbose=False)
        best_iters.append(int(model.best_iteration) + 1)
        p = model.predict_proba(X[test])[:, 1]
        oof[test] = p
        # M1: baselines POR FOLD (no solo en el holdout final), con la clase
        # mayoritaria de su propio train — evidencia de si el modelo aporta
        # algo fold a fold, no solo en el promedio del último.
        train_mask = day.isin(train_days).to_numpy()
        fold_majority = int(y[train_mask].mean() >= 0.5) if train_mask.any() else 0
        fold_base_preds = _baseline_preds(lab[test], fold_majority)
        fold_metrics.append({
            "test_from": str(test_days[0]), "test_to": str(test_days[-1]),
            "n": int(test.sum()), "acc_all": _acc((p >= 0.5).astype(int), y[test]),
            "auc": float(roc_auc_score(y[test], p)) if len(set(y[test])) == 2 else None,
            "baselines": {name: _acc(pred, y[test]) for name, pred in fold_base_preds.items()},
        })
        if i == len(folds) - 1 and unlab_last_mask.any():
            # Mismo modelo que puntuó el holdout, ahora sobre sus filas sin etiqueta.
            p_unlab_last = model.predict_proba(X_unlab[unlab_last_mask])[:, 1]

    last = day.isin(folds[-1][1]).to_numpy()
    prior = ~last & np.isfinite(oof)
    tau = choose_tau(oof[prior], y[prior]) if prior.any() else 0.0

    fold_consistency = fold_consistency_score(oof, y, day, tau, folds[:-1])

    p_h, y_h = oof[last], y[last]
    holdout = confident_stats(p_h, y_h, tau)   # incluye wilson_lo, informativo (F1)
    holdout["acc_all"] = _acc((p_h >= 0.5).astype(int), y_h)
    confident = np.abs(p_h - 0.5) >= tau
    majority = int(y[~last].mean() >= 0.5)
    baseline_preds_last = _baseline_preds(lab[last], majority)
    baselines = {name: {"all": _acc(pred, y_h), "confident": _acc(pred[confident], y_h[confident])}
                 for name, pred in baseline_preds_last.items()}

    day_h = day[last].to_numpy()
    holdout.update(block_bootstrap(p_h, y_h, day_h, tau, baseline_preds_last, seed=0))
    holdout["fold_consistency"] = fold_consistency

    # F2: acierto de signo incluyendo las filas confiadas SIN etiqueta (banda
    # muerta) del holdout, con la misma τ — la inferencia real no las descarta.
    r_lab_h = lab[f"r_{h}"].to_numpy()[last]
    r_unlab_h = unlab[f"r_{h}"].to_numpy()[unlab_last_mask]
    conf_unlab = (np.abs(p_unlab_last - 0.5) >= tau if len(p_unlab_last)
                 else np.zeros(0, dtype=bool))
    pred_conf_lab = (p_h[confident] >= 0.5).astype(int)
    truth_conf_lab = (r_lab_h[confident] > 0).astype(int)
    pred_conf_unlab = (p_unlab_last[conf_unlab] >= 0.5).astype(int)
    truth_conf_unlab = (r_unlab_h[conf_unlab] > 0).astype(int)
    n_conf_all = len(pred_conf_lab) + len(pred_conf_unlab)
    holdout["flat_share"] = (len(pred_conf_unlab) / n_conf_all) if n_conf_all else 0.0
    if n_conf_all:
        pred_all = np.concatenate([pred_conf_lab, pred_conf_unlab])
        truth_all = np.concatenate([truth_conf_lab, truth_conf_unlab])
        holdout["precision_incl_flat"] = float((pred_all == truth_all).mean())
    else:
        holdout["precision_incl_flat"] = None

    has_edge = gate(holdout, MIN_COVERAGE)

    scored = np.isfinite(oof)
    hours = lab.loc[scored, "dt_et"].dt.hour.to_numpy()
    hits = ((oof[scored] >= 0.5).astype(int) == y[scored])
    # Informativo: acierto por hora sobre TODAS las filas fuera de muestra de
    # todos los folds (no solo el holdout, no filtra por τ); no decide has_edge.
    by_hour_all_oof = {int(hr): float(hits[hours == hr].mean()) for hr in sorted(set(hours))}

    final_params = {**params, "n_estimators": max(20, int(np.median(best_iters))),
                    "early_stopping_rounds": None}
    final = XGBClassifier(**final_params)
    final.fit(X, y, verbose=False)
    importance = sorted(zip(FEATURE_COLS, final.feature_importances_.tolist()),
                        key=lambda kv: kv[1], reverse=True)[:15]

    abs_ret = ds.groupby(ds["ticker"].astype(str))[f"r_{h}"].apply(lambda s: s.abs().mean())

    return final, {
        "tau": tau, "holdout": holdout, "baselines": baselines, "has_edge": has_edge,
        "folds": fold_metrics, "by_hour_all_oof": by_hour_all_oof,
        "top_features": [{"feature": f, "importance": v} for f, v in importance],
        "n_estimators": final_params["n_estimators"], "n_labeled": int(len(lab)),
        "abs_ret_mean": {t: float(v) for t, v in abs_ret.items() if np.isfinite(v)},
    }


# --------------------------------------------------------------------------- #
# Reporte y CLI
# --------------------------------------------------------------------------- #
def _clean(obj):
    """NaN → None y tipos numpy → Python: el meta lo lee JavaScript, que no acepta NaN."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        return None if not np.isfinite(obj) else float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _pct(x) -> str:
    return "—" if x is None else f"{x:.1%}"


def format_report(meta: dict) -> str:
    lines = ["# Modelo 1m de dirección — reporte de entrenamiento", "",
             f"Entrenado {meta['trained_at']} · {meta['n_rows']} filas · "
             f"{meta['sessions']} sesiones · tickers {' '.join(meta['tickers'])}", "",
             "| h | acierto total | acierto confiado | cobertura | boot_lo (día, p5) "
             "| consistencia folds | mejor baseline (confiado) | has_edge |",
             "|---|---|---|---|---|---|---|---|"]
    for h, hm in meta["horizons"].items():
        ho = hm["holdout"]
        best = max(((k, v["confident"]) for k, v in hm["baselines"].items()
                    if v["confident"] is not None), key=lambda kv: kv[1], default=("—", None))
        lines.append(f"| {h} min | {_pct(ho['acc_all'])} | {_pct(ho['precision'])} "
                     f"| {_pct(ho['coverage'])} | {_pct(ho['boot_lo'])} "
                     f"| {_pct(ho['fold_consistency'])} "
                     f"| {best[0]} {_pct(best[1])} | {'sí' if hm['has_edge'] else 'no'} |")
    old = []
    for t in ("NVDA", "QQQ", "SNDK"):
        path = ROOT / "api" / "artifacts" / f"meta_1m_{t}.json"
        if path.exists():
            acc = json.loads(path.read_text()).get("metrics", {}).get("directional_accuracy")
            old.append(f"{t} {_pct(acc)}")
    if old:
        lines += ["", "Modelo 1m actual (signo del siguiente minuto, otra pregunta): " + ", ".join(old)]
    return "\n".join(lines) + "\n"


def _ensure_enough_sessions(ticker: str, bars: pd.DataFrame, min_days: int) -> None:
    """Guarda per-ticker: barras vacías o pocas sesiones es un fallo claro y
    temprano en CI, en vez de un NaT silencioso más adelante en load_news o un
    walk_forward_folds que revienta con un mensaje genérico sin decir de quién."""
    days = bars["dt_et"].dt.date.nunique() if len(bars) else 0
    if days < min_days:
        raise RuntimeError(f"{ticker}: solo {days} sesiones descargadas "
                           f"(mínimo {min_days}); revisa la caché o Polygon.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=252)
    args = ap.parse_args()
    sessions_requested = args.sessions
    need = sessions_requested + HISTORY_SESSIONS
    min_days = MIN_TRAIN_DAYS + N_FOLDS

    print(f"[1/3] Descargando {need} sesiones de 1 min: contexto {CONTEXT_SYMBOLS}...")
    context = {}
    for s in CONTEXT_SYMBOLS:
        context[s] = load_bars(s, need)
        _ensure_enough_sessions(s, context[s], min_days)
    features = {}
    for t in TICKERS:
        bars = context[t] if t in context else load_bars(t, need)
        _ensure_enough_sessions(t, bars, min_days)
        news = load_news(t, bars["dt_et"].min().date())
        features[t] = build_features(bars, t, context, news)
        print(f"      {t}: {len(features[t])} filas · {len(news)} noticias")
    ds = assemble(features)

    meta = {"model": "XGBoost-1m-direction",
            "trained_at": dt.datetime.utcnow().isoformat() + "Z",
            "tickers": list(TICKERS), "context": list(CONTEXT_SYMBOLS),
            "feature_cols": FEATURE_COLS, "dead_band": DEAD_BAND,
            "history_sessions": HISTORY_SESSIONS, "sessions": int(ds["day"].nunique()),
            "sessions_requested": sessions_requested,
            "n_rows": int(len(ds)), "horizons": {}}

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    for h in HORIZONS:
        print(f"[2/3] Horizonte {h} min: walk-forward de {N_FOLDS} folds...")
        model, hm = train_horizon(ds, h)
        joblib.dump(model, ARTIFACT_DIR / f"xgb_h{h}.joblib")
        meta["horizons"][str(h)] = hm

    meta = _clean(meta)
    (ARTIFACT_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    report = format_report(meta)
    (ARTIFACT_DIR / "report.md").write_text(report)
    print("[3/3] Artefactos en", ARTIFACT_DIR)
    print(report)


if __name__ == "__main__":
    main()
