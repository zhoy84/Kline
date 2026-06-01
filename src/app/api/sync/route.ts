import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getCoins, getLatestOpenTime, insertKline } from "@/lib/db";

const BINANCE_API = "https://api.binance.com/api/v3/klines";
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "5");
const DRAWDOWN_THRESHOLD = parseFloat(process.env.DRAWDOWN_THRESHOLD_PCT || "20");

// Simple in-memory rate limiter (per-instance, good enough for cron-triggered sync)
let lastSyncAt = 0;

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

async function fetchKlines(symbol: string, startTime: number): Promise<Array<[number, string, string, string, string, string]>> {
  const url = `${BINANCE_API}?symbol=${symbol}&interval=1d&startTime=${startTime}&limit=1000`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (resp.ok) {
      const json: Array<Array<number | string>> = await resp.json();
      return json.map(k => [
        Math.floor((k[0] as number) / 1000),
        k[1] as string,
        k[2] as string,
        k[3] as string,
        k[4] as string,
        k[5] as string,
      ]);
    }
  } catch {
    return [];
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

/**
 * Full recompute: batch process all events at once for ALL coins.
 * Uses in-memory price map instead of per-event DB queries (~50x faster).
 */
async function fullRecomputeAllEvents() {
  const coins = await getCoins();
  const coinMap = new Map(coins.map(c => [c.id, c.symbol]));

  const { rows: allKlines } = await sql`
    SELECT coin_id, open_time, high, low, close FROM klines ORDER BY coin_id, open_time ASC
  `;

  // Build price lookup: open_time_ms -> { coinId -> { high, low, close } }
  const priceByDate = new Map<number, Map<number, { high: number; low: number; close: number }>>();
  for (const row of allKlines) {
    const ts = Number(row.open_time);
    if (!priceByDate.has(ts)) priceByDate.set(ts, new Map());
    priceByDate.get(ts)!.set(Number(row.coin_id), {
      high: row.high as number,
      low: row.low as number,
      close: row.close as number,
    });
  }
  const allDates = [...priceByDate.keys()].sort((a, b) => a - b);

  function getOtherPrices(dateMs: number, excludeId: number): Record<string, number> {
    const result: Record<string, number> = {};
    const day = priceByDate.get(dateMs);
    if (!day) return result;
    for (const [cid, p] of day) {
      if (cid !== excludeId) {
        const sym = coinMap.get(cid);
        if (sym) result[sym] = p.close;
      }
    }
    return result;
  }

  await sql`DELETE FROM notable_events`;
  const LOOKBACK = LOOKBACK_DAYS;
  const THRESHOLD = DRAWDOWN_THRESHOLD;
  let total = 0;

  for (const coin of coins) {
    const coinDates = allDates.filter(d => priceByDate.get(d)?.has(coin.id));
    const batch: Array<{
      eventType: string; dir: string; date: string;
      price: number; changePct: number | null;
      otherPrices: Record<string, number>;
    }> = [];

    // ATH / ATL
    let runningHigh = -Infinity, runningLow = Infinity, firstHighSeen = false;
    for (const dateMs of coinDates) {
      const row = priceByDate.get(dateMs)!.get(coin.id)!;
      const dateStr = toDateStr(dateMs);

      if (row.high > runningHigh) {
        if (runningHigh > 0) firstHighSeen = true;
        runningHigh = row.high;
        batch.push({ eventType: 'ath', dir: 'UP', date: dateStr, price: row.high, changePct: null, otherPrices: getOtherPrices(dateMs, coin.id) });
      }
      if (row.low < runningLow && firstHighSeen) {
        runningLow = row.low;
        batch.push({ eventType: 'atl', dir: 'DOWN', date: dateStr, price: row.low, changePct: null, otherPrices: getOtherPrices(dateMs, coin.id) });
      }
    }

    // N-day drawdown
    for (let i = LOOKBACK; i < coinDates.length;) {
      const prev = priceByDate.get(coinDates[i - LOOKBACK])!.get(coin.id)!;
      const curr = priceByDate.get(coinDates[i])!.get(coin.id)!;
      const lowChange = (curr.low - prev.low) / prev.low * 100;
      const highChange = (curr.high - prev.high) / prev.high * 100;

      if (lowChange <= -THRESHOLD) {
        batch.push({ eventType: 'drawdown', dir: 'DOWN', date: toDateStr(coinDates[i]), price: curr.low, changePct: Math.round(lowChange * 100) / 100, otherPrices: getOtherPrices(coinDates[i], coin.id) });
        i += LOOKBACK;
      } else if (highChange >= THRESHOLD) {
        batch.push({ eventType: 'drawdown', dir: 'UP', date: toDateStr(coinDates[i]), price: curr.high, changePct: Math.round(highChange * 100) / 100, otherPrices: getOtherPrices(coinDates[i], coin.id) });
        i += LOOKBACK;
      } else {
        i++;
      }
    }

    // Batch insert
    for (const ev of batch) {
      await sql`
        INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
        VALUES (${coin.id}, ${ev.eventType}, ${ev.dir}, ${ev.date}, ${ev.price}, ${ev.changePct}, ${JSON.stringify(ev.otherPrices)})
        ON CONFLICT (coin_id, event_date, event_type, direction)
        DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct
      `;
    }
    total += batch.length;
  }
  return total;
}

/** GET returns instructions for testing */
export async function GET() {
  return NextResponse.json({
    message: "Use POST to trigger sync. Example: curl -X POST https://klinelab.vercel.app/api/sync",
    docs: "Configure cron-job.org to POST (not GET) to this URL every 10-15 minutes.",
  });
}

export async function POST(request: NextRequest) {
  // Rate limit: at most once per 30 seconds (unless full recompute)
  const now = Date.now();
  const { searchParams } = new URL(request.url);
  const fullRecompute = searchParams.get("full") === "true";

  if (!fullRecompute && now - lastSyncAt < 30000) {
    return NextResponse.json({ status: "too_soon" }, { status: 429 });
  }
  lastSyncAt = now;

  try {
    const coins = await getCoins();

    for (const coin of coins) {
      const symbol = coin.symbol;
      const latest = await getLatestOpenTime(coin.id);

      // Fetch from 2 days before latest to always get the current evolving candle
      const startMs = latest
        ? Math.max(latest - 2 * 86400000, new Date("2025-01-01").getTime())
        : new Date("2020-01-01").getTime();

      // Fetch new klines from Binance
      const klines = await fetchKlines(symbol, startMs);
      let inserted = 0;

      for (const k of klines) {
        const openTime = k[0] as number * 1000;
        if (openTime <= (latest ?? 0)) {
          // Already exists — still upsert to update today's evolving candle
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

      // Recompute events if new data arrived
      if (inserted > 0) {
        const otherCoins = coins.filter(c => c.id !== coin.id);
        const recomputeFrom = (latest ?? 0) > 0
          ? (latest as number) - 30 * 86400000
          : 0;
        await recomputeEvents(coin.id, otherCoins, recomputeFrom > 0 ? recomputeFrom : 0);
      }
    }

    // Full recompute: batch process all events in memory (~50x faster)
    if (fullRecompute) {
      const total = await fullRecomputeAllEvents();
      console.log(`Full recompute done: ${total} events`);
    }

    return NextResponse.json({ status: "ok", full: fullRecompute });
  } catch (err) {
    console.error("POST /api/sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
