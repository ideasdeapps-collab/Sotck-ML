"""
train_xgb_1m_dir.py — Modelo XGBoost de DIRECCIÓN a 5/15/30 min (1 minuto)
=========================================================================
AISLADO de train_xgb_1m.py: no predice el retorno del siguiente minuto (ruido,
~50 % durante semanas de reentrenos) sino si el precio subirá o bajará más allá
de una banda de ruido en h minutos, con probabilidad. Un modelo AGRUPADO por
horizonte (8 tickers líquidos, el ticker como feature categórica).

Validación: walk-forward por días (cada fold entrena con todo lo anterior y
prueba el bloque siguiente). El umbral de confianza τ se elige con los folds
previos y se mide en el último; `has_edge` solo es true si el acierto confiado
supera, con su cota de Wilson, al 50 % y al mejor baseline en las mismas filas.

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


def gate(stats: dict, baseline_accs: dict, min_coverage: float = MIN_COVERAGE) -> bool:
    best = max([a for a in baseline_accs.values() if a is not None], default=0.5)
    return bool(stats["coverage"] >= min_coverage and stats["wilson_lo"] > 0.5
                and stats["wilson_lo"] > best)


def _acc(pred: np.ndarray, y: np.ndarray) -> float | None:
    return float((pred == y).mean()) if len(y) else None


def _baseline_preds(frame: pd.DataFrame, majority: int) -> dict[str, np.ndarray]:
    return {
        "majority": np.full(len(frame), majority),
        "momentum": (frame["ret_15_z"].to_numpy() >= 0).astype(int),
        "reversion": (frame["dist_vwap_z"].to_numpy() < 0).astype(int),
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

    oof = np.full(len(lab), np.nan)
    fold_metrics, best_iters = [], []
    for train_days, test_days in folds:
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
        fold_metrics.append({
            "test_from": str(test_days[0]), "test_to": str(test_days[-1]),
            "n": int(test.sum()), "acc_all": _acc((p >= 0.5).astype(int), y[test]),
            "auc": float(roc_auc_score(y[test], p)) if len(set(y[test])) == 2 else None,
        })

    last = day.isin(folds[-1][1]).to_numpy()
    prior = ~last & np.isfinite(oof)
    tau = choose_tau(oof[prior], y[prior]) if prior.any() else 0.0

    p_h, y_h = oof[last], y[last]
    holdout = confident_stats(p_h, y_h, tau)
    holdout["acc_all"] = _acc((p_h >= 0.5).astype(int), y_h)
    confident = np.abs(p_h - 0.5) >= tau
    majority = int(y[~last].mean() >= 0.5)
    baselines = {name: {"all": _acc(pred, y_h), "confident": _acc(pred[confident], y_h[confident])}
                 for name, pred in _baseline_preds(lab[last], majority).items()}
    has_edge = gate(holdout, {k: v["confident"] for k, v in baselines.items()})

    scored = np.isfinite(oof)
    hours = lab.loc[scored, "dt_et"].dt.hour.to_numpy()
    hits = ((oof[scored] >= 0.5).astype(int) == y[scored])
    by_hour = {int(hr): float(hits[hours == hr].mean()) for hr in sorted(set(hours))}

    final_params = {**params, "n_estimators": max(20, int(np.median(best_iters))),
                    "early_stopping_rounds": None}
    final = XGBClassifier(**final_params)
    final.fit(X, y, verbose=False)
    importance = sorted(zip(FEATURE_COLS, final.feature_importances_.tolist()),
                        key=lambda kv: kv[1], reverse=True)[:15]

    abs_ret = ds.groupby(ds["ticker"].astype(str))[f"r_{h}"].apply(lambda s: s.abs().mean())

    return final, {
        "tau": tau, "holdout": holdout, "baselines": baselines, "has_edge": has_edge,
        "folds": fold_metrics, "by_hour": by_hour,
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
             "| h | acierto total | acierto confiado | cobertura | Wilson 95 % inf. "
             "| mejor baseline (confiado) | has_edge |",
             "|---|---|---|---|---|---|---|"]
    for h, hm in meta["horizons"].items():
        ho = hm["holdout"]
        best = max(((k, v["confident"]) for k, v in hm["baselines"].items()
                    if v["confident"] is not None), key=lambda kv: kv[1], default=("—", None))
        lines.append(f"| {h} min | {_pct(ho['acc_all'])} | {_pct(ho['precision'])} "
                     f"| {_pct(ho['coverage'])} | {_pct(ho['wilson_lo'])} "
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=252)
    args = ap.parse_args()
    need = args.sessions + HISTORY_SESSIONS

    print(f"[1/3] Descargando {need} sesiones de 1 min: contexto {CONTEXT_SYMBOLS}...")
    context = {s: load_bars(s, need) for s in CONTEXT_SYMBOLS}
    features = {}
    for t in TICKERS:
        bars = context[t] if t in context else load_bars(t, need)
        news = load_news(t, bars["dt_et"].min().date())
        features[t] = build_features(bars, t, context, news)
        print(f"      {t}: {len(features[t])} filas · {len(news)} noticias")
    ds = assemble(features)

    meta = {"model": "XGBoost-1m-direction",
            "trained_at": dt.datetime.utcnow().isoformat() + "Z",
            "tickers": list(TICKERS), "context": list(CONTEXT_SYMBOLS),
            "feature_cols": FEATURE_COLS, "dead_band": DEAD_BAND,
            "history_sessions": HISTORY_SESSIONS, "sessions": args.sessions,
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
