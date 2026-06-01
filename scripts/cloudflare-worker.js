/**
 * Cloudflare Worker — Binance API Proxy
 *
 * Deploy this worker to bypass Vercel -> Binance 451 restriction.
 *
 * Deploy steps:
 *   1. Go to https://dash.cloudflare.com/ → Workers & Pages → Create Worker
 *   2. Paste this code, deploy
 *   3. Copy the worker URL (e.g., https://binance-proxy.xxx.workers.dev)
 *   4. Set BINANCE_PROXY_URL in Vercel env vars
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Only allow GET
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const symbol = url.searchParams.get("symbol");
    if (!symbol) {
      return new Response("Missing symbol", { status: 400 });
    }

    const interval = url.searchParams.get("interval") || "1d";
    const limit = url.searchParams.get("limit") || "1000";
    const startTime = url.searchParams.get("startTime");

    let binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) binanceUrl += `&startTime=${startTime}`;

    const resp = await fetch(binanceUrl);
    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
