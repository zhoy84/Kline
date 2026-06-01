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

  const cellStyle = (symbol: string, isOwn: boolean): string => {
    if (isOwn) return "color:#e5e7eb";
    const base = symbol.replace("USDT", "");
    const map: Record<string, string> = {
      BTC: "color:#fbbf24",
      ETH: "color:#a78bfa",
      DOGE: "color:#34d399",
    };
    return map[base] ?? "color:#6b7280";
  };

  const tagHtml = (ev: NotableEvent): string => {
    const label =
      ev.event_type === "ath"
        ? "新高"
        : ev.event_type === "atl"
          ? "新低"
          : ev.change_pct == null
            ? ev.direction === "UP"
              ? "涨幅"
              : "跌幅"
            : `${Math.abs(ev.change_pct).toFixed(1)}%`;
    const cls =
      ev.event_type === "ath"
        ? "tag-ath"
        : ev.event_type === "atl"
          ? "tag-atl"
          : ev.direction === "UP"
            ? "tag-up"
            : "tag-down";
    return `<span class="${cls}">${label}</span>`;
  };

  const rows = events
    .map(
      (ev) =>
        `<tr><td class="date">${ev.event_date}</td><td>${tagHtml(ev)}</td>${orderedCoins
          .map((c) => {
            const isOwn = c.symbol === selectedSymbol;
            const price = isOwn ? ev.price : ev.other_prices?.[c.symbol];
            return `<td class="price" style="${cellStyle(c.symbol, isOwn)}">${fmtPrice(price, c.symbol)}</td>`;
          })
          .join("")}</tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<title>Kline Lab 事件导出</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0f1a;color:#d1d5db;padding:16px;font-size:14px}
h1{font-size:18px;font-weight:700;margin-bottom:4px;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#6b7280;font-size:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 6px;border-bottom:1px solid #374151;color:#9ca3af;font-weight:600;font-size:13px;white-space:nowrap}
td{padding:8px 6px;border-bottom:1px solid #1f2937;font-size:13px}
.date{color:#9ca3af;white-space:nowrap}
.price{text-align:right;font-family:"SF Mono","Cascadia Code","Consolas",monospace;white-space:nowrap;font-variant-numeric:tabular-nums}
.tag-ath{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid #166534;color:#4ade80;background:#052e16}
.tag-atl{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid #991b1b;color:#f87171;background:#450a0a}
.tag-up{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid #0891b2;color:#22d3ee;background:#083344}
.tag-down{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid #c2410c;color:#fb923c;background:#2d1b00}
</style>
</head>
<body>
<h1>Kline Lab · 事件导出</h1>
<div class="sub">${new Date().toISOString().split("T")[0]} · ${events.length} 条</div>
<table>
<thead>
<tr><th>日期</th><th>事件</th>${orderedCoins.map((c) => `<th>${c.symbol.replace("USDT", "")}</th>`).join("")}</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
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
