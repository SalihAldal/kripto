from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class TrendDirection(str, Enum):
    bullish = "BULLISH"
    bearish = "BEARISH"
    sideways = "SIDEWAYS"


class MarketRegime(str, Enum):
    trending = "TRENDING"
    ranging = "RANGING"
    volatile = "VOLATILE"
    squeeze = "SQUEEZE"
    risk_off = "RISK_OFF"


class RiskLevel(str, Enum):
    low = "LOW"
    mid = "MID"
    high = "HIGH"


class MarketFeatures(BaseModel):
    symbol: str = Field(..., min_length=3)
    rsi: float = Field(..., ge=0, le=100)
    macd: float
    macd_signal: float
    ema_fast: float = Field(..., gt=0)
    ema_slow: float = Field(..., gt=0)
    volume: float = Field(..., ge=0)
    volume_avg: float = Field(..., ge=0)
    funding_rate: float = 0
    open_interest: float = Field(0, ge=0)
    open_interest_change_percent: float = 0
    liquidation_heatmap_score: float = Field(0, ge=0, le=100)
    btc_dominance: float = Field(50, ge=0, le=100)
    volatility: float = Field(0, ge=0)
    signal_side: Literal["BUY", "SELL", "HOLD"] = "HOLD"


class MarketAnalysisRequest(BaseModel):
    features: MarketFeatures
    confidence_threshold: float = Field(65, ge=0, le=100)


class MarketAnalysisResponse(BaseModel):
    symbol: str
    trade_confidence_score: float
    passed: bool
    market_regime: MarketRegime
    trend_direction: TrendDirection
    risk_level: RiskLevel
    model_name: str
    reasons: list[str]
    engineered_features: dict[str, float]


class TrainingRow(MarketFeatures):
    label: int = Field(..., ge=0, le=1)


class TrainRequest(BaseModel):
    rows: list[TrainingRow] = Field(..., min_length=30)
    model_type: Literal["xgboost", "lightgbm"] = "xgboost"


class TrainResponse(BaseModel):
    model_name: str
    rows: int
    accuracy: float
    saved: bool


class BacktestRequest(BaseModel):
    rows: list[TrainingRow] = Field(..., min_length=10)
    confidence_threshold: float = Field(65, ge=0, le=100)


class BacktestResponse(BaseModel):
    rows: int
    accepted: int
    rejected: int
    precision: float
    false_signal_filter_rate: float


class DecisionEngineV2TrainingRow(BaseModel):
    features: dict[str, float]
    label: Literal["BUY", "WAIT", "NO_TRADE"]
    return_pct: float | None = None


class DecisionEngineV2TrainRequest(BaseModel):
    rows: list[DecisionEngineV2TrainingRow] = Field(..., min_length=30)
    model_type: Literal["xgboost", "lightgbm", "catboost", "gradient_boosting"] = "lightgbm"
    feature_names: list[str] = Field(default_factory=list)


class DecisionEngineV2TrainResponse(BaseModel):
    model_type: str
    artifact: dict
    validation_metrics: list[dict]
    feature_importance: list[dict]
    summary: dict
