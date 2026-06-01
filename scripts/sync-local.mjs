/**
 * Local sync script — run from your REAL terminal (not opencode's sandbox).
 * Fetches latest klines from Binance and writes to Neon DB.
 *
 * Usage:
 *   node scripts/sync-local.mjs
 *
 * Prerequisites:
 *   - POSTGRES_URL env var set (or .env.local in project root)
 *   - Node.js 18+
 */
import { sql } from "@vercel/postgres";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:url";
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

const BINANCE_API = "https://api.binance.com/api/v3/klines";

async function fetchKlines(symbol, startTimeMs) {
  const url = `${BINANCE_API}?symbol=${symbol}&interval=1d&startTime=${startTimeMs}&limit=1000`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Binance ${symbol}: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  return json.map((k) => ({
    open_time: k[0],             // ms
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    close_time: k[6],
    quote_volume: parseFloat(k[7]),
    trades: parseInt(k[8]),
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

    const startMs = latest > 0
      ? Math.max(latest - 2 * 86400000, new Date("2025-01-01").getTime())
      : new Date("2020-01-01").getTime();

    console.log(`\n${coin.symbol}: latest=${latest ? new Date(latest).toISOString().split("T")[0] : "none"}, fetch from ${new Date(startMs).toISOString().split("T")[0]}`);

    const klines = await fetchKlines(coin.symbol, startMs);
    console.log(`  Binance returned ${klines.length} candles`);

    let inserted = 0;
    for (const k of klines) {
      const exists = await sql`
        SELECT 1 FROM klines WHERE coin_id = ${coin.id} AND open_time = ${k.open_time}
      `;
      if (exists.rows.length > 0) {
        // Update evolving candle
        await sql`
          UPDATE klines SET
            high = ${k.high}, low = ${k.low}, close = ${k.close},
            volume = ${k.volume}, close_time = ${k.close_time},
            quote_volume = ${k.quote_volume}, trades = ${k.trades}
          WHERE coin_id = ${coin.id} AND open_time = ${k.open_time}
        `;
      } else {
        await sql`
          INSERT INTO klines (coin_id, open_time, open, high, low, close, volume, close_time, quote_volume, trades)
          VALUES (${coin.id}, ${k.open_time}, ${k.open}, ${k.high}, ${k.low}, ${k.close}, ${k.volume}, ${k.close_time}, ${k.quote_volume}, ${k.trades})
          ON CONFLICT (coin_id, open_time) DO UPDATE SET
            high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
            volume = EXCLUDED.volume
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
