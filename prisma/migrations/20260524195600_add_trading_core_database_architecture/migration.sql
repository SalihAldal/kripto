CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS trading_core;

CREATE TABLE IF NOT EXISTS trading_core.events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INT NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_core.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_key TEXT NOT NULL UNIQUE,
  bot_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  market_type TEXT NOT NULL DEFAULT 'SPOT',
  status TEXT NOT NULL DEFAULT 'OPEN',
  entry_price NUMERIC(28, 12),
  exit_price NUMERIC(28, 12),
  quantity NUMERIC(28, 12) NOT NULL DEFAULT 0,
  notional NUMERIC(28, 8) NOT NULL DEFAULT 0,
  fee NUMERIC(28, 12) NOT NULL DEFAULT 0,
  pnl NUMERIC(28, 12) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_core.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_key TEXT NOT NULL UNIQUE,
  trade_id UUID REFERENCES trading_core.trades(id) ON DELETE SET NULL,
  bot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT', 'BUY', 'SELL')),
  status TEXT NOT NULL DEFAULT 'OPEN',
  entry_price NUMERIC(28, 12) NOT NULL,
  mark_price NUMERIC(28, 12),
  quantity NUMERIC(28, 12) NOT NULL,
  remaining_quantity NUMERIC(28, 12) NOT NULL,
  stop_loss NUMERIC(28, 12),
  take_profit NUMERIC(28, 12),
  unrealized_pnl NUMERIC(28, 12) NOT NULL DEFAULT 0,
  realized_pnl NUMERIC(28, 12) NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_core.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key TEXT NOT NULL UNIQUE,
  bot_id TEXT,
  strategy TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL', 'HOLD')),
  score NUMERIC(10, 4) NOT NULL,
  confidence NUMERIC(10, 4) NOT NULL,
  risk_level TEXT,
  market_regime TEXT,
  accepted BOOLEAN NOT NULL DEFAULT false,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_core.bot_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  trades INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  winrate NUMERIC(10, 4) NOT NULL DEFAULT 0,
  realized_pnl NUMERIC(28, 12) NOT NULL DEFAULT 0,
  unrealized_pnl NUMERIC(28, 12) NOT NULL DEFAULT 0,
  score NUMERIC(10, 4) NOT NULL DEFAULT 0,
  weight NUMERIC(10, 4) NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, window_start, window_end)
);

CREATE TABLE IF NOT EXISTS trading_core.risk_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  score NUMERIC(10, 4) NOT NULL,
  level TEXT NOT NULL,
  allowed BOOLEAN NOT NULL,
  adjusted_notional NUMERIC(28, 8),
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_core.ai_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL', 'HOLD')),
  confidence NUMERIC(10, 4) NOT NULL,
  prediction JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_core.market_regimes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regime_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  regime TEXT NOT NULL,
  trend_direction TEXT NOT NULL,
  strategy_mode TEXT NOT NULL,
  trade_allowed BOOLEAN NOT NULL,
  confidence NUMERIC(10, 4) NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tc_events_aggregate ON trading_core.events (aggregate_type, aggregate_id, id);
CREATE INDEX IF NOT EXISTS idx_tc_events_recorded_brin ON trading_core.events USING BRIN (recorded_at);
CREATE INDEX IF NOT EXISTS idx_tc_trades_symbol_status ON trading_core.trades (symbol, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_trades_bot_status ON trading_core.trades (bot_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_positions_symbol_status ON trading_core.positions (symbol, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_positions_bot_status ON trading_core.positions (bot_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_signals_symbol_time ON trading_core.signals (symbol, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_signals_strategy_time ON trading_core.signals (strategy, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_bot_stats_bot_window ON trading_core.bot_stats (bot_id, window_start DESC);
CREATE INDEX IF NOT EXISTS idx_tc_risk_logs_symbol_time ON trading_core.risk_logs (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_ai_predictions_symbol_time ON trading_core.ai_predictions (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tc_market_regimes_symbol_time ON trading_core.market_regimes (symbol, detected_at DESC);
