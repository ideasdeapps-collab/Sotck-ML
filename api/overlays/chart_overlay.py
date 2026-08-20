def build_chart_overlay(patterns):
    return {
        "support_resistance": patterns.get("support_resistance", {}),
        "fvg_rectangles": patterns.get("fair_value_gaps", []),
        "order_blocks": patterns.get("order_blocks", []),
        "liquidity_markers": patterns.get("liquidity", {}),
    }
