from fastapi import FastAPI

from app.schemas import (
    BacktestRequest,
    BacktestResponse,
    DecisionEngineV2TrainRequest,
    DecisionEngineV2TrainResponse,
    MarketAnalysisRequest,
    MarketAnalysisResponse,
    TrainRequest,
    TrainResponse,
)
from app.services.analysis_service import MarketAnalysisService
from app.services.backtest_service import BacktestService
from app.services.decision_engine_v2_service import train_decision_engine_v2
from app.services.model_service import MarketModelService

app = FastAPI(title="Market Analysis ML Service", version="1.0.0")

model_service = MarketModelService()
analysis_service = MarketAnalysisService(model_service)
backtest_service = BacktestService(analysis_service)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": model_service.model_name}


@app.post("/analyze", response_model=MarketAnalysisResponse)
def analyze(request: MarketAnalysisRequest) -> MarketAnalysisResponse:
    return analysis_service.analyze(request)


@app.post("/train", response_model=TrainResponse)
def train(request: TrainRequest) -> TrainResponse:
    model_name, accuracy, saved = model_service.train(request.rows, request.model_type)
    return TrainResponse(model_name=model_name, rows=len(request.rows), accuracy=accuracy, saved=saved)


@app.post("/backtest", response_model=BacktestResponse)
def backtest(request: BacktestRequest) -> BacktestResponse:
    return backtest_service.run(request)


@app.post("/v2/train", response_model=DecisionEngineV2TrainResponse)
def train_decision_v2(request: DecisionEngineV2TrainRequest) -> DecisionEngineV2TrainResponse:
    feature_names = request.feature_names or sorted({key for row in request.rows for key in row.features.keys()})
    payload = train_decision_engine_v2(
        [row.model_dump() for row in request.rows],
        request.model_type,
        feature_names,
    )
    return DecisionEngineV2TrainResponse(**payload)
