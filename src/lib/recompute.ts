import { sql } from "@vercel/postgres";
import { getCoins } from "./db";

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

/**
 * Full recompute all notable events from scratch (reads Neon only, no external APIs).
 * Accepts threshold and lookback params so the frontend can regenerate with new settings.
 */
export async function recomputeAllEvents(
  drawdownThresholdPct: number,
  lookbackDays: number
): Promise<number> {
  const coins = await getCoins();
  const coinMap = new Map(coins.map((c) => [c.id, c.symbol]));

  // Fetch ALL klines
  const { rows: allKlines } = await sql`
    SELECT coin_id, open_time, high, low, close FROM klines ORDER BY coin_id, open_time ASC
  `;

  // Price lookup: open_time_ms -> { coinId -> { high, low, close } }
  const priceByDate = new Map<
    number,
    Map<number, { high: number; low: number; close: number }>
  >();
  for (const row of allKlines) {
    const ts = Number(row.open_time);
    if (!priceByDate.has(ts)) priceByDate.set(ts, new Map());
    priceByDate.get(ts)!.set(Number(row.coin_id), {
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    });
  }
  const allDates = [...priceByDate.keys()].sort((a, b) => a - b);

  function otherPrices(dateMs: number, excludeId: number): Record<string, number> {
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
  const THRESHOLD = drawdownThresholdPct;
  const LOOKBACK = lookbackDays;
  let total = 0;

  for (const coin of coins) {
    const coinDates = allDates.filter((d) => priceByDate.get(d)?.has(coin.id));
    const batch: Array<{
      eventType: string;
      dir: string;
      date: string;
      price: number;
      changePct: number | null;
      otherPrices: Record<string, number>;
    }> = [];

    // ATH / ATL
    let runningHigh = -Infinity,
      runningLow = Infinity,
      firstHighSeen = false;
    for (const dateMs of coinDates) {
      const row = priceByDate.get(dateMs)!.get(coin.id)!;
      const dateStr = toDateStr(dateMs);

      if (row.high > runningHigh) {
        if (runningHigh > 0) firstHighSeen = true;
        runningHigh = row.high;
        batch.push({
          eventType: "ath",
          dir: "UP",
          date: dateStr,
          price: row.high,
          changePct: null,
          otherPrices: otherPrices(dateMs, coin.id),
        });
      }
      if (row.low < runningLow && firstHighSeen) {
        runningLow = row.low;
        batch.push({
          eventType: "atl",
          dir: "DOWN",
          date: dateStr,
          price: row.low,
          changePct: null,
          otherPrices: otherPrices(dateMs, coin.id),
        });
      }
    }

    // N-day drawdown
    for (let i = LOOKBACK; i < coinDates.length; ) {
      const prev = priceByDate.get(coinDates[i - LOOKBACK])!.get(coin.id)!;
      const curr = priceByDate.get(coinDates[i])!.get(coin.id)!;
      const lowChange = ((curr.low - prev.low) / prev.low) * 100;
      const highChange = ((curr.high - prev.high) / prev.high) * 100;

      if (lowChange <= -THRESHOLD) {
        batch.push({
          eventType: "drawdown",
          dir: "DOWN",
          date: toDateStr(coinDates[i]),
          price: curr.low,
          changePct: Math.round(lowChange * 100) / 100,
          otherPrices: otherPrices(coinDates[i], coin.id),
        });
        i += LOOKBACK;
      } else if (highChange >= THRESHOLD) {
        batch.push({
          eventType: "drawdown",
          dir: "UP",
          date: toDateStr(coinDates[i]),
          price: curr.high,
          changePct: Math.round(highChange * 100) / 100,
          otherPrices: otherPrices(coinDates[i], coin.id),
        });
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
