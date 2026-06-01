import { NextRequest, NextResponse } from "next/server";
import { recomputeAllEvents } from "@/lib/recompute";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const threshold = body.threshold ?? 20;
    const lookback = body.lookback ?? 5;

    const total = await recomputeAllEvents(threshold, lookback);

    return NextResponse.json({ status: "ok", events: total, threshold, lookback });
  } catch (err) {
    console.error("POST /api/recompute error:", err);
    return NextResponse.json({ error: "Recompute failed" }, { status: 500 });
  }
}
