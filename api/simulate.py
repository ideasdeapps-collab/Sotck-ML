"""
simulate.py
-----------
Simulación de escenarios de precio vía Monte Carlo con Movimiento Browniano
Geométrico (GBM). Devuelve la mediana y las bandas de percentiles (P5-P95, P25-P75)
para graficar el "abanico" de riesgo.

Modelo:  S_t = S_0 * exp[(mu - 0.5*sigma^2)*t + sigma*W_t]
"""

from __future__ import annotations
import numpy as np


def monte_carlo_gbm(
    s0: float,
    mu_daily: float,
    sigma_daily: float,
    horizon: int = 30,
    n_sims: int = 10_000,
    seed: int | None = 42,
) -> dict:
    """
    Simula n_sims trayectorias de precio a 'horizon' días.

    Parametros
    ----------
    s0           : precio inicial (ultimo cierre)
    mu_daily     : deriva diaria (media de log-retornos historicos)
    sigma_daily  : volatilidad diaria (std de log-retornos historicos)
    horizon      : dias a proyectar
    n_sims       : numero de trayectorias
    seed         : semilla para reproducibilidad

    Devuelve
    --------
    dict con listas (largo = horizon) de mediana y percentiles, mas
    un resumen del precio terminal.
    """
    if seed is not None:
        np.random.seed(seed)

    dt = 1.0  # paso = 1 dia (mu/sigma ya son diarios)
    # Shocks aleatorios normales: (horizon, n_sims)
    z = np.random.normal(size=(horizon, n_sims))
    daily_factor = np.exp((mu_daily - 0.5 * sigma_daily**2) * dt
                          + sigma_daily * np.sqrt(dt) * z)
    # Trayectorias acumuladas
    paths = s0 * np.cumprod(daily_factor, axis=0)

    def pct(p):
        return np.percentile(paths, p, axis=1).round(4).tolist()

    terminal = paths[-1, :]
    return {
        "horizon": horizon,
        "n_sims": n_sims,
        "s0": round(s0, 4),
        "median": np.median(paths, axis=1).round(4).tolist(),
        "mean": paths.mean(axis=1).round(4).tolist(),
        "p5": pct(5),
        "p25": pct(25),
        "p75": pct(75),
        "p95": pct(95),
        "terminal": {
            "median": round(float(np.median(terminal)), 4),
            "p5": round(float(np.percentile(terminal, 5)), 4),
            "p95": round(float(np.percentile(terminal, 95)), 4),
            "prob_up": round(float(np.mean(terminal > s0)), 4),
            "expected_return": round(float(np.median(terminal) / s0 - 1), 4),
        },
    }


if __name__ == "__main__":
    # Demo rapida
    out = monte_carlo_gbm(s0=100, mu_daily=0.0004, sigma_daily=0.015, horizon=30)
    print("Terminal:", out["terminal"])
