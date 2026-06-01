import { sql } from "@vercel/postgres";

export interface Coin {
  id: number;
  symbol: string;
  name: string;
  active: boolean;
}

export interface Kline {
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NotableEvent {
  id: number;
  coin_id: number;
  event_type: "ath" | "atl" | "drawdown";
  direction: "UP" | "DOWN";
  event_date: string;
  price: number;
  change_pct: number | null;
  other_prices: Record<string, number> | null;
}

/** Fetch all active coins */
export async function getCoins(): Promise<Coin[]> {
  const { rows } = await sql`SELECT id, symbol, name, active FROM coins WHERE active = true ORDER BY id`;
  return rows as Coin[];
}

/** Fetch klines for a coin symbol, with optional limit */
export async function getKlines(symbol: string, limit = 2000): Promise<Kline[]> {
  const { rows } = await sql`
    SELECT k.open_time, k.open, k.high, k.low, k.close, k.volume
    FROM klines k
    JOIN coins c ON c.id = k.coin_id
    WHERE c.symbol = ${symbol}
    ORDER BY k.open_time ASC
    LIMIT ${limit}
  `;
  return rows as Kline[];
}

/** Fetch notable events for a coin symbol, optionally filtered by type */
export async function getEvents(
  symbol: string,
  types?: string[]
): Promise<NotableEvent[]> {
  if (types && types.length > 0) {
    const placeholders = types.map((_, i) => `$${i + 2}`).join(",");
    const { rows } = await sql.query(
      `SELECT e.id, e.coin_id, e.event_type, e.direction, e.event_date::text, e.price,
              e.change_pct, e.other_prices
       FROM notable_events e
       JOIN coins c ON c.id = e.coin_id
       WHERE c.symbol = $1 AND e.event_type IN (${placeholders})
       ORDER BY e.event_date DESC`,
      [symbol, ...types]
    );
    return rows as NotableEvent[];
  }
  const { rows } = await sql`
    SELECT e.id, e.coin_id, e.event_type, e.direction, e.event_date::text, e.price,
           e.change_pct, e.other_prices
    FROM notable_events e
    JOIN coins c ON c.id = e.coin_id
    WHERE c.symbol = ${symbol}
    ORDER BY e.event_date DESC
  `;
  return rows as NotableEvent[];
}

/** Insert a kline row (idempotent) */
export async function insertKline(
  coinId: number,
  k: Kline & { close_time: number; quote_volume: number; trades: number }
): Promise<void> {
  await sql`
    INSERT INTO klines (coin_id, open_time, open, high, low, close, volume, close_time, quote_volume, trades)
    VALUES (${coinId}, ${k.open_time}, ${k.open}, ${k.high}, ${k.low}, ${k.close},
            ${k.volume}, ${k.close_time}, ${k.quote_volume}, ${k.trades})
    ON CONFLICT (coin_id, open_time) DO NOTHING
  `;
}

/** Insert a notable event (idempotent) */
export async function insertEvent(
  coinId: number,
  eventType: string,
  direction: string,
  eventDate: string,
  price: number,
  changePct: number | null,
  otherPrices: Record<string, number> | null
): Promise<void> {
  await sql`
    INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
    VALUES (${coinId}, ${eventType}, ${direction}, ${eventDate}, ${price}, ${changePct}, ${JSON.stringify(otherPrices)})
    ON CONFLICT (coin_id, event_date, event_type, direction)
    DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct, other_prices = EXCLUDED.other_prices
  `;
}

/** Get latest open_time for a coin (for sync) */
export async function getLatestOpenTime(coinId: number): Promise<number | null> {
  const { rows } = await sql`
    SELECT open_time FROM klines
    WHERE coin_id = ${coinId}
    ORDER BY open_time DESC
    LIMIT 1
  `;
  return rows.length > 0 ? (rows[0].open_time as number) : null;
}
