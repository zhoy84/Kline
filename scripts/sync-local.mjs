/**
 * Local sync script — run from any machine that can reach Binance.
 * Fetches latest klines from Binance and writes to Neon DB.
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

const SYMBOL_MAP = { BTCUSDT: "BTC", ETHUSDT: "ETH", DOGEUSDT: "DOGE" };
const CC_URL = "https://min-api.cryptocompare.com/data/v2/histoday";

async function fetchKlines(symbol) {
  const fsym = SYMBOL_MAP[symbol];
  if (!fsym) throw new Error(`Unsupported symbol: ${symbol}`);
  const url = `${CC_URL}?fsym=${fsym}&tsym=USDT&limit=2000`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`CryptoCompare ${symbol}: ${resp.status}`);
  const json = await resp.json();
  if (json.Response !== "Success") throw new Error(`CryptoCompare ${symbol}: ${json.Message}`);
  return json.Data.Data.map((k) => ({
    open_time: k.time * 1000,    // CryptoCompare seconds → ms
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volumefrom,
  }));
}

async function main() {
  const { rows: coins } = await sql`SELECT id, symbol FROM coins WHERE active = true ORDER BY id`;
  console.log(`Coins: ${coins.map((c) => c.symbol).join(", ")}`);

  let total = 0;

  for (const coin of coins) {
    const { rows } = await sql`
      SELECT open_time FROM klines
      WHERE coin_id = ${coin.id}
      ORDER BY open_time DESC LIMIT 1
    `;
    const latest = rows.length > 0 ? Number(rows[0].open_time) : 0;
    console.log(`\n${coin.symbol}: latest=${latest ? new Date(latest).toISOString().split("T")[0] : "none"}`);

    const klines = await fetchKlines(coin.symbol);
    console.log(`  CryptoCompare returned ${klines.length} candles`);

    let inserted = 0;
    for (const k of klines) {
      const exists = await sql`
        SELECT 1 FROM klines WHERE coin_id = ${coin.id} AND open_time = ${k.open_time}
      `;
      if (exists.rows.length > 0) {
        await sql`
          UPDATE klines SET high = ${k.high}, low = ${k.low}, close = ${k.close}, volume = ${k.volume}
          WHERE coin_id = ${coin.id} AND open_time = ${k.open_time}
        `;
      } else {
        await sql`
          INSERT INTO klines (coin_id, open_time, open, high, low, close, volume)
          VALUES (${coin.id}, ${k.open_time}, ${k.open}, ${k.high}, ${k.low}, ${k.close}, ${k.volume})
          ON CONFLICT (coin_id, open_time) DO UPDATE SET
            high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close
        `;
      }
      inserted++;
    }

    console.log(`  Inserted/updated ${inserted} klines`);
    total += inserted;
  }

  console.log(`\nDone. Total: ${total} klines synced.`);
  console.log('Run "重新生成" on the web page to recompute events.');
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
