from pathlib import Path
from typing import Iterable

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split

from app.schemas import MarketFeatures, TrainingRow
from app.services.feature_engineering import FEATURE_COLUMNS, engineer_features

MODEL_PATH = Path(__file__).resolve().parents[1] / "storage" / "market_model.joblib"


class MarketModelService:
    def __init__(self) -> None:
        self.model_name = "heuristic"
        self.model = self._load_model()

    def predict_confidence(self, features: MarketFeatures) -> float:
        engineered = engineer_features(features)
        if self.model is None:
            return self._heuristic_confidence(features, engineered)
        frame = pd.DataFrame([{key: engineered[key] for key in FEATURE_COLUMNS}])
        probability = float(self.model.predict_proba(frame)[0][1])
        return round(probability * 100, 2)

    def train(self, rows: list[TrainingRow], model_type: str) -> tuple[str, float, bool]:
        frame = self._to_frame(rows)
        labels = np.array([row.label for row in rows])
        x_train, x_test, y_train, y_test = train_test_split(
            frame,
            labels,
            test_size=0.25,
            random_state=42,
            stratify=labels if len(set(labels)) > 1 else None,
        )
        model = self._build_model(model_type)
        model.fit(x_train, y_train)
        prediction = model.predict(x_test)
        accuracy = float(accuracy_score(y_test, prediction))
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": model, "model_name": model_type}, MODEL_PATH)
        self.model = model
        self.model_name = model_type
        return model_type, round(accuracy, 4), True

    def _load_model(self):
        if not MODEL_PATH.exists():
            return None
        payload = joblib.load(MODEL_PATH)
        self.model_name = str(payload.get("model_name", "loaded-model"))
        return payload.get("model")

    def _build_model(self, model_type: str):
        if model_type == "lightgbm":
            try:
                from lightgbm import LGBMClassifier

                return LGBMClassifier(n_estimators=250, learning_rate=0.04, max_depth=5, random_state=42)
            except Exception:
                self.model_name = "gradient-boosting-fallback"
        if model_type == "xgboost":
            try:
                from xgboost import XGBClassifier

                return XGBClassifier(
                    n_estimators=250,
                    learning_rate=0.04,
                    max_depth=5,
                    subsample=0.85,
                    colsample_bytree=0.85,
                    eval_metric="logloss",
                    random_state=42,
                )
            except Exception:
                self.model_name = "gradient-boosting-fallback"
        return GradientBoostingClassifier(random_state=42)

    def _to_frame(self, rows: Iterable[TrainingRow]) -> pd.DataFrame:
        data = []
        for row in rows:
            engineered = engineer_features(row)
            data.append({key: engineered[key] for key in FEATURE_COLUMNS})
        return pd.DataFrame(data)

    def _heuristic_confidence(self, features: MarketFeatures, engineered: dict[str, float]) -> float:
        trend_alignment = 0.0
        if features.signal_side == "BUY":
            trend_alignment = max(0, engineered["trend_bias"])
        elif features.signal_side == "SELL":
            trend_alignment = max(0, -engineered["trend_bias"])
        volume_score = min(engineered["volume_ratio"], 3) * 12
        rsi_score = 18 if 28 <= features.rsi <= 68 else 6
        risk_penalty = engineered["risk_pressure"] * 0.35
        confidence = 45 + trend_alignment * 0.22 + volume_score + rsi_score - risk_penalty
        return round(max(0, min(100, confidence)), 2)
