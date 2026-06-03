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

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const API = "https://fapi.binance.com";

// ─── 配置 ───
const CFG = join(ROOT, "config.json");
if (!existsSync(CFG)) {
  writeFileSync(CFG, JSON.stringify({
    binance_api_key: "",
    binance_secret_key: "",
    staked_trx: 1649,
    entry_price: 0.332,
    daily_energy_trx: 0.473,
    daily_vote_trx: 0.08,
    staked_days: 60,
    backup_usdt: 547.47,
    profit_target_pct: 6.12,
    symbol: "TRXUSDT",
    check_interval_ms: 3000,
    log_file: "auto-trader.log"
  }, null, 2));
  console.log("已创建 config.json，请填写 API Key 后重新运行");
  process.exit(0);
}
const cfg = JSON.parse(readFileSync(CFG, "utf-8"));

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

  let phase = "idle";  // idle → first → waiting → second → done
  let entryPrice = 0;
  let maxProfitPct = 0;
  const targetRe = cfg.entry_price * 0.48 / 0.5 || cfg.entry_price * 0.96;

  while (true) {
    try {
      const price = await getPrice();
      const pos = await getPosition();
      const hasPos = pos && Math.abs(parseFloat(pos.positionAmt)) > 0;

      // 首次开仓
      if (!hasPos && phase === "idle") {
        await openShort(2, `首次 2x @ $${price}`);
        entryPrice = price || cfg.entry_price;
        phase = "first";
        log(`📊 2x 爆仓价 ~$${(entryPrice * 1.5).toFixed(4)}`);
        continue;
      }

      if (hasPos) {
        const pnl = parseFloat(pos.unrealizedPnl);
        const margin = parseFloat(pos.isolatedWallet) || 1;
        if (pnl / margin * 100 > maxProfitPct) maxProfitPct = pnl / margin * 100;
        log(`📌 持仓 PnL: ${pnl.toFixed(2)} USDT | 当前: $${price.toFixed(4)}`);
        
        // 检测爆仓（仓位归零）
        if (Math.abs(parseFloat(pos.positionAmt)) <= 0) {
          log(`💥 爆仓！最高收益 ${maxProfitPct.toFixed(2)}%`);
          phase = "waiting";
        }
      }

      // 二次开仓等待回调
      if (phase === "waiting") {
        const profitPct = (EARNED * price) / (cfg.staked_trx * cfg.entry_price + cfg.backup_usdt) * 100;
        const shouldRe = profitPct <= cfg.profit_target_pct && price <= targetRe;
        log(`⏳ 回调中... 收益 ${profitPct.toFixed(2)}% 目标≤${cfg.profit_target_pct}% ${shouldRe ? '🎯 达标' : ''}`);
        
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

