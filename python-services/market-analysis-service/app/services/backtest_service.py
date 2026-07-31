from app.schemas import BacktestRequest, BacktestResponse, MarketAnalysisRequest
from app.services.analysis_service import MarketAnalysisService


class BacktestService:
    def __init__(self, analysis_service: MarketAnalysisService) -> None:
        self.analysis_service = analysis_service

    def run(self, request: BacktestRequest) -> BacktestResponse:
        accepted = 0
        rejected = 0
        true_positive = 0
        false_positive = 0
        false_signal_rejected = 0

        for row in request.rows:
            result = self.analysis_service.analyze(
                MarketAnalysisRequest(features=row, confidence_threshold=request.confidence_threshold)
            )
            if result.passed:
                accepted += 1
                if row.label == 1:
                    true_positive += 1
                else:
                    false_positive += 1
            else:
                rejected += 1
                if row.label == 0:
                    false_signal_rejected += 1

        precision = true_positive / max(1, true_positive + false_positive)
        false_signal_count = sum(1 for row in request.rows if row.label == 0)
        filter_rate = false_signal_rejected / max(1, false_signal_count)

        return BacktestResponse(
            rows=len(request.rows),
            accepted=accepted,
            rejected=rejected,
            precision=round(precision, 4),
            false_signal_filter_rate=round(filter_rate, 4),
        )
