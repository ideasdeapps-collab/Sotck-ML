"""
events_1m.py — Días de evento macro para el modelo de dirección de 1 min
=======================================================================
FOMC: días de decisión desde macro_calendar.csv (la Fed publica el calendario
con un año de antelación; hay que añadir el año siguiente cada diciembre).

Empleo (NFP): se aproxima como el primer viernes del mes. El BLS a veces lo
mueve (festivos, cierres de gobierno); el error es de pocos días al año y la
feature solo marca régimen, no es una señal por sí misma.
"""

from __future__ import annotations
import datetime as dt
from pathlib import Path
from typing import Iterable

import pandas as pd

CALENDAR = Path(__file__).resolve().parent / "macro_calendar.csv"


def load_fomc_days(path: Path = CALENDAR) -> set[dt.date]:
    cal = pd.read_csv(path, parse_dates=["date"])
    return set(cal.loc[cal["event"] == "FOMC", "date"].dt.date)


def is_nfp_day(d: dt.date) -> bool:
    return d.weekday() == 4 and d.day <= 7


def macro_flags(days: Iterable[dt.date], fomc_days: set[dt.date]) -> pd.DataFrame:
    days = list(days)
    return pd.DataFrame({
        "is_fomc_day": [float(d in fomc_days) for d in days],
        "is_nfp_day": [float(is_nfp_day(d)) for d in days],
    }, index=days)
