class AutonomousTradingBrain:
    def __init__(self, strategy_engine=None, decision_engine=None, paper_agent=None, learning_engine=None):
        self.strategy_engine = strategy_engine
        self.decision_engine = decision_engine
        self.paper_agent = paper_agent
        self.learning_engine = learning_engine

    def analyze_market(self, context):
        strategy = context.get("strategy")
        decision = self.decision_engine.decide(
            context["ticker"],
            context["market_regime"],
            context.get("patterns", {}),
            strategy,
            context["price"],
            context.get("volatility", 1),
        )

        if decision["decision"]["action"] == "BUY":
            trade = self.paper_agent.execute(decision)
        else:
            trade = None

        return {
            "decision": decision,
            "paper_trade": trade,
            "status": "MONITORING"
        }
