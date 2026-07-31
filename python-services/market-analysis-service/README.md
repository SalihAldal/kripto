# Market Analysis ML Service

Python FastAPI microservice for filtering crypto bot signals with engineered market features and an XGBoost/LightGBM-compatible model pipeline.

## Run

```bash
cd python-services/market-analysis-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

## Endpoints

- `GET /health`
- `POST /analyze`
- `POST /train`
- `POST /backtest`

The service loads `app/storage/market_model.joblib` when available. If no trained model exists, it uses a deterministic heuristic confidence model so the API remains usable.
