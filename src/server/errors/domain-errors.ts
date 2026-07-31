import { AppError } from "@/src/server/errors/app-error";

export class RiskViolationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "RISK_BLOCKED",
      status: 422,
      context,
    });
    this.name = "RiskViolationError";
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "EXTERNAL_SERVICE_FAILURE",
      status: 503,
      context,
      expose: true,
    });
    this.name = "ExternalServiceError";
  }
}

export class CircuitOpenError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "CIRCUIT_OPEN",
      status: 503,
      context,
      expose: true,
    });
    this.name = "CircuitOpenError";
  }
}
