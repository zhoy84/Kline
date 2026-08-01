import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const threshold = Math.max(5, Math.min(50, Number(searchParams.get("threshold")) || 20));
  const lookback = Math.max(1, Math.min(90, Number(searchParams.get("lookback")) || 5));

  try {
    const coinsRes = await sql`SELECT id, symbol FROM coins WHERE active = true ORDER BY id`;
    const klinesRes = await sql`SELECT coin_id, open_time, high, low, close FROM klines ORDER BY coin_id, open_time ASC`;

    const coins = coinsRes.rows;
    const klines = klinesRes.rows;

    // Build price lookup: timestamp (ms) -> coin_id -> { high, low, close }
    const priceByDate = new Map<number, Map<number, { high: number; low: number; close: number }>>();
    for (const k of klines) {
      const ts = Number(k.open_time);
      if (!priceByDate.has(ts)) priceByDate.set(ts, new Map());
      priceByDate.get(ts)!.set(Number(k.coin_id), {
        high: Number(k.high), low: Number(k.low), close: Number(k.close),
      });
    }
    const allDates = Array.from(priceByDate.keys()).sort((a, b) => a - b);
    const coinIds = coins.map((c) => Number(c.id));

    const events: Array<{
      symbol: string;
      event_type: string;
      direction: string;
      event_date: string;
      price: number;
      change_pct: number | null;
      other_prices: Record<string, number>;
    }> = [];

    function otherPrices(dateMs: number, excludeId: number): Record<string, number> {
      const result: Record<string, number> = {};
      const day = priceByDate.get(dateMs);
      if (!day) return result;
      for (const coinId of coinIds) {
        if (coinId === excludeId) continue;
        const p = day.get(coinId);
        if (p) {
          const coin = coins.find((c) => Number(c.id) === coinId);
          if (coin) result[coin.symbol] = p.close;
        }
      }
      return result;
    }

    for (const coin of coins) {
      const coinId = Number(coin.id);
      const coinSymbol = coin.symbol;
      const coinDates = allDates.filter((d) => priceByDate.get(d)?.has(coinId));
      let runningHigh = -Infinity;
      let runningLow = Infinity;
      let firstHighSeen = false;

      for (const dateMs of coinDates) {
        const row = priceByDate.get(dateMs)!.get(coinId)!;
        const dateStr = new Date(dateMs).toISOString().split("T")[0];

        if (row.high > runningHigh) {
          if (runningHigh > 0) firstHighSeen = true;
          runningHigh = row.high;
          events.push({
            symbol: coinSymbol,
            event_type: "ath",
            direction: "UP",
            event_date: dateStr,
            price: row.high,
            change_pct: null,
            other_prices: otherPrices(dateMs, coinId),
          });
        }
        if (row.low < runningLow && firstHighSeen) {
          runningLow = row.low;
          events.push({
            symbol: coinSymbol,
            event_type: "atl",
            direction: "DOWN",
            event_date: dateStr,
            price: row.low,
            change_pct: null,
            other_prices: otherPrices(dateMs, coinId),
          });
        }
      }

      for (let i = lookback; i < coinDates.length; ) {
        const dateMs = coinDates[i];
        const prev = priceByDate.get(coinDates[i - lookback])!.get(coinId)!;
        const curr = priceByDate.get(coinDates[i])!.get(coinId)!;
        const lowChange = ((curr.low - prev.low) / prev.low) * 100;
        const highChange = ((curr.high - prev.high) / prev.high) * 100;

        if (lowChange <= -threshold) {
          events.push({
            symbol: coinSymbol,
            event_type: "drawdown",
            direction: "DOWN",
            event_date: new Date(dateMs).toISOString().split("T")[0],
            price: curr.low,
            change_pct: Math.round(lowChange * 100) / 100,
            other_prices: otherPrices(dateMs, coinId),
          });
          i += lookback;
        } else if (highChange >= threshold) {
          events.push({
            symbol: coinSymbol,
            event_type: "drawdown",
            direction: "UP",
            event_date: new Date(dateMs).toISOString().split("T")[0],
            price: curr.high,
            change_pct: Math.round(highChange * 100) / 100,
            other_prices: otherPrices(dateMs, coinId),
          });
          i += lookback;
        } else {
          i++;
        }
      }
    }

    // Sort by event_date DESC (newest first)
    events.sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

    return NextResponse.json({ events, threshold, lookback });
  } catch (err) {
    console.error("Preview error:", err);
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
