import type { AIAnalysisInput, AIModelOutput, AIProviderConfig } from "@/src/types/ai";

export interface AIProviderAdapter {
  readonly config: AIProviderConfig;
  analyzeTechnicalSignal(input: AIAnalysisInput): Promise<AIModelOutput>;
  analyzeMomentumSignal(input: AIAnalysisInput): Promise<AIModelOutput>;
  analyzeRiskAssessment(input: AIAnalysisInput): Promise<AIModelOutput>;
}
