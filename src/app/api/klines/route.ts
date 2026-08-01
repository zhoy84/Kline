import { NextRequest, NextResponse } from "next/server";
import { getKlines } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "BTCUSDT";
  const limit = Math.min(parseInt(searchParams.get("limit") || "730"), 2000);

  try {
    const klines = await getKlines(symbol, limit);
    // Convert all numeric fields to numbers to ensure proper type handling
    const cleanedKlines = klines.map(k => ({
      open_time: Number(k.open_time),
      open: Number(k.open),
      high: Number(k.high),
      low: Number(k.low),
      close: Number(k.close),
      volume: Number(k.volume),
    }));
    return NextResponse.json(cleanedKlines);
  } catch (err) {
    console.error("GET /api/klines error:", err);
    return NextResponse.json({ error: "Failed to fetch klines" }, { status: 500 });
  }
}
