import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getCoins, getLatestOpenTime, insertKline } from "@/lib/db";

// Configuration
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "5");
const DRAWDOWN_THRESHOLD = parseFloat(process.env.DRAWDOWN_THRESHOLD_PCT || "20");
const FETCH_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

// Simple in-memory rate limiter (per-instance, good enough for cron-triggered sync)
let lastSyncAt = 0;

/** Retry wrapper for fetch with exponential backoff */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      
      const resp = await fetch(url, { signal: controller.signal });
      
      if (!resp.ok) {
        // Try to read response body for more details
        let errorMsg = `HTTP ${resp.status}: ${resp.statusText}`;
        try {
          const bodyText = await resp.text();
          if (bodyText && bodyText.trim()) {
            errorMsg += `\nResponse body: ${bodyText}`;
          }
        } catch (e) {
          // Could not read body
        }
        console.error(`Full error: ${errorMsg}`);
        throw new Error(errorMsg);
      }
      return resp;
    } catch (err) {
      lastError = err as Error;
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Fetch attempt ${attempt}/${MAX_RETRIES} failed: ${errorMessage}`);
      
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error("Fetch failed after max retries");
}

function toDateStr(ms: number): string {
  return new Date(Number(ms)).toISOString().split("T")[0];
}

async function fetchKlines(symbol: string): Promise<Array<[number, string, string, string, string, string]>> {
  // Coin symbol => Coinbase Exchange product ID
const coinProductMap: Record<string, string> = {
  BTCUSDT: "BTC-USD",
  ETHUSDT: "ETH-USD",
  DOGEUSDT: "DOGE-USD",
};
const product = coinProductMap[symbol as keyof typeof coinProductMap] as string;
if (!product) {
  console.error(`Unsupported symbol: ${symbol}`);
  return [];
}

// Coinbase Exchange public API — returns continuous daily candles (no sampling)
// Format: [timestamp_sec, low, high, open, close, volume]
// https://docs.coinbase.com/exchange/reference/exch-restmarketsapi-getcandles
const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400&limit=60`;
  console.log(`Fetching klines for ${symbol} from Coinbase: ${url}`);
  
  let resp: Response;
  try {
    resp = await fetchWithRetry(url);
  } catch (e) {
    console.error(`CoinGecko ${symbol}: final fetch error after ${MAX_RETRIES} attempts`, e);
    return [];
  }
  
if (!resp.ok) {
    console.error(`Coinbase ${symbol}: ${resp.status} ${resp.statusText}`);
    return [];
  }
  
const data = await resp.json();
  
// Coinbase returns: array of arrays [timestamp_sec, low, high, open, close, volume]
// timestamp is in Unix SECONDS, need to convert to milliseconds by multiplying by 1000
return data.map((k: Array<number>) => [
  k[0] * 1000,                       // open_time in milliseconds (seconds * 1000 from Coinbase)
  String(k[3]),                      // open   (Coinbase index 3)
  String(k[2]),                      // high   (Coinbase index 2)
  String(k[1]),                      // low    (Coinbase index 1)
  String(k[4]),                      // close  (Coinbase index 4)
  String(k[5]),                      // volume (Coinbase index 5)
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
    let totalInserted = 0;

    for (const coin of coins) {
      const symbol = coin.symbol;
      const latest = await getLatestOpenTime(coin.id);

      // Fetch klines from CoinGecko
      const klines = await fetchKlines(symbol);
      let inserted = 0;

      console.log(`${symbol}: latest DB time = ${latest ? new Date(latest).toISOString().split("T")[0] : 'empty'}`);

      if (klines.length === 0) {
        console.log(`${symbol}: No klines fetched, skipping this coin`);
        continue;
      }

      // Determine sync starting point
      const latestMs = latest ?? 0;
      
      if (latestMs === 0) {
        // First sync: process all klines
        console.log(`${symbol}: First-time sync, processing all ${klines.length} klines`);
      } else {
        // Incremental sync: process klines newer than latest
        console.log(`${symbol}: Processing klines after ${new Date(latestMs).toISOString().split("T")[0]}`);
      }

      for (const k of klines) {
        const openTime = k[0] as number;  // now in milliseconds directly from CoinGecko
        
        // DEBUG: Log a few sample timestamps to understand the range
        if (inserted === 0 && k[0] > latestMs) {
          console.log(`  Sample new kline time: ${new Date(openTime).toISOString().split('T')[0]}, raw: ${k[0]}`);
        }
        
        // Skip data that's already in the database
        if (openTime <= latestMs) {
          // Only upsert if needed (for data that might have been corrected)
          if (openTime === latestMs) {
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
          continue;
        }

        // Insert/upsert new kline
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

      totalInserted += inserted;

      if (inserted > 0) {
        const otherCoins = coins.filter(c => c.id !== coin.id);
        // Recompute events from 30 days before the new latest to ensure event consistency
        const newLatest = klines[klines.length - 1][0]; // most recent from API (already in ms)
        const recomputeFrom = newLatest - 30 * 86400000;
        await recomputeEvents(coin.id, otherCoins, recomputeFrom);
        console.log(`${symbol}: Recomputed events from ${new Date(recomputeFrom).toISOString().split("T")[0]}`);
      }
      
      console.log(`${symbol}: ${inserted} klines processed successfully`);
    }

    return NextResponse.json({ 
      status: "ok", 
      totalInserted, 
      message: `Sync completed with ${totalInserted} total klines inserted/updated` 
    });
  } catch (err) {
    console.error("Sync error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Sync failed: " + errorMessage }, { status: 500 });
  }
}

export async function GET() {
  return runSync();
}

export async function POST() {
  return runSync();
}
