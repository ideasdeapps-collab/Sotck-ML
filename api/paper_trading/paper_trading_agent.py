from datetime import datetime


class PaperTradingAgent:
    def __init__(self):
        self.positions = []
        self.history = []

    def execute(self, signal):
        action = signal.get("action") or signal.get("decision", {}).get("action")
        plan = signal.get("trade_plan", {})

        trade = {
            "ticker": signal.get("ticker"),
            "action": action,
            "entry": plan.get("entry"),
            "stop_loss": plan.get("stop_loss"),
            "target": plan.get("target"),
            "status": "OPEN",
            "opened_at": datetime.utcnow().isoformat()
        }

        if action == "BUY":
            self.positions.append(trade)

        self.history.append(trade)
        return trade

    def monitor(self, price):
        updates = []

        for position in self.positions:
            if price <= position["stop_loss"]:
                position["status"] = "STOPPED"
            elif price >= position["target"]:
                position["status"] = "TARGET_HIT"
            updates.append(position)

        return updates
