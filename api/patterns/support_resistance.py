class SupportResistanceDetector:
    """Soporte y resistencia.

    El chartismo de verdad (pivotes fractales + clustering con nº de toques) ya
    vive en intraday.py.  Si el llamador lo pasa en `levels`, se usa ese; el
    max/min de las últimas 50 velas queda solo como último recurso para quien
    invoque el detector suelto, sin contexto intradía.
    """

    name = "Support Resistance"

    def analyze(self, candles, levels=None):
        if levels and (levels.get("support") or levels.get("resistance")):
            support_levels = levels.get("support", [])
            resistance_levels = levels.get("resistance", [])
            return {
                "support": support_levels[0]["level"] if support_levels else None,
                "resistance": resistance_levels[0]["level"] if resistance_levels else None,
                "zones": (
                    [{"type": "SUPPORT", "price": l["level"], "touches": l["touches"]}
                     for l in support_levels]
                    + [{"type": "RESISTANCE", "price": l["level"], "touches": l["touches"]}
                       for l in resistance_levels]
                ),
            }

        if not candles:
            return {"support": None, "resistance": None, "zones": []}

        resistance = max(c["high"] for c in candles[-50:])
        support = min(c["low"] for c in candles[-50:])

        return {
            "support": support,
            "resistance": resistance,
            "zones": [
                {"type": "SUPPORT", "price": support, "touches": 1},
                {"type": "RESISTANCE", "price": resistance, "touches": 1},
            ],
        }
