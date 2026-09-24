"""Días de evento macro."""
import datetime as dt
import sys
from pathlib import Path

API = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API.parent / "training"))

import events_1m


def test_el_calendario_trae_las_decisiones_fomc():
    days = events_1m.load_fomc_days()
    assert dt.date(2026, 9, 16) in days
    assert dt.date(2026, 9, 15) not in days


def test_el_empleo_es_el_primer_viernes():
    assert events_1m.is_nfp_day(dt.date(2026, 9, 4))
    assert not events_1m.is_nfp_day(dt.date(2026, 9, 11))
    assert not events_1m.is_nfp_day(dt.date(2026, 9, 3))


def test_macro_flags_por_dia():
    days = [dt.date(2026, 9, 4), dt.date(2026, 9, 16), dt.date(2026, 9, 17)]
    flags = events_1m.macro_flags(days, {dt.date(2026, 9, 16)})
    assert flags.loc[dt.date(2026, 9, 16), "is_fomc_day"] == 1.0
    assert flags.loc[dt.date(2026, 9, 4), "is_nfp_day"] == 1.0
    assert flags.loc[dt.date(2026, 9, 17)].sum() == 0.0
