import { NextResponse } from "next/server";
import { getCoins } from "@/lib/db";

export async function GET() {
  try {
    const coins = await getCoins();
    return NextResponse.json(coins);
  } catch (err) {
    console.error("GET /api/coins error:", err);
    return NextResponse.json({ error: "Failed to fetch coins" }, { status: 500 });
  }
}
