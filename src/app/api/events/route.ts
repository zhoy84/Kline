import { NextRequest, NextResponse } from "next/server";
import { getEvents } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "BTCUSDT";
  const typesParam = searchParams.get("types"); // comma-separated, e.g. "ath,atl,drawdown"
  const types = typesParam ? typesParam.split(",") : undefined;

  try {
    const events = await getEvents(symbol, types);
    return NextResponse.json(events);
  } catch (err) {
    console.error("GET /api/events error:", err);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
