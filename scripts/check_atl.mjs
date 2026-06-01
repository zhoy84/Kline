import { sql } from "@vercel/postgres";
const { rows } = await sql`SELECT event_date, price FROM notable_events WHERE coin_id = 1 AND event_type = 'atl' ORDER BY event_date DESC LIMIT 10`;
for (const r of rows) console.log(r.event_date, r.price);
