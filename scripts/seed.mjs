/**
 * Neon Database Seed Script
 *
 * Usage:
 *   $env:DRAWDOWN_THRESHOLD_PCT='30'; node scripts/seed.mjs
 *
 * This script:
 * 1. Creates tables via the migration SQL
 * 2. Seeds initial coin data
 * 3. Loads CSV files into the klines table
 * 4. Computes and inserts notable events (ATH, ATL, cumulative surge/plunge)
 *
 * Prerequisites:
 *   - POSTGRES_URL env var set (Vercel auto-injects this for Neon)
 *   - CSV files in the project root: *USDT-1d.csv
 */

import { sql } from "@vercel/postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DRAWDOWN_THRESHOLD = parseFloat(process.env.DRAWDOWN_THRESHOLD_PCT || "20");
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "5");

function normalizeTs(tsStr) {
  const val = parseInt(tsStr);
  return val > 1e15 ? Math.floor(val / 1000) : val;
}

function toDateStr(ms) {
  return new Date(ms).toISOString().split("T")[0];
}

async function runMigration() {
  console.log("Running migration...");
  const migrationPath = join(__dirname, "..", "sql", "migration.sql");
  const migrationSql = readFileSync(migrationPath, "utf-8");

  // Run the whole migration as one multi-statement query
  await sql.query(migrationSql);
  console.log("Migration done.");
}

async function seedData() {
  const { rows: coins } = await sql`SELECT id, symbol FROM coins ORDER BY id`;
  console.log(`Found ${coins.length} coins:`, coins.map(c => c.symbol).join(", "));

  const csvFiles = readdirSync(ROOT).filter(f => f.endsWith("-1d.csv"));
  console.log(`Found ${csvFiles.length} CSV files:`, csvFiles.join(", "));

  for (const coin of coins) {
    const csvFile = `${coin.symbol}-1d.csv`;
    if (!csvFiles.includes(csvFile)) {
      console.warn(`  [SKIP] ${coin.symbol}: no CSV file found`);
      continue;
    }

    const csvPath = join(ROOT, csvFile);
    const content = readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n").slice(1);

    let count = 0;
    const batchSize = 500;

    for (let i = 0; i < lines.length; i += batchSize) {
      const batch = lines.slice(i, i + batchSize);
      const values = batch.map(line => {
        const cols = line.split(",");
        return {
          coin_id: coin.id,
          open_time: normalizeTs(cols[0]),
          open: parseFloat(cols[1]),
          high: parseFloat(cols[2]),
          low: parseFloat(cols[3]),
          close: parseFloat(cols[4]),
          volume: parseFloat(cols[5]),
          close_time: normalizeTs(cols[6]),
          quote_volume: parseFloat(cols[7]),
          trades: parseInt(cols[8]),
        };
      });

      const placeholders = values.map((_, idx) => {
        const base = idx * 10;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
      }).join(",");

      const flatParams = values.flatMap(v => [
        v.coin_id, v.open_time, v.open, v.high, v.low,
        v.close, v.volume, v.close_time, v.quote_volume, v.trades,
      ]);

      await sql.query(
        `INSERT INTO klines (coin_id, open_time, open, high, low, close, volume, close_time, quote_volume, trades)
         VALUES ${placeholders}
         ON CONFLICT (coin_id, open_time) DO NOTHING`,
        flatParams
      );
      count += values.length;
    }

    console.log(`  ${coin.symbol}: ${count} klines inserted`);
  }
}

async function computeEvents() {
  const { rows: coins } = await sql`SELECT id, symbol FROM coins ORDER BY id`;

  // Clear existing events for a clean recompute
  await sql`DELETE FROM notable_events`;

  for (const coin of coins) {
    const { rows: klines } = await sql`
      SELECT open_time, high, low, close FROM klines
      WHERE coin_id = ${coin.id}
      ORDER BY open_time ASC
    `;

    const otherCoins = coins.filter(c => c.id !== coin.id);
    let events = 0;

    // --- ATH / ATL tracking (using high/low) ---
    let runningHigh = -Infinity;
    let runningLow = Infinity;
    let firstHighSeen = false;

    for (let i = 0; i < klines.length; i++) {
      const row = klines[i];
      const high = row.high;
      const low = row.low;
      const openTimeMs = Number(row.open_time);
      const dateStr = toDateStr(openTimeMs);

      // ATH (track highest high)
      if (high > runningHigh) {
        if (runningHigh > 0) firstHighSeen = true;
        runningHigh = high;
        const otherPrices = await getOtherPrices(dateStr, otherCoins);
        await sql`
          INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
          VALUES (${coin.id}, 'ath', 'UP', ${dateStr}, ${high}, ${null}, ${JSON.stringify(otherPrices)})
          ON CONFLICT (coin_id, event_date, event_type, direction)
          DO UPDATE SET price = EXCLUDED.price
        `;
        events++;
      }

      // ATL (only after at least one ATH seen)
      if (low < runningLow && firstHighSeen) {
        runningLow = low;
        const otherPrices = await getOtherPrices(dateStr, otherCoins);
        await sql`
          INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
          VALUES (${coin.id}, 'atl', 'DOWN', ${dateStr}, ${low}, ${null}, ${JSON.stringify(otherPrices)})
          ON CONFLICT (coin_id, event_date, event_type, direction)
          DO UPDATE SET price = EXCLUDED.price
        `;
        events++;
      }
    }

    // --- Cumulative N-day bidirectional move detection (using low for drops, high for rallies) ---
    for (let i = LOOKBACK_DAYS; i < klines.length;) {
      const prev = klines[i - LOOKBACK_DAYS];
      const curr = klines[i];

      // Drop detection using LOW (real minimum reached)
      const lowChange = (curr.low - prev.low) / prev.low * 100;
      // Rally detection using HIGH (real maximum reached)
      const highChange = (curr.high - prev.high) / prev.high * 100;

      if (lowChange <= -DRAWDOWN_THRESHOLD) {
        const direction = "DOWN";
        const openTimeMs = Number(curr.open_time);
        const dateStr = toDateStr(openTimeMs);
        const otherPrices = await getOtherPrices(dateStr, otherCoins);

        await sql`
          INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
          VALUES (${coin.id}, 'drawdown', ${direction}, ${dateStr}, ${curr.low}, ${Math.round(lowChange * 100) / 100}, ${JSON.stringify(otherPrices)})
          ON CONFLICT (coin_id, event_date, event_type, direction)
          DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct
        `;
        events++;
        i += LOOKBACK_DAYS;
      } else if (highChange >= DRAWDOWN_THRESHOLD) {
        const direction = "UP";
        const openTimeMs = Number(curr.open_time);
        const dateStr = toDateStr(openTimeMs);
        const otherPrices = await getOtherPrices(dateStr, otherCoins);

        await sql`
          INSERT INTO notable_events (coin_id, event_type, direction, event_date, price, change_pct, other_prices)
          VALUES (${coin.id}, 'drawdown', ${direction}, ${dateStr}, ${curr.high}, ${Math.round(highChange * 100) / 100}, ${JSON.stringify(otherPrices)})
          ON CONFLICT (coin_id, event_date, event_type, direction)
          DO UPDATE SET price = EXCLUDED.price, change_pct = EXCLUDED.change_pct
        `;
        events++;
        i += LOOKBACK_DAYS;
      } else {
        i++;
      }
    }

    console.log(`  ${coin.symbol}: ${events} notable events`);
  }

  async function getOtherPrices(dateStr, otherCoins) {
    const result = {};
    const dateMs = new Date(dateStr).getTime();
    for (const oc of otherCoins) {
      const { rows } = await sql`
        SELECT close FROM klines WHERE coin_id = ${oc.id} AND open_time = ${dateMs} LIMIT 1
      `;
      if (rows.length > 0) {
        result[oc.symbol] = rows[0].close;
      }
    }
    return result;
  }
}

async function main() {
  try {
    await runMigration();
    await seedData();
    await computeEvents();
    console.log("\nSeed complete!");
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
}

main();
