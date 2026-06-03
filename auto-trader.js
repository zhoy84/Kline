/**
 * K-line Lab 自动做空策略执行器 (CommonJS 版)
 * 编译: npm install -g pkg && pkg auto-trader.js -o auto-trader.exe
 * 运行: node auto-trader.js
 */
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const ROOT = __dirname;
const API = "https://fapi.binance.com";

// 读 .env
function loadEnv(key) {
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return null;
  for (const line of fs.readFileSync(envFile, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && t.slice(0, i).trim() === key) return t.slice(i + 1).trim();
  }
  return null;
}

const cfg = {
  api_key: loadEnv("BINANCE_API_KEY") || "",
  secret: loadEnv("BINANCE_API_SECRET") || "",
  staked_trx: parseInt(loadEnv("STAKED_TRX") || "1649"),
  entry_price: parseFloat(loadEnv("ENTRY_PRICE") || "0.332"),
  daily_energy: parseFloat(loadEnv("DAILY_ENERGY_TRX") || "0.473"),
  daily_vote: parseFloat(loadEnv("DAILY_VOTE_TRX") || "0.08"),
  days: parseInt(loadEnv("STAKED_DAYS") || "60"),
  backup: parseFloat(loadEnv("BACKUP_USDT") || "547.47"),
  target_pct: parseFloat(loadEnv("PROFIT_TARGET_PCT") || "6.12"),
  symbol: loadEnv("SYMBOL") || "TRXUSDT",
  interval: parseInt(loadEnv("CHECK_INTERVAL_MS") || "3000"),
  logfile: loadEnv("LOG_FILE") || "auto-trader.log"
};

if (!cfg.api_key || !cfg.secret) {
  console.log("❌ .env 缺少 BINANCE_API_KEY / BINANCE_API_SECRET");
  process.exit(1);
}

const EARNED = (cfg.daily_energy + cfg.daily_vote) * cfg.days;
const BASELINE_PCT = (EARNED * cfg.entry_price) / (cfg.staked_trx * cfg.entry_price + cfg.backup) * 100;

function log(msg) {
  const t = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = `[${t}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(ROOT, cfg.logfile), line + "\n"); } catch {}
}

function sign(qs) {
  return crypto.createHmac("sha256", cfg.secret).update(qs).digest("hex");
}

async function api(method, path, params = {}) {
  params.timestamp = Date.now();
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
  params.signature = sign(qs);
  const url = `${API}${path}?${Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&")}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": cfg.api_key, "Content-Type": "application/x-www-form-urlencoded" }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API ${res.status}: ${data.msg || JSON.stringify(data)}`);
  return data;
}

async function openShort(lev, qty, label) {
  await api("POST", "/fapi/v1/leverage", { symbol: cfg.symbol, leverage: lev });
  const q = Math.round(qty);
  await api("POST", "/fapi/v1/order", {
    symbol: cfg.symbol, side: "SELL", type: "MARKET", quantity: q
  });
  log(`✅ 开空 ${lev}x ${q} ${cfg.symbol} | ${label}`);
}

async function closeAll(reason) {
  await api("POST", "/fapi/v1/order", {
    symbol: cfg.symbol, side: "BUY", type: "MARKET",
    quantity: Math.round(cfg.staked_trx), reduceOnly: "true"
  });
  log(`🔒 平仓: ${reason}`);
}

async function getPos() {
  const a = await api("GET", "/fapi/v2/account");
  return a.positions?.find(p => p.symbol === cfg.symbol && Math.abs(parseFloat(p.positionAmt)) > 0);
}

async function getPrice() {
  const t = await api("GET", "/fapi/v1/ticker/price", { symbol: cfg.symbol });
  return parseFloat(t.price);
}

async function main() {
  log(`═══════════════════════════════════════`);
  log(`🚀 启动 | ${cfg.staked_trx} TRX | 已获 ${EARNED.toFixed(2)} TRX`);
  log(`策略: 2x → 3x | 无涨跌收益 ${BASELINE_PCT.toFixed(2)}% | 符号 ${cfg.symbol}`);
  log(`创建 close.txt 平仓`);
  log(`═══════════════════════════════════════`);

  let phase = "idle";
  let entryPrice = 0;
  let maxPnl = 0;
  const margin1 = cfg.staked_trx * cfg.entry_price / 2;
  const freeCash = cfg.backup - margin1;
  const targetRe = ((cfg.staked_trx * cfg.entry_price + cfg.backup) * (1 + BASELINE_PCT / 100) - freeCash) / (cfg.staked_trx + EARNED);

  while (true) {
    const closeF = path.join(ROOT, "close.txt");
    if (fs.existsSync(closeF)) {
      if (await getPos()) await closeAll("close.txt 触发");
      try { fs.unlinkSync(closeF); } catch {}
      log("👋 退出");
      process.exit(0);
    }

    try {
      const price = await getPrice();
      const pos = await getPos();
      const hasPos = pos && Math.abs(parseFloat(pos.positionAmt)) > 0;

      if (!hasPos && phase === "idle") {
        await openShort(2, cfg.staked_trx, `首次 @ $${price}`);
        entryPrice = price || cfg.entry_price;
        phase = "first";
        log(`📊 爆仓 ~$${(entryPrice * 1.5).toFixed(4)} 二次入场 ~$${targetRe.toFixed(4)}`);
        continue;
      }

      if (hasPos && phase === "first") {
        const pnl = parseFloat(pos.unrealizedPnl);
        const margin = parseFloat(pos.isolatedWallet) || 1;
        const pct = pnl / margin * 100;
        if (pct > maxPnl) maxPnl = pct;
        log(`📌 PnL: ${pnl.toFixed(2)} USDT 当前: $${price.toFixed(4)}`);
        if (Math.abs(parseFloat(pos.positionAmt)) < 0.001) {
          log(`💥 爆仓！最高 ${maxPnl.toFixed(2)}%`);
          phase = "waiting";
        }
      }

      if (phase === "waiting") {
        const pct = (EARNED * price) / (cfg.staked_trx * cfg.entry_price + cfg.backup) * 100;
        const ok = pct <= BASELINE_PCT && price <= targetRe;
        log(`⏳ 回调 ${pct.toFixed(2)}% ≤${BASELINE_PCT.toFixed(2)}% ${ok ? '🎯' : ''}`);
        if (ok) {
          await openShort(3, cfg.staked_trx + EARNED, `二次 @ $${price}`);
          phase = "second";
        }
      }

    } catch (e) {
      log(`❌ ${e.message}`);
    }
    await new Promise(r => setTimeout(r, cfg.interval));
  }
}

main();
