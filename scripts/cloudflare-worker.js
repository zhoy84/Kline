/**
 * Cloudflare Worker — Binance API Proxy + 定时同步
 *
 * 一个 Worker 搞定两件事：
 *   1. 代理 Binance K 线（绕过 Vercel 451）
 *   2. 定时触发 Vercel sync（替代 cron-job.org）
 *
 * ── 部署步骤 ──
 *   1. https://dash.cloudflare.com/ → Workers & Pages → 创建 Worker
 *   2. 选 "Hello World" 模板，粘贴此代码覆盖，点部署
 *   3. 记下 Worker 域名 (e.g. binance-proxy.xxx.workers.dev)
 *   4. Worker → 设置 → 变量 → 添加 VERCEL_URL
 *      → 值: https://klinelab.vercel.app
 *   5. Worker → 触发器 → Cron Triggers → 添加
 *      → 填: */10 * * * *
 *   6. Vercel 项目 → Settings → Environment Variables
 *      → 新增 BINANCE_PROXY_URL = https://binance-proxy.xxx.workers.dev
 *   7. 去 cron-job.org 删掉旧任务
 */

export default {
  // ── HTTP 处理：代理 Binance + 手动触发同步 ──
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 健康检查
    if (path === "/__health") {
      return json({ status: "ok" });
    }

    // 手动触发同步：GET https://worker.xxx/__sync
    if (path === "/__sync") {
      const target = env.VERCEL_URL;
      if (!target) return json({ error: "VERCEL_URL not set" }, 500);
      const resp = await fetch(`${target}/api/sync`, { method: "POST" });
      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Binance 代理 ──
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return new Response("Missing symbol", { status: 400 });

    const interval = url.searchParams.get("interval") || "1d";
    const limit = url.searchParams.get("limit") || "1000";
    const startTime = url.searchParams.get("startTime");

    let binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) binanceUrl += `&startTime=${startTime}`;

    const resp = await fetch(binanceUrl);
    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  },

  // ── Cron 定时触发 Vercel sync ──
  async scheduled(event, env, ctx) {
    const target = env.VERCEL_URL;
    if (!target) {
      console.error("VERCEL_URL not configured");
      return;
    }
    console.log(`Triggering sync: ${target}/api/sync`);
    try {
      const resp = await fetch(`${target}/api/sync`, { method: "POST" });
      console.log(`Sync done: ${resp.status}`);
    } catch (e) {
      console.error("Sync failed:", e.message);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
