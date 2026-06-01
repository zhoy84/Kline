import { sql } from "@vercel/postgres";

async function main() {
  const r1 = await sql.query("SELECT event_type, COUNT(*) as cnt FROM notable_events WHERE coin_id = 1 GROUP BY event_type");
  console.log("BTC events:");
  for (const r of r1.rows) console.log(" ", r.event_type, r.cnt);

  const r2 = await sql.query("SELECT event_date, price FROM notable_events WHERE coin_id = 1 AND event_type = 'atl' ORDER BY event_date ASC");
  console.log("\nBTC ATLs (by date):");
  for (const r of r2.rows) console.log(" ", r.event_date, r.price);

  const r3 = await sql.query("SELECT event_date, price FROM notable_events WHERE coin_id = 1 AND event_type = 'ath' ORDER BY event_date DESC LIMIT 5");
  console.log("\nBTC last 5 ATHs:");
  for (const r of r3.rows) console.log(" ", r.event_date, r.price);

  const r4 = await sql.query("SELECT MAX(open_time) as latest FROM klines WHERE coin_id = 1");
  const latestMs = r4.rows[0].latest;
  console.log("\nLatest kline:", new Date(Number(latestMs)).toISOString());
}

main().catch(e => { console.error(e); process.exit(1); });
