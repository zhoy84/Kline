import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getCoins, getLatestOpenTime, insertKline } from "@/lib/db";

const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "5");
const DRAWDOWN_THRESHOLD = parseFloat(process.env.DRAWDOWN_THRESHOLD_PCT || "20");

// Simple in-memory rate limiter (per-instance, good enough for cron-triggered sync)
let lastSyncAt = 0;

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

// Coin => CryptoCompare fsym mapping
const SYMBOL_MAP: Record<string, string> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  DOGEUSDT: "DOGE",
};

async function fetchKlines(symbol: string, _startTime: number): Promise<Array<[number, string, string, string, string, string]>> {
  const fsym = SYMBOL_MAP[symbol];
  if (!fsym) {
    console.error(`Unsupported symbol: ${symbol}`);
    return [];
  }
  const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${fsym}&tsym=USDT&limit=2000`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    console.error(`CryptoCompare ${symbol}: network error`, e);
    return [];
  }
  if (!resp.ok) {
    console.error(`CryptoCompare ${symbol}: ${resp.status} ${resp.statusText}`);
    return [];
  }
  const json = await resp.json();
  if (json.Response !== "Success") {
    console.error(`CryptoCompare ${symbol}: API error`, json.Message);
    return [];
  }
  return json.Data.Data.map((k: { time: number; open: number; high: number; low: number; close: number; volumefrom: number }) => [
    k.time,           // seconds (matches existing format)
    String(k.open),
    String(k.high),
    String(k.low),
    String(k.close),
    String(k.volumefrom),
  ]);
}

/**
 * Recompute notable events for a coin from scratch (on seed) or from a given date.
 * For incremental syncs, we just recompute forward from 30 days before latest.
 */
async function recomputeEvents(coinId: number, otherCoins: Array<{ id: number; symbol: string }>, sinceMs: number) {
  const LOOKBACK = LOOKBACK_DAYS;
  const THRESHOLD = DRAWDOWN_THRESHOLD;

  // Fetch all klines from the recompute window
  const { rows: klines } = await sql`
    SELECT open_time, high, low, close FROM klines
    WHERE coin_id = ${coinId} AND open_time >= ${sinceMs}
    ORDER BY open_time ASC
  `;

  if (klines.length === 0) return;

  // Delete old events in this window (so we can re-insert cleanly)
  const windowStart = toDateStr(sinceMs);
  await sql`
    DELETE FROM notable_events
    WHERE coin_id = ${coinId} AND event_date >= ${windowStart}
  `;

  // Also need to scan existing ATH/ATL before this window to know running state
  const { rows: priorKlines } = await sql`
    SELECT high, low FROM klines
    WHERE coin_id = ${coinId} AND open_time < ${sinceMs}
    ORDER BY open_time ASC
  `;

  let runningHigh = -Infinity;
  let runningLow = Infinity;
  let firstHighSeen = false;

  for (const pk of priorKlines) {
    if ((pk.high as number) > runningHigh) {
      if (runningHigh > 0) firstHighSeen = true;
      runningHigh = pk.high as number;
    }
    if ((pk.low as number) < runningLow) runningLow = pk.low as number;
  }

  let events = 0;

  // --- ATH/ATL for new data ---
  for (const row of klines) {
    const high = row.high as number;
    const low = row.low as number;
    const dateStr = toDateStr(row.open_time as number);

    if (high > runningHigh) {
      if (runningHigh > 0) firstHighSeen = true;
      runningHigh = high;
      const otherPrices = await getOtherPrices(dateStr, otherCoins);
      await sql`
        INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
        VALUES (${coinId}, 'ath', 'UP', ${dateStr}, ${high}, ${null}, ${JSON.stringify(otherPrices)})
        ON CONFLICT (coin_id, event_date, event_type, direction)
        DO UPDATE SET price = EXCLUDED.price
      `;
      events++;
    }

    if (low < runningLow && firstHighSeen) {
      runningLow = low;
      const otherPrices = await getOtherPrices(dateStr, otherCoins);
      await sql`
        INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
        VALUES (${coinId}, 'atl', 'DOWN', ${dateStr}, ${low}, ${null}, ${JSON.stringify(otherPrices)})
        ON CONFLICT (coin_id, event_date, event_type, direction)
        DO UPDATE SET price = EXCLUDED.price
      `;
      events++;
    }
  }

  // --- Cumulative N-day bidirectional move detection (using low for drops, high for rallies) ---
  const { rows: leadIn } = await sql`
    SELECT open_time, low, high FROM klines
    WHERE coin_id = ${coinId} AND open_time < ${sinceMs}
    ORDER BY open_time DESC LIMIT ${LOOKBACK}
  `;

  const allRows = [...leadIn.reverse(), ...klines];

  for (let i = LOOKBACK; i < allRows.length; i++) {
    const prev = allRows[i - LOOKBACK];
    const curr = allRows[i];

    // Drop: compare LOW prices
    const lowChange = (curr.low as number - (prev.low as number)) / (prev.low as number) * 100;
    // Rally: compare HIGH prices
    const highChange = (curr.high as number - (prev.high as number)) / (prev.high as number) * 100;

    if (lowChange <= -THRESHOLD) {
      const direction = 'DOWN';
      const dateStr = toDateStr(curr.open_time as number);
      const otherPrices = await getOtherPrices(dateStr, otherCoins);

      await sql`
        INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
        VALUES (${coinId}, 'drawdown', ${direction}, ${dateStr}, ${curr.low}, ${Math.round(lowChange * 100) / 100}, ${JSON.stringify(otherPrices)})
        ON CONFLICT (coin_id, event_date, event_type, direction)
        DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct
      `;
      events++;
      i += LOOKBACK - 1;
    } else if (highChange >= THRESHOLD) {
      const direction = 'UP';
      const dateStr = toDateStr(curr.open_time as number);
      const otherPrices = await getOtherPrices(dateStr, otherCoins);

      await sql`
        INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
        VALUES (${coinId}, 'drawdown', ${direction}, ${dateStr}, ${curr.high}, ${Math.round(highChange * 100) / 100}, ${JSON.stringify(otherPrices)})
        ON CONFLICT (coin_id, event_date, event_type, direction)
        DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct
      `;
      events++;
      i += LOOKBACK - 1;
    }
  }

  return events;

  async function getOtherPrices(dateStr: string, others: Array<{ id: number; symbol: string }>): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const dateMs = new Date(dateStr).getTime();
    for (const oc of others) {
      const { rows } = await sql`
        SELECT close FROM klines WHERE coin_id = ${oc.id} AND open_time = ${dateMs} LIMIT 1
      `;
      if (rows.length > 0) {
        result[oc.symbol] = rows[0].close as number;
      }
    }
    return result;
  }
}

async function runSync(): Promise<NextResponse> {
  const now = Date.now();
  if (now - lastSyncAt < 30000) {
    return NextResponse.json({ status: "too_soon" }, { status: 429 });
  }
  lastSyncAt = now;

  try {
    const coins = await getCoins();

    for (const coin of coins) {
      const symbol = coin.symbol;
      const latest = await getLatestOpenTime(coin.id);

      // Fetch klines from CryptoCompare
      const klines = await fetchKlines(symbol, 0);
      let inserted = 0;

      // Only process recent data (5 days before latest) to avoid 1000s of upserts
      const cutoff = (latest ?? 0) - 5 * 86400000;
      for (const k of klines) {
        const openTime = k[0] as number * 1000;
        if (openTime < cutoff) continue; // skip old data, already in DB

        if (openTime <= (latest ?? 0)) {
          await insertKline(coin.id, {
            open_time: openTime,
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            close_time: 0,
            quote_volume: 0,
            trades: 0,
          });
          inserted++;
          continue;
        }

        await insertKline(coin.id, {
          open_time: openTime,
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          close_time: 0,
          quote_volume: 0,
          trades: 0,
        });
        inserted++;
      }

      if (inserted > 0) {
        const otherCoins = coins.filter(c => c.id !== coin.id);
        const recomputeFrom = (latest ?? 0) > 0
          ? (latest as number) - 30 * 86400000
          : 0;
        await recomputeEvents(coin.id, otherCoins, recomputeFrom > 0 ? recomputeFrom : 0);
      }
      console.log(`${symbol}: ${inserted} klines processed (latest=${new Date(latest ?? 0).toISOString().split("T")[0]})`);
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("Sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

export async function GET() {
  return runSync();
}

export async function POST() {
  return runSync();
}
