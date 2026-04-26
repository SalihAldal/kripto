export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "VALIDATION_FAILED"
  | "EXTERNAL_SERVICE_FAILURE"
  | "RISK_BLOCKED"
  | "CIRCUIT_OPEN"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly context?: Record<string, unknown>;
  public readonly expose: boolean;

  constructor(input: {
    message: string;
    code: ErrorCode;
    status?: number;
    context?: Record<string, unknown>;
    expose?: boolean;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AppError";
    this.code = input.code;
    this.status = input.status ?? 500;
    this.context = input.context;
    this.expose = input.expose ?? this.status < 500;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError({
      message: error.message || "Unexpected error",
      code: "INTERNAL_ERROR",
      status: 500,
      expose: false,
      cause: error,
    });
  }
  return new AppError({
    message: "Unknown error",
    code: "INTERNAL_ERROR",
    status: 500,
    expose: false,
    context: { error },
  });
}
