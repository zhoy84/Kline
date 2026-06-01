-- Neon Database Migration for Crypto Kline App
-- Run this in the Neon SQL console or via seed script

CREATE TABLE IF NOT EXISTS coins (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS klines (
  id BIGSERIAL PRIMARY KEY,
  coin_id INTEGER NOT NULL REFERENCES coins(id),
  open_time BIGINT NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  close_time BIGINT,
  quote_volume DOUBLE PRECISION,
  trades INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(coin_id, open_time)
);

CREATE INDEX IF NOT EXISTS idx_klines_coin_time ON klines(coin_id, open_time DESC);
CREATE INDEX IF NOT EXISTS idx_klines_coin_time_asc ON klines(coin_id, open_time ASC);

CREATE TABLE IF NOT EXISTS notable_events (
  id SERIAL PRIMARY KEY,
  coin_id INTEGER NOT NULL REFERENCES coins(id),
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('ath', 'atl', 'drawdown')),
  direction VARCHAR(10) NOT NULL DEFAULT 'UP' CHECK (direction IN ('UP', 'DOWN')),
  event_date DATE NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  change_pct DOUBLE PRECISION,
  other_prices JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(coin_id, event_date, event_type, direction)
);

CREATE INDEX IF NOT EXISTS idx_events_coin_type_date ON notable_events(coin_id, event_type, event_date DESC);

-- Seed coins
INSERT INTO coins (symbol, name) VALUES
  ('BTCUSDT', 'Bitcoin'),
  ('ETHUSDT', 'Ethereum'),
  ('DOGEUSDT', 'Dogecoin')
ON CONFLICT (symbol) DO NOTHING;
