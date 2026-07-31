import { z } from "zod";

export const aiModelOutputSchema = z
  .object({
  decision: z.enum(["BUY", "SELL", "HOLD", "NO_TRADE"]),
  confidence: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  targetPrice: z.number().positive().nullable(),
  stopPrice: z.number().positive().nullable(),
  expectedMovePercent: z.number().min(0).max(100),
  expectedMoveRange: z.object({
    min: z.number().positive(),
    max: z.number().positive(),
  }),
  targetPercent: z.number().min(0).max(100),
  stopPercent: z.number().min(0).max(100),
  timeHorizonMinutes: z.number().min(1).max(180),
  riskReason: z.string().min(6).max(180),
  invalidationReason: z.string().min(6).max(180),
  estimatedDurationSec: z.number().min(30).max(10800),
  reasoningShort: z.string().min(4).max(160),
  })
  .superRefine((data, ctx) => {
    if (data.expectedMoveRange.min > data.expectedMoveRange.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectedMoveRange.min cannot be greater than max",
        path: ["expectedMoveRange", "min"],
      });
    }
    if (
      data.expectedMovePercent < data.expectedMoveRange.min ||
      data.expectedMovePercent > data.expectedMoveRange.max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectedMovePercent must be within expectedMoveRange",
        path: ["expectedMovePercent"],
      });
    }
    if ((data.decision === "BUY" || data.decision === "SELL") && (!data.targetPrice || !data.stopPrice)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetPrice/stopPrice required for BUY/SELL",
        path: ["targetPrice"],
      });
    }
  });

export type AIModelOutputSchema = z.infer<typeof aiModelOutputSchema>;
