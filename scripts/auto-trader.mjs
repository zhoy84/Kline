/**
 * K-line Lab 自动做空策略执行器 v1.0
 *
 * 策略: 2x 开空 → 爆仓后等回调 → 3x 二次开空 → 解冻平仓
 * 零依赖，仅需 Node.js 18+
 *
 * 使用方法:
 *   1. 运行: node scripts/auto-trader.mjs
 *   2. 自动生成 config.json，填入 Binance API Key
 *   3. 再次运行即可
 *
 * 编译 exe:
 *   npm install -g pkg
 *   pkg scripts/auto-trader.mjs -o auto-trader.exe
 */

import { readFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const API = "https://fapi.binance.com";

// ─── 读取 .env 配置 ───
const ENV_FILE = join(ROOT, ".env");
function loadEnv(key) {
  if (!existsSync(ENV_FILE)) return null;
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && t.slice(0, i).trim() === key) return t.slice(i + 1).trim();
  }
  return null;
}

const cfg = {
  binance_api_key: loadEnv("BINANCE_API_KEY") || "",
  binance_secret_key: loadEnv("BINANCE_API_SECRET") || "",
  staked_trx: parseInt(loadEnv("STAKED_TRX") || "1649"),
  entry_price: parseFloat(loadEnv("ENTRY_PRICE") || "0.332"),
  daily_energy_trx: parseFloat(loadEnv("DAILY_ENERGY_TRX") || "0.473"),
  daily_vote_trx: parseFloat(loadEnv("DAILY_VOTE_TRX") || "0.08"),
  staked_days: parseInt(loadEnv("STAKED_DAYS") || "60"),
  backup_usdt: parseFloat(loadEnv("BACKUP_USDT") || "547.47"),
  profit_target_pct: parseFloat(loadEnv("PROFIT_TARGET_PCT") || "6.12"),
  symbol: loadEnv("SYMBOL") || "TRXUSDT",
  check_interval_ms: parseInt(loadEnv("CHECK_INTERVAL_MS") || "3000"),
  log_file: loadEnv("LOG_FILE") || "auto-trader.log"
};

if (!cfg.binance_api_key || !cfg.binance_secret_key) {
  console.log("❌ .env 文件缺少 BINANCE_API_KEY 或 BINANCE_API_SECRET");
  console.log("请在 .env 中填入后重新运行");
  process.exit(1);
}

const EARNED = (cfg.daily_energy_trx + cfg.daily_vote_trx) * cfg.staked_days;
// ─── 日志 ───
function log(msg) {
  const t = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = `[${t}] ${msg}`;
  console.log(line);
  try { appendFileSync(join(ROOT, cfg.log_file || "auto-trader.log"), line + "\n"); } catch {}
}

// ─── Binance 签名 ───
function sign(qs) {
  return createHmac("sha256", cfg.binance_secret_key).update(qs).digest("hex");
}
async function api(method, path, params = {}) {
  params.timestamp = Date.now();
  const qs = Object.entries({ ...params }).map(([k, v]) => `${k}=${v}`).join("&");
  params.signature = sign(qs);
  const url = `${API}${path}?${Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&")}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": cfg.binance_api_key, "Content-Type": "application/x-www-form-urlencoded" }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API ${res.status}: ${data.msg || JSON.stringify(data)}`);
  return data;
}

// ─── 开空 ───
async function openShort(leverage, label) {
  const qty = Math.round(cfg.staked_trx);
  await api("POST", "/fapi/v1/leverage", { symbol: cfg.symbol, leverage });
  await api("POST", "/fapi/v1/order", {
    symbol: cfg.symbol, side: "SELL", type: "MARKET", quantity: qty
  });
  log(`✅ 开空 ${leverage}x ${qty} ${cfg.symbol} | ${label}`);
}

// ─── 平仓 ───
async function closeAll(reason) {
  await api("POST", "/fapi/v1/order", {
    symbol: cfg.symbol, side: "BUY", type: "MARKET",
    quantity: Math.round(cfg.staked_trx), reduceOnly: "true"
  });
  log(`🔒 平仓: ${reason}`);
}

// ─── 查持仓 ───
async function getPosition() {
  const a = await api("GET", "/fapi/v2/account");
  return a.positions?.find(p => p.symbol === cfg.symbol && Math.abs(parseFloat(p.positionAmt)) > 0);
}

// ─── 查价 ───
async function getPrice() {
  const t = await api("GET", `/fapi/v1/ticker/price`, { symbol: cfg.symbol });
  return parseFloat(t.price);
}

// ─── 主循环 ───
async function main() {
  log(`═══════════════════════════════════════`);
  log(`🚀 启动 | ${cfg.staked_trx} TRX | 已获奖励 ${EARNED.toFixed(2)} TRX`);
  log(`策略: 2x → 3x | 目标收益 ≥ ${cfg.profit_target_pct}%`);
  log(`═══════════════════════════════════════`);

  let phase = "idle";
  let entryPrice = 0;
  let maxProfitPct = 0;
  const targetRe = cfg.entry_price * 0.48 / 0.50;  // $0.319（收益回到 6% 时）

  while (true) {
    // 检测 close.txt 平仓信号
    const closeFile = join(ROOT, "close.txt");
    if (existsSync(closeFile)) {
      if (await getPosition()) await closeAll("用户手动平仓");
      unlinkSync(closeFile);
      log("📋 平仓完成，退出");
      process.exit(0);
    }

    try {
      const price = await getPrice();
      const pos = await getPosition();
      const hasPos = pos && Math.abs(parseFloat(pos.positionAmt)) > 0;

      if (!hasPos && phase === "idle") {
        await openShort(2, `首次 2x @ $${price}`);
        entryPrice = price || cfg.entry_price;
        phase = "first";
        log(`📊 2x 爆仓价 ~$${(entryPrice * 1.5).toFixed(4)} | 回调入场价 ~$${targetRe.toFixed(4)}`);
        continue;
      }

      if (hasPos && phase === "first") {
        const pnl = parseFloat(pos.unrealizedPnl);
        const margin = parseFloat(pos.isolatedWallet) || 1;
        const pnlPct = pnl / margin * 100;
        if (pnlPct > maxProfitPct) maxProfitPct = pnlPct;
        log(`📌 持仓 PnL: ${pnl.toFixed(2)} USDT | 当前: $${price.toFixed(4)}`);
        
        if (Math.abs(parseFloat(pos.positionAmt)) < 0.001) {
          log(`💥 爆仓！期间最高收益 ${maxProfitPct.toFixed(2)}%`);
          phase = "waiting";
        }
      }

      if (phase === "waiting") {
        const profitPct = (EARNED * price) / (cfg.staked_trx * cfg.entry_price + cfg.backup_usdt) * 100;
        const shouldRe = profitPct <= cfg.profit_target_pct && price <= targetRe;
        log(`⏳ 回调中收益 ${profitPct.toFixed(2)}% 目标≤${cfg.profit_target_pct}% ${shouldRe ? '🎯' : ''}`);
        if (shouldRe) {
          await openShort(3, `二次 3x @ $${price}`);
          phase = "second";
        }
      }

    } catch (e) {
      log(`❌ ${e.message}`);
    }
    await new Promise(r => setTimeout(r, cfg.check_interval_ms || 3000));
  }
}

main();

