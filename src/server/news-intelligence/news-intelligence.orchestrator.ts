import { collectNews, collectFromSourceType } from "@/src/server/news-intelligence/news-aggregator.service";
import { classifyRecentArticles, classifyArticle } from "@/src/server/news-intelligence/news-classification.service";
import { detectNarratives } from "@/src/server/news-intelligence/narrative-engine.service";
import { scoreRecentArticles, scoreArticleImpact } from "@/src/server/news-intelligence/news-impact.service";
import { detectDuplicates } from "@/src/server/news-intelligence/duplicate-detection.service";
import { analyzeRecentSentiment } from "@/src/server/news-intelligence/sentiment-engine.service";
import { mapRecentArticles } from "@/src/server/news-intelligence/coin-mapping.service";
import { replayRecentArticles, replayNewsImpact } from "@/src/server/news-intelligence/news-replay.service";
import { learnFromNewsHistory } from "@/src/server/news-intelligence/news-learning.service";
import { syncArticleTimeline } from "@/src/server/news-intelligence/news-timeline.service";
import { scoreSourceReliability } from "@/src/server/news-intelligence/source-reliability.service";
import type { NewsIntelligenceJobPayload } from "@/src/server/news-intelligence/news-intelligence.types";

export async function runNewsIntelligenceJob(payload: NewsIntelligenceJobPayload) {
  switch (payload.type) {
    case "NEWS_COLLECT":
      return collectNews(payload.limit);
    case "RSS_COLLECT":
      return collectFromSourceType("RSS", payload.limit);
    case "TWITTER_COLLECT":
      return collectFromSourceType("SOCIAL", payload.limit);
    case "TELEGRAM_COLLECT":
      return collectFromSourceType("TELEGRAM", payload.limit);
    case "GITHUB_COLLECT":
      return collectFromSourceType("GITHUB", payload.limit);
    case "CLASSIFY":
      return payload.articleId ? classifyArticle(payload.articleId) : classifyRecentArticles(payload.limit);
    case "NARRATIVE_DETECT":
      return detectNarratives(payload.limit);
    case "IMPACT_SCORE":
      return payload.articleId ? scoreArticleImpact(payload.articleId) : scoreRecentArticles(payload.limit);
    case "DUPLICATE_DETECT":
      return detectDuplicates(payload.limit);
    case "SENTIMENT_ANALYZE":
      return analyzeRecentSentiment(payload.limit);
    case "COIN_MAP":
      return mapRecentArticles(payload.limit);
    case "REPLAY_ANALYZE":
      return payload.articleId ? replayNewsImpact(payload.articleId) : replayRecentArticles(payload.limit);
    case "NEWS_LEARN":
      return learnFromNewsHistory(payload.limit);
    case "TIMELINE_SYNC":
      return syncArticleTimeline(payload.articleId);
    case "SOURCE_SCORE":
      return scoreSourceReliability(payload.sourceId);
    default:
      return { skipped: true };
  }
}
