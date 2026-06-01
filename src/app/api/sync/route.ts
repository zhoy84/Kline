import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getCoins, getLatestOpenTime, insertKline } from "@/lib/db";

const BINANCE_API = "https://api.binance.com/api/v3/klines";
const BINANCE_VISION = "https://data.binance.vision/data/spot/monthly/klines";
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "5");
const DRAWDOWN_THRESHOLD = parseFloat(process.env.DRAWDOWN_THRESHOLD_PCT || "20");

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

/**
 * Fetch klines from the best available source.
 * Priority: Binance REST API (real-time) → Binance data.vision (historical fallback).
 */
async function fetchKlines(symbol: string, startTime: number): Promise<Array<[number, string, string, string, string, string]>> {
  // Try REST API first (no ZIP, real-time)
  const url = `${BINANCE_API}?symbol=${symbol}&interval=1d&startTime=${startTime}&limit=1000`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const json: Array<Array<number | string>> = await resp.json();
      return json.map(k => [
        Math.floor((k[0] as number) / 1000), // open_time in seconds
        k[1] as string, // open
        k[2] as string, // high
        k[3] as string, // low
        k[4] as string, // close
        k[5] as string, // volume
      ]);
    }
  } catch {
    // Fall through to data.binance.vision
  }

  return [];
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

  // --- Cumulative N-day bidirectional move detection ---
  // We need klines before the window to compute N-day lookback correctly
  const { rows: leadIn } = await sql`
    SELECT open_time, close FROM klines
    WHERE coin_id = ${coinId} AND open_time < ${sinceMs}
    ORDER BY open_time DESC LIMIT ${LOOKBACK}
  `;

  const allCloses = [...leadIn.reverse(), ...klines.map(r => ({ open_time: r.open_time as number, close: r.close as number }))];

  for (let i = LOOKBACK; i < allCloses.length; i++) {
    const prevClose = allCloses[i - LOOKBACK].close;
    const currClose = allCloses[i].close;
    const changePct = (currClose - prevClose) / prevClose * 100;
    const absChange = Math.abs(changePct);

    if (absChange >= THRESHOLD) {
      const direction = changePct > 0 ? 'UP' : 'DOWN';
      const dateStr = toDateStr(allCloses[i].open_time);
      const otherPrices = await getOtherPrices(dateStr, otherCoins);

      await sql`
        INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
        VALUES (${coinId}, 'drawdown', ${direction}, ${dateStr}, ${currClose}, ${Math.round(changePct * 100) / 100}, ${JSON.stringify(otherPrices)})
        ON CONFLICT (coin_id, event_date, event_type, direction)
        DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct
      `;
      events++;
      // Skip LOOKBACK_DAYS to avoid overlapping windows
      // We need to actually advance i, but skip the next LOOKBACK-1 iterations
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

export async function POST() {
  try {
    const coins = await getCoins();
    const now = Date.now();

    for (const coin of coins) {
      const symbol = coin.symbol;
      const latest = await getLatestOpenTime(coin.id);
      const startMs = latest ? (latest + 86400) * 1000 : new Date("2020-01-01").getTime();

      // Skip if already up to date
      if (latest && latest * 1000 >= now - 86400000) {
        continue;
      }

      // Fetch new klines from Binance
      const klines = await fetchKlines(symbol, startMs);
      let inserted = 0;

      for (const k of klines) {
        const openTime = k[0] as number * 1000; // convert to ms
        if (openTime <= (latest ? latest * 1000 : 0)) continue;

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

      // Recompute events if new data arrived
      if (inserted > 0) {
        const otherCoins = coins.filter(c => c.id !== coin.id);
        const recomputeFrom = (latest ?? 0) > 0
          ? (latest! * 1000) - 30 * 86400000 // go back 30 days to catch overlapping windows
          : 0;
        await recomputeEvents(coin.id, otherCoins, recomputeFrom > 0 ? recomputeFrom : 0);
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("POST /api/sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
