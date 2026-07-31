from app.schemas import MarketAnalysisRequest, MarketAnalysisResponse
from app.services.feature_engineering import engineer_features, resolve_regime, resolve_risk_level, resolve_trend
from app.services.model_service import MarketModelService


class MarketAnalysisService:
    def __init__(self, model_service: MarketModelService) -> None:
        self.model_service = model_service

    def analyze(self, request: MarketAnalysisRequest) -> MarketAnalysisResponse:
        engineered = engineer_features(request.features)
        confidence = self.model_service.predict_confidence(request.features)
        regime = resolve_regime(engineered)
        trend = resolve_trend(engineered)
        risk = resolve_risk_level(engineered)
        reasons = self._reasons(confidence, request.confidence_threshold, engineered, regime.value, risk.value)

        return MarketAnalysisResponse(
            symbol=request.features.symbol.upper(),
            trade_confidence_score=confidence,
            passed=confidence >= request.confidence_threshold and risk.value != "HIGH",
            market_regime=regime,
            trend_direction=trend,
            risk_level=risk,
            model_name=self.model_service.model_name,
            reasons=reasons,
            engineered_features={key: round(value, 6) for key, value in engineered.items()},
        )

    def _reasons(
        self,
        confidence: float,
        threshold: float,
        engineered: dict[str, float],
        regime: str,
        risk: str,
    ) -> list[str]:
        reasons = [f"confidence={confidence} threshold={threshold}", f"market_regime={regime}", f"risk_level={risk}"]
        if confidence < threshold:
            reasons.append("Signal filtered by confidence threshold")
        if engineered["risk_pressure"] >= 66:
            reasons.append("High risk pressure from volatility/funding/liquidation metrics")
        if engineered["volume_ratio"] < 0.8:
            reasons.append("Weak volume confirmation")
        return reasons
