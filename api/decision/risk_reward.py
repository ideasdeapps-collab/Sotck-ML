def calculate_risk_reward(entry: float, stop_loss: float, target: float):
    risk = abs(entry - stop_loss)
    reward = abs(target - entry)
    ratio = round(reward / risk, 2) if risk else 0
    return {
        "risk": round(risk, 2),
        "reward": round(reward, 2),
        "risk_reward": ratio,
        "approved": ratio >= 1.5,
    }
