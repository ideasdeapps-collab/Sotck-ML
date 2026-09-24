"""Barras de 1 min y noticias sintéticas, deterministas, para los tests del
modelo de dirección. 390 barras por sesión hábil, con `vw` y `n` como Polygon."""
import numpy as np
import pandas as pd


def bars(n_days: int = 30, seed: int = 0, start: str = "2026-01-05",
         price: float = 100.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    frames = []
    for d in pd.bdate_range(start, periods=n_days):
        idx = pd.date_range(f"{d.date()} 09:30", periods=390, freq="1min",
                            tz="America/New_York")
        close = price * np.exp(np.cumsum(rng.normal(0, 0.001, 390)))
        open_ = np.r_[price * np.exp(rng.normal(0, 0.004)), close[:-1]]
        high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.0005, 390))
        low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.0005, 390))
        frames.append(pd.DataFrame({
            "dt_et": idx, "open": open_, "high": high, "low": low, "close": close,
            "volume": rng.integers(1000, 5000, 390).astype(float),
            "vw": (high + low + close) / 3,
            "n": rng.integers(10, 60, 390).astype(float),
        }))
        price = float(close[-1])
    return pd.concat(frames, ignore_index=True)


def news(n: int = 40, seed: int = 0, start: str = "2026-01-05",
         days: int = 30) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    base = pd.Timestamp(f"{start} 00:00", tz="UTC")
    minutes = np.sort(rng.uniform(0, days * 1440, n))
    return pd.DataFrame({
        "id": [f"a{i}" for i in range(n)],
        "ts": base + pd.to_timedelta(minutes, unit="min"),
        "sent": rng.choice([-1, 0, 1], n),
    })
