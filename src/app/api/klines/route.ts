import { NextRequest, NextResponse } from "next/server";
import { getKlines } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "BTCUSDT";
  const limit = Math.min(parseInt(searchParams.get("limit") || "2000"), 5000);

  try {
    const klines = await getKlines(symbol, limit);
    return NextResponse.json(klines);
  } catch (err) {
    console.error("GET /api/klines error:", err);
    return NextResponse.json({ error: "Failed to fetch klines" }, { status: 500 });
  }
}
