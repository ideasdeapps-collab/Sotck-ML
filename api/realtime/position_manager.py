class PositionManager:
    def create_position(self, ticker, entry):
        return {
            "ticker": ticker,
            "entry": entry,
            "stop": round(entry * 0.98, 2),
            "status": "RUNNING"
        }

    def update(self, position, current):
        position["current"] = current
        if current > position["entry"]:
            position["stop"] = max(position["stop"], current * 0.99)
        return position
