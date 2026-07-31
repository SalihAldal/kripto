from app.schemas import MarketFeatures, MarketRegime, RiskLevel, TrendDirection


FEATURE_COLUMNS = [
    "rsi",
    "macd_histogram",
    "ema_spread_percent",
    "volume_ratio",
    "funding_rate",
    "open_interest_change_percent",
    "liquidation_heatmap_score",
    "btc_dominance",
    "volatility",
    "trend_bias",
    "risk_pressure",
]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def engineer_features(features: MarketFeatures) -> dict[str, float]:
    macd_histogram = features.macd - features.macd_signal
    ema_spread_percent = ((features.ema_fast - features.ema_slow) / features.ema_slow) * 100
    volume_ratio = features.volume / features.volume_avg if features.volume_avg > 0 else 0
    trend_bias = clamp(ema_spread_percent * 8 + macd_histogram * 2, -100, 100)
    risk_pressure = clamp(
        features.volatility * 9
        + abs(features.funding_rate) * 260
        + features.liquidation_heatmap_score * 0.45
        + max(0, 52 - features.btc_dominance) * 1.2,
        0,
        100,
    )

    return {
        "rsi": features.rsi,
        "macd_histogram": macd_histogram,
        "ema_spread_percent": ema_spread_percent,
        "volume_ratio": volume_ratio,
        "funding_rate": features.funding_rate,
        "open_interest_change_percent": features.open_interest_change_percent,
        "liquidation_heatmap_score": features.liquidation_heatmap_score,
        "btc_dominance": features.btc_dominance,
        "volatility": features.volatility,
        "trend_bias": trend_bias,
        "risk_pressure": risk_pressure,
    }


def resolve_trend(engineered: dict[str, float]) -> TrendDirection:
    trend_bias = engineered["trend_bias"]
    if trend_bias >= 8:
        return TrendDirection.bullish
    if trend_bias <= -8:
        return TrendDirection.bearish
    return TrendDirection.sideways


def resolve_regime(engineered: dict[str, float]) -> MarketRegime:
    volatility = engineered["volatility"]
    volume_ratio = engineered["volume_ratio"]
    trend_bias = abs(engineered["trend_bias"])
    risk_pressure = engineered["risk_pressure"]
    if risk_pressure >= 72:
        return MarketRegime.risk_off
    if volatility >= 5:
        return MarketRegime.volatile
    if trend_bias >= 18 and volume_ratio >= 1.1:
        return MarketRegime.trending
    if volatility <= 1.2 and volume_ratio <= 0.8:
        return MarketRegime.squeeze
    return MarketRegime.ranging


def resolve_risk_level(engineered: dict[str, float]) -> RiskLevel:
    pressure = engineered["risk_pressure"]
    if pressure >= 66:
        return RiskLevel.high
    if pressure >= 36:
        return RiskLevel.mid
    return RiskLevel.low
