/**
 * Local sync script — run from any machine that can access CoinGecko.
 * Fetches latest klines from CoinGecko and writes to Neon DB.
 *
 * Usage (pick one):
 *   1. node scripts/sync-local.mjs                     # uses .env.local
 *   2. set POSTGRES_URL=... && node scripts/sync-local.mjs
 *
 * Prerequisites: Node.js 18+
 */
import { sql } from "@vercel/postgres";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load .env.local if present
if (existsSync(join(ROOT, ".env.local"))) {
  const envContent = readFileSync(join(ROOT, ".env.local"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// Coin symbol => CoinGecko API ID
const COIN_ID_MAP = { BTCUSDT: "bitcoin", ETHUSDT: "ethereum", DOGEUSDT: "dogecoin" };

// Configuration
const FETCH_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

/** Retry wrapper for fetch with exponential backoff */
async function fetchWithRetry(url) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      
      const resp = await fetch(url, { signal: controller.signal });
      
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      return resp;
    } catch (err) {
      lastError = err;
      console.error(`Fetch attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error("Fetch failed after max retries");
}

async function fetchKlines(symbol) {
  // Use Binance public API for daily candlestick data (no API key required)
  // https://binance-docs/api-docs/#kdata-candlestick-trading-information
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1D&limit=2000`;
  console.log(`Fetching klines for ${symbol} from Binance: ${url}`);
  
  let resp;
  try {
    resp = await fetchWithRetry(url);
  } catch (e) {
    throw new Error(`Binance ${symbol}: fetch failed after ${MAX_RETRIES} attempts: ${e.message}`);
  }
  
  if (!resp.ok) throw new Error(`Binance ${symbol}: ${resp.status} ${resp.statusText}`);
  
  const data = await resp.json();
  
// Binance returns: array of arrays [open_time_ms, open, high, low, close, volume, ...]
// open_time is already in milliseconds, no conversion needed
  return data.map((k) => ({
    open_time: k[0],            // open_time in ms from Binance
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}
  const lines = csvText.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error(`Yahoo Finance ${symbol}: no data rows`);
  }
  
  // Skip header line, parse data rows
  const klines = lines.slice(1).map(line => {
    const cols = line.split(",");
    const dateStr = cols[0];  // "YYYY-MM-DD"
    const open = parseFloat(cols[1]);
    const high = parseFloat(cols[2]);
    const low = parseFloat(cols[3]);
    const close = parseFloat(cols[4]);
    const volume = parseFloat(cols[5]);
    
    // Convert date string to UTC midnight timestamp (milliseconds)
    const date = new Date(dateStr + "T00:00:00Z");  // Parse as UTC midnight
    const timestampMs = date.getTime();
    
    return {
      open_time: timestampMs,
      open: open,
      high: high,
      low: low,
      close: close,
      volume: volume,
    };
  });
  
  return klines;
}
}

async function main() {
  const { rows: coins } = await sql`SELECT id, symbol FROM coins WHERE active = true ORDER BY id`;
  console.log(`Coins: ${coins.map((c) => c.symbol).join(", ")}`);

  let total = 0;

  for (const coin of coins) {
    const symbol = coin.symbol;
    
    // Get latest kline time from DB
    const { rows } = await sql`
      SELECT open_time FROM klines
      WHERE coin_id = ${coin.id}
      ORDER BY open_time DESC LIMIT 1
    `;
    const latest = rows.length > 0 ? Number(rows[0].open_time) : 0;
    console.log(`\n${symbol}: latest DB time = ${latest ? new Date(latest).toISOString().split("T")[0] : "none"}`);

    // Fetch klines from CoinGecko with retry
    const klines = await fetchKlines(symbol);
    console.log(`  CoinGecko returned ${klines.length} candles`);

    if (klines.length === 0) {
      console.log(`  No data received for ${symbol}, skipping`);
      continue;
    }

    let inserted = 0;
    let updated = 0;
    const latestMs = latest ?? 0;

    for (const k of klines) {
      // Skip data that's already in the database (older or equal to latest)
      if (k.open_time <= latestMs) {
        // Only update the latest candle if it might have been corrected
        if (k.open_time === latestMs) {
          await sql`
            UPDATE klines SET high = ${k.high}, low = ${k.low}, close = ${k.close}, volume = ${k.volume}
            WHERE coin_id = ${coin.id} AND open_time = ${k.open_time}
          `;
          updated++;
        }
        continue;
      }

      // Check if exists, then update or insert
      const exists = await sql`
        SELECT 1 FROM klines WHERE coin_id = ${coin.id} AND open_time = ${k.open_time}
      `;
      if (exists.rows.length > 0) {
        // Update existing (in case of partial data correction)
        await sql`
          UPDATE klines SET high = ${k.high}, low = ${k.low}, close = ${k.close}, volume = ${k.volume}
          WHERE coin_id = ${coin.id} AND open_time = ${k.open_time}
        `;
        updated++;
      } else {
        // Insert new kline
        await sql`
          INSERT INTO klines (coin_id, open_time, open, high, low, close, volume)
          VALUES (${coin.id}, ${k.open_time}, ${k.open}, ${k.high}, ${k.low}, ${k.close}, ${k.volume})
          ON CONFLICT (coin_id, open_time) DO UPDATE SET
            high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume
        `;
        inserted++;
      }
    }

    console.log(`  ${symbol}: ${inserted} new + ${updated} updated klines`);
    total += inserted + updated;
  }

  console.log(`\nDone. Total: ${total} klines synced.`);
  console.log('Run "重新生成" on the web page to recompute events.');
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
