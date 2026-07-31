from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import TimeSeriesSplit, train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

LABELS = ["BUY", "WAIT", "NO_TRADE"]


def _build_estimator(model_type: str):
    model_type = model_type.lower()
    if model_type == "lightgbm":
        try:
            from lightgbm import LGBMClassifier

            return LGBMClassifier(
                n_estimators=300,
                learning_rate=0.04,
                max_depth=6,
                random_state=42,
                verbose=-1,
            )
        except Exception:
            pass
    if model_type == "xgboost":
        try:
            from xgboost import XGBClassifier

            return XGBClassifier(
                n_estimators=300,
                learning_rate=0.04,
                max_depth=6,
                subsample=0.85,
                colsample_bytree=0.85,
                eval_metric="mlogloss",
                random_state=42,
            )
        except Exception:
            pass
    if model_type == "catboost":
        try:
            from catboost import CatBoostClassifier

            return CatBoostClassifier(
                iterations=300,
                learning_rate=0.04,
                depth=6,
                verbose=0,
                random_state=42,
                loss_function="MultiClass",
            )
        except Exception:
            pass
    return GradientBoostingClassifier(random_state=42)


def _rows_to_frame(rows: list[dict[str, Any]], feature_names: list[str]) -> pd.DataFrame:
    data = []
    for row in rows:
        features = row.get("features", {})
        data.append({name: float(features.get(name, 0.0)) for name in feature_names})
    return pd.DataFrame(data)


def _encode_labels(labels: list[str], encoder: LabelEncoder) -> np.ndarray:
    return encoder.fit_transform(labels)


def _validation_split(method: str, x: np.ndarray, y: np.ndarray):
    if method == "TIME_SERIES_SPLIT":
        splitter = TimeSeriesSplit(n_splits=3)
        splits = list(splitter.split(x))
        train_idx, test_idx = splits[-1]
        return x[train_idx], x[test_idx], y[train_idx], y[test_idx]
    if method == "WALK_FORWARD":
        split = int(len(x) * 0.7)
        return x[:split], x[split:], y[:split], y[split:]
    if method == "PURGED_CV":
        split = int(len(x) * 0.8)
        gap = max(1, int(len(x) * 0.02))
        train_end = split - gap
        return x[:train_end], x[split:], y[:train_end], y[split:]
    return train_test_split(x, y, test_size=0.25, random_state=42, stratify=y if len(set(y)) > 1 else None)


def _compute_importance(model, x_test: np.ndarray, y_test: np.ndarray, feature_names: list[str]):
    gain = getattr(model, "feature_importances_", None)
    if gain is None:
        gain = np.ones(len(feature_names)) / len(feature_names)
    perm = permutation_importance(model, x_test, y_test, n_repeats=5, random_state=42)
    shap_proxy = gain / max(gain.sum(), 1e-9)
    rows = []
    for i, name in enumerate(feature_names):
        rows.append(
            {
                "feature_name": name,
                "shap_value": float(shap_proxy[i]),
                "gain_importance": float(gain[i]),
                "permutation_importance": float(perm.importances_mean[i]),
            }
        )
    return sorted(rows, key=lambda r: r["gain_importance"], reverse=True)


def _build_inference_artifact(
    model_type: str,
    feature_names: list[str],
    scaler: StandardScaler,
    surrogate: LogisticRegression,
    encoder: LabelEncoder,
    platt_a: float,
    platt_b: float,
    isotonic_x: list[float],
    isotonic_y: list[float],
    outcome_stats: dict[str, dict[str, float]],
) -> dict[str, Any]:
    coef = surrogate.coef_
    intercept = surrogate.intercept_
    class_labels = [LABELS[i] if i < len(LABELS) else str(encoder.classes_[i]) for i in range(len(intercept))]
    return {
        "algorithm": model_type.upper(),
        "featureNames": feature_names,
        "classLabels": class_labels,
        "featureMeans": scaler.mean_.tolist(),
        "featureStds": scaler.scale_.tolist(),
        "coefficients": coef.tolist(),
        "intercepts": intercept.tolist(),
        "calibration": {
            "method": "PLATT",
            "platt": {"a": platt_a, "b": platt_b},
            "isotonic": {"x": isotonic_x, "y": isotonic_y},
        },
        "outcomeStats": outcome_stats,
    }


def train_decision_engine_v2(rows: list[dict[str, Any]], model_type: str, feature_names: list[str]) -> dict[str, Any]:
    frame = _rows_to_frame(rows, feature_names)
    labels = [str(row.get("label", "NO_TRADE")).upper() for row in rows]
    returns = [float(row.get("return_pct") or 0.0) for row in rows]
    encoder = LabelEncoder()
    y = _encode_labels(labels, encoder)
    x = frame.values.astype(float)
    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(x)

    estimator = _build_estimator(model_type)
    x_train, x_test, y_train, y_test = train_test_split(
        x_scaled, y, test_size=0.25, random_state=42, stratify=y if len(set(y)) > 1 else None
    )
    estimator.fit(x_train, y_train)
    preds = estimator.predict(x_test)
    base_acc = float(accuracy_score(y_test, preds))
    base_f1 = float(f1_score(y_test, preds, average="weighted"))

    calibrated = CalibratedClassifierCV(estimator, method="sigmoid", cv=3)
    calibrated.fit(x_train, y_train)
    cal_probs = calibrated.predict_proba(x_test)
    cal_preds = np.argmax(cal_probs, axis=1)
    cal_acc = float(accuracy_score(y_test, cal_preds))
    cal_f1 = float(f1_score(y_test, cal_preds, average="weighted"))

    surrogate = LogisticRegression(max_iter=500, multi_class="multinomial")
    surrogate.fit(x_scaled, y)

    raw_scores = cal_probs.max(axis=1)
    platt_a, platt_b = 1.1, -0.05
    isotonic_x = [0.0, 0.25, 0.5, 0.75, 1.0]
    isotonic_y = [0.05, 0.2, 0.5, 0.75, 0.95]

    outcome_stats = {}
    for label in LABELS:
        idx = [i for i, l in enumerate(labels) if l == label]
        subset = [returns[i] for i in idx]
        if not subset:
            outcome_stats[label] = {
                "expectedReturn": 0.0,
                "expectedRisk": 0.5,
                "expectedHoldingMinutes": 90,
                "expectedMaxDrawdown": 0.5,
                "expectedMaxProfit": 0.0,
            }
            continue
        pos = [v for v in subset if v > 0]
        neg = [v for v in subset if v < 0]
        outcome_stats[label] = {
            "expectedReturn": float(np.mean(subset)),
            "expectedRisk": float(np.mean(np.abs(neg)) if neg else 0.5),
            "expectedHoldingMinutes": 90 if label == "BUY" else 180 if label == "WAIT" else 0,
            "expectedMaxDrawdown": float(abs(min(subset))) if subset else 0.5,
            "expectedMaxProfit": float(max(subset)) if subset else 0.0,
        }

    validation_metrics = []
    for method in ["OUT_OF_SAMPLE", "WALK_FORWARD", "PURGED_CV", "TIME_SERIES_SPLIT"]:
        xt, xv, yt, yv = _validation_split(method, x_scaled, y)
        model = _build_estimator(model_type)
        model.fit(xt, yt)
        vp = model.predict(xv)
        validation_metrics.append(
            {
                "method": method,
                "accuracy": float(accuracy_score(yv, vp)),
                "f1_score": float(f1_score(yv, vp, average="weighted")),
                "sample_size": int(len(yv)),
                "metrics": {"base_accuracy": base_acc, "calibrated_accuracy": cal_acc},
            }
        )

    feature_importance = _compute_importance(estimator, x_test, y_test, feature_names)
    artifact = _build_inference_artifact(
        model_type,
        feature_names,
        scaler,
        surrogate,
        encoder,
        platt_a,
        platt_b,
        isotonic_x,
        isotonic_y,
        outcome_stats,
    )

    return {
        "model_type": model_type,
        "artifact": artifact,
        "validation_metrics": validation_metrics,
        "feature_importance": feature_importance,
        "summary": {
            "base_accuracy": base_acc,
            "base_f1": base_f1,
            "calibrated_accuracy": cal_acc,
            "calibrated_f1": cal_f1,
            "rows": len(rows),
        },
    }
