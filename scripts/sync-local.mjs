/**
 * Local sync script — run from any machine that can access CoinGecko.
 * Fetches latest klines from CoinGecko and writes to Neon DB.
 *
 * Usage:
 *   node scripts/sync-local.mjs
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
  const coinProductMap = {
    BTCUSDT: "BTC-USD",
    ETHUSDT: "ETH-USD",
    DOGEUSDT: "DOGE-USD",
  };
  const product = coinProductMap[symbol];
  if (!product) throw new Error(`Unsupported symbol: ${symbol}`);
  
  // Coinbase Exchange API returns flat array: [[timestamp_sec, low, high, open, close, volume], ...]
  // timestamp is in Unix SECONDS, need to convert to milliseconds by multiplying by 1000
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400&limit=60`;
  console.log(`Fetching klines for ${symbol} from Coinbase: ${url}`);
  
  let resp;
  try {
    resp = await fetchWithRetry(url);
  } catch (e) {
    throw new Error(`CoinGecko ${symbol}: fetch failed after ${MAX_RETRIES} attempts: ${e.message}`);
  }
  
  if (!resp.ok) throw new Error(`Coinbase ${symbol}: ${resp.status} ${resp.statusText}`);
  
  const data = await resp.json();
  
  // Coinbase returns a FLAT array directly
  if (!Array.isArray(data)) {
    throw new Error(`Coinbase ${symbol}: unexpected response format`);
  }
  
  console.log(`Coinbase ${symbol}: received ${data.length} candles`);
  
  // Map - k[0] is timestamp in seconds, multiply by 1000 to convert to milliseconds
  // Coinbase candle format: [time, low, high, open, close, volume]
  return data.map((k) => ({
    open_time: k[0] * 1000,      // open_time in ms (seconds * 1000 from Coinbase)
    open: parseFloat(k[3]),      // open   (Coinbase index 3)
    high: parseFloat(k[2]),      // high   (Coinbase index 2)
    low: parseFloat(k[1]),       // low    (Coinbase index 1)
    close: parseFloat(k[4]),     // close  (Coinbase index 4)
    volume: parseFloat(k[5]),    // volume (Coinbase index 5)
  }));
}

async function main() {
  const { rows: coins } = await sql`SELECT id, symbol FROM coins WHERE active = true ORDER BY id`;
  console.log(`Coins: ${coins.map((c) => c.symbol).join(", ")}`);

  let total = 0;

  // Clean up abnormal timestamps before sync
  await sql`DELETE FROM notable_events WHERE coin_id IN (SELECT DISTINCT coin_id FROM klines WHERE open_time > 2000000000000)`;
  await sql`DELETE FROM klines WHERE open_time > 2000000000000`;
  console.log("Cleaned up abnormal timestamp records\n");

  for (const coin of coins) {
    const symbol = coin.symbol;
    
    // Get latest kline time from DB
    const { rows } = await sql`
      SELECT open_time FROM klines
      WHERE coin_id = ${coin.id}
      ORDER BY open_time DESC LIMIT 1
    `;
    const latest = rows.length > 0 ? Number(rows[0].open_time) : 0;
    console.log(`${symbol}: latest DB time = ${latest ? new Date(latest).toISOString().split("T")[0] : "none"}`);

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
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
