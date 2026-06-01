"use client";

import { useMemo } from "react";

interface NotableEvent {
  id: number;
  event_type: "ath" | "atl" | "drawdown";
  direction: "UP" | "DOWN";
  event_date: string;
  price: number;
  change_pct: number | null;
  other_prices: Record<string, number> | null;
}

interface Props {
  events: NotableEvent[];
  coins: Array<{ symbol: string; name: string }>;
  selectedSymbol: string;
}

function getEventLabel(ev: NotableEvent): string {
  if (ev.event_type === "ath") return "新高";
  if (ev.event_type === "atl") return "新低";
  if (ev.change_pct == null) return ev.direction === "UP" ? "涨幅" : "跌幅";
  const pct = Math.abs(ev.change_pct).toFixed(1);
  return ev.direction === "UP" ? `涨${pct}%` : `跌${pct}%`;
}

function getEventColor(ev: NotableEvent): string {
  if (ev.event_type === "ath") return "text-green-400 bg-green-900/30 border-green-700";
  if (ev.event_type === "atl") return "text-red-400 bg-red-900/30 border-red-700";
  if (ev.direction === "UP") return "text-cyan-400 bg-cyan-900/30 border-cyan-700";
  return "text-orange-400 bg-orange-900/30 border-orange-700";
}

function fmtPrice(p: number | undefined | null, symbol?: string): string {
  if (p == null) return "-";
  const base = symbol?.replace("USDT", "") ?? "";
  const decimals = (() => {
    if (base === "BTC" || base === "ETH") return 0;
    if (base === "DOGE") return 5;
    return p >= 1000 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 6;
  })();
  return p.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals,
  });
}

const COIN_COLORS: Record<string, string> = {
  BTC: "text-amber-400",
  ETH: "text-violet-300",
  DOGE: "text-emerald-400",
};

function getPriceColor(symbol: string): string {
  const base = symbol.replace("USDT", "");
  return COIN_COLORS[base] ?? "text-gray-500";
}

export function exportEventsAsHtml(
  events: NotableEvent[],
  coins: Array<{ symbol: string; name: string }>,
  selectedSymbol: string
): string {
  const orderedCoins = [...coins];
  const idx = orderedCoins.findIndex((c) => c.symbol === selectedSymbol);
  if (idx > 0) {
    const [item] = orderedCoins.splice(idx, 1);
    orderedCoins.unshift(item);
  }

  const tbody = events
    .map((ev) => {
      const tagCls =
        ev.event_type === "ath"
          ? "ath"
          : ev.event_type === "atl"
            ? "atl"
            : ev.direction === "UP"
              ? "up"
              : "down";
      const tagLabel =
        ev.event_type === "ath"
          ? "新高"
          : ev.event_type === "atl"
            ? "新低"
            : ev.change_pct == null
              ? ev.direction === "UP"
                ? "涨幅"
                : "跌幅"
              : ev.direction === "UP"
                ? `涨${Math.abs(ev.change_pct).toFixed(1)}%`
                : `跌${Math.abs(ev.change_pct).toFixed(1)}%`;

      const cells = orderedCoins
        .map((c) => {
          const isOwn = c.symbol === selectedSymbol;
          const price = isOwn ? ev.price : ev.other_prices?.[c.symbol];
          const clr = isOwn ? "#e5e7eb" : ({ BTC: "#fbbf24", ETH: "#a78bfa", DOGE: "#34d399" }[c.symbol.replace("USDT", "")] ?? "#6b7280");
          return `<td class="pr" style="color:${clr}">${fmtPrice(price, c.symbol)}</td>`;
        })
        .join("");

      return `<tr><td class="dt">${ev.event_date}</td><td><span class="tag tag-${tagCls}">${tagLabel}</span></td>${cells}</tr>`;
    })
    .join("\n");

  const ths = orderedCoins
    .map((c) => `<th class="${c.symbol === selectedSymbol ? "sel" : ""}">${c.symbol.replace("USDT", "")}</th>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<title>Kline Lab 事件导出</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#d1d5db;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.5;min-height:100vh}
header{position:sticky;top:0;z-index:10;border-bottom:1px solid #1f2937;background:rgba(26,26,46,0.5);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.header-inner{max-width:1280px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:space-between}
h1{font-size:18px;font-weight:700;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.header-right{display:flex;align-items:center;gap:8px}
.badge{font-size:12px;color:#6b7280}
.btn-export{font-size:12px;padding:4px 8px;border-radius:4px;border:1px solid #4b5563;color:#d1d5db;background:transparent;cursor:pointer;text-decoration:none}
.btn-export:hover{background:#374151}
main{max-width:1280px;margin:0 auto;padding:16px}
.page-title{font-size:14px;font-weight:600;color:#d1d5db;margin-bottom:12px}
.page-title span{color:#6b7280;font-size:12px;margin-left:8px}
.wrap{background:#1a1a2e;border:1px solid #1f2937;border-radius:8px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:15px}
th{text-align:left;padding:10px 8px;border-bottom:1px solid #374151;color:#9ca3af;font-weight:600;white-space:nowrap}
th.sel{color:#60a5fa}
tr{border-bottom:1px solid #1f2937;transition:background .15s}
tr:hover{background:rgba(31,41,55,0.5)}
td{padding:10px 8px}
.dt{color:#d1d5db;white-space:nowrap;font-size:15px}
.pr{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:16px}
.tag{display:inline-block;padding:3px 10px;border-radius:5px;font-size:13px;font-weight:500;border:1px solid}
.tag-ath{color:#4ade80;border-color:#15803d;background:rgba(20,83,45,0.3)}
.tag-atl{color:#f87171;border-color:#b91c1c;background:rgba(127,29,29,0.3)}
.tag-up{color:#22d3ee;border-color:#0e7490;background:rgba(22,78,99,0.3)}
.tag-down{color:#fb923c;border-color:#c2410c;background:rgba(124,45,18,0.3)}
@media(max-width:640px){body{font-size:15px}td,th{padding:8px 6px}table{font-size:14px}.pr{font-size:15px}.tag{font-size:12px;padding:2px 8px}}
</style>
</head>
<body>
<header>
<div class="header-inner">
<h1>Kline Lab</h1>
<div class="header-right">
<span class="badge">${new Date().toISOString().split("T")[0]}</span>
</div>
</div>
</header>
<main>
<div class="page-title">事件记录 <span>(${events.length})</span></div>
<div class="wrap">
<table>
<thead><tr><th>日期</th><th>事件</th>${ths}</tr></thead>
<tbody>${tbody}</tbody>
</table>
</div>
</main>
</body>
</html>`;
}

export default function EventsTable({ events, coins, selectedSymbol }: Props) {
  const orderedCoins = useMemo(() => {
    const copy = [...coins];
    const idx = copy.findIndex((c) => c.symbol === selectedSymbol);
    if (idx > 0) {
      const [item] = copy.splice(idx, 1);
      copy.unshift(item);
    }
    return copy;
  }, [coins, selectedSymbol]);

  if (events.length === 0) {
    return (
      <div className="text-gray-400 text-center py-8 text-sm">
        暂无事件记录
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400">
            <th className="text-left py-2 px-1.5">日期</th>
            <th className="text-left py-2 px-1.5">事件</th>
            {orderedCoins.map((c) => (
              <th
                key={c.symbol}
                className={`text-right py-2 px-1.5 ${
                  c.symbol === selectedSymbol ? "text-blue-400" : ""
                }`}
              >
                {c.symbol.replace("USDT", "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr
              key={ev.id}
              className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
            >
              <td className="py-2 px-1.5 text-gray-300">{ev.event_date}</td>
              <td className="py-2 px-1.5">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium border ${
                    getEventColor(ev)
                  }`}
                >
                  {getEventLabel(ev)}
                </span>
              </td>
              {orderedCoins.map((c) => {
                const isOwn = c.symbol === selectedSymbol;
                const price = isOwn ? ev.price : ev.other_prices?.[c.symbol];
                const colorClass = isOwn ? "text-gray-200" : getPriceColor(c.symbol);
                return (
                  <td
                    key={c.symbol}
                    className={`py-2 px-1.5 text-right font-mono ${colorClass}`}
                  >
                    {fmtPrice(price, c.symbol)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
