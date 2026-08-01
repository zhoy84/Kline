import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

interface Coin {
  id: number;
  symbol: string;
}

interface KlineRow {
  coin_id: number;
  open_time: number;
  high: number;
  low: number;
  close: number;
}

function toDateStr(ms: number): string {
  return new Date(Number(ms)).toISOString().split("T")[0];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const threshold = Math.min(50, Math.max(5, parseFloat(searchParams.get("threshold") || "20")));
  const lookback = Math.min(90, Math.max(1, parseInt(searchParams.get("lookback") || "5")));

  try {
    const { rows: coins } = await sql`SELECT id, symbol FROM coins WHERE active = true ORDER BY id`;
    const { rows: allKlines } = await sql`
      SELECT coin_id, open_time, high, low, close FROM klines ORDER BY coin_id, open_time ASC
    `;

    const coinMap = new Map<string, string>();
    for (const c of coins as any[]) {
      coinMap.set(String(c.id), c.symbol);
    }
    const priceByDate = new Map<number, Map<number, { high: number; low: number; close: number }>>();

    for (const row of allKlines as KlineRow[]) {
      const ts = Number(row.open_time);
      if (!priceByDate.has(ts)) priceByDate.set(ts, new Map());
      priceByDate.get(ts)!.set(Number(row.coin_id), {
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      });
    }

    const allDates = [...priceByDate.keys()].sort((a, b) => a - b);
    const events: Array<{
      symbol: string;
      event_type: string;
      direction: string;
      event_date: string;
      price: number;
      change_pct: number | null;
    }> = [];

    for (const coin of coins) {
      const coinDates = allDates.filter((d) => priceByDate.get(d)?.has(coin.id));
      let runningHigh = -Infinity;
      let runningLow = Infinity;
      let firstHighSeen = false;

      for (const dateMs of coinDates) {
        const row = priceByDate.get(dateMs)!.get(coin.id)!;
        const dateStr = toDateStr(dateMs);

        if (row.high > runningHigh) {
          if (runningHigh > 0) firstHighSeen = true;
          runningHigh = row.high;
          events.push({
            symbol: coin.symbol,
            event_type: "ath",
            direction: "UP",
            event_date: dateStr,
            price: row.high,
            change_pct: null,
          });
        }

        if (row.low < runningLow && firstHighSeen) {
          runningLow = row.low;
          events.push({
            symbol: coin.symbol,
            event_type: "atl",
            direction: "DOWN",
            event_date: dateStr,
            price: row.low,
            change_pct: null,
          });
        }
      }

      for (let i = lookback; i < coinDates.length; ) {
        const prev = priceByDate.get(coinDates[i - lookback])!.get(coin.id)!;
        const curr = priceByDate.get(coinDates[i])!.get(coin.id)!;
        const lowChange = ((curr.low - prev.low) / prev.low) * 100;
        const highChange = ((curr.high - prev.high) / prev.high) * 100;

        if (lowChange <= -threshold) {
          events.push({
            symbol: coin.symbol,
            event_type: "drawdown",
            direction: "DOWN",
            event_date: toDateStr(coinDates[i]),
            price: curr.low,
            change_pct: Math.round(lowChange * 100) / 100,
          });
          i += lookback;
        } else if (highChange >= threshold) {
          events.push({
            symbol: coin.symbol,
            event_type: "drawdown",
            direction: "UP",
            event_date: toDateStr(coinDates[i]),
            price: curr.high,
            change_pct: Math.round(highChange * 100) / 100,
          });
          i += lookback;
        } else {
          i++;
        }
      }
    }

    return NextResponse.json({ events, threshold, lookback });
  } catch (err) {
    console.error("GET /api/events/preview error:", err);
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
