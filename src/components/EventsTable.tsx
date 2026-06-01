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

  const coinColor = (symbol: string, isOwn: boolean): string => {
    if (isOwn) return WEB.coinOwn;
    const base = symbol.replace("USDT", "");
    const map: Record<string, string> = {
      BTC: WEB.coinBTC,
      ETH: WEB.coinETH,
      DOGE: WEB.coinDOGE,
    };
    return map[base] ?? WEB.coinOther;
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
    const style =
      ev.event_type === "ath"
        ? `color:${WEB.tagAthText};border-color:${WEB.tagAthBorder};background:${WEB.tagAthBg}`
        : ev.event_type === "atl"
          ? `color:${WEB.tagAtlText};border-color:${WEB.tagAtlBorder};background:${WEB.tagAtlBg}`
          : ev.direction === "UP"
            ? `color:${WEB.tagUpText};border-color:${WEB.tagUpBorder};background:${WEB.tagUpBg}`
            : `color:${WEB.tagDownText};border-color:${WEB.tagDownBorder};background:${WEB.tagDownBg}`;
    return `<span class="tag" style="${style}">${label}</span>`;
  };

  const rows = events
    .map(
      (ev) =>
        `<tr><td class="date" style="color:${WEB.dateText}">${ev.event_date}</td><td>${tagHtml(ev)}</td>${orderedCoins
          .map((c) => {
            const isOwn = c.symbol === selectedSymbol;
            const price = isOwn ? ev.price : ev.other_prices?.[c.symbol];
            return `<td class="price" style="color:${coinColor(c.symbol, isOwn)}">${fmtPrice(price, c.symbol)}</td>`;
          })
          .join("")}</tr>`
    )
    .join("\n");

  // Tailwind palette — keep in sync with web
  const WEB = {
    body: "#0f0f1a",
    text: "#d1d5db",       // gray-300
    textMuted: "#9ca3af",  // gray-400
    tableBg: "#1a1a2e",
    headerBg: "transparent",
    headerText: "#9ca3af",
    headerBorder: "#374151", // gray-700
    rowBorder: "#1f2937",   // gray-800
    rowHover: "rgba(31,41,55,0.5)",
    selectedHeader: "#60a5fa", // blue-400
    dateText: "#d1d5db",
    coinOwn: "#e5e7eb",    // gray-200
    coinBTC: "#fbbf24",    // amber-400
    coinETH: "#a78bfa",    // violet-300
    coinDOGE: "#34d399",   // emerald-400
    coinOther: "#6b7280",  // gray-500
    // Tags
    tagAthText: "#4ade80", tagAthBorder: "#15803d", tagAthBg: "rgba(20,83,45,0.3)",
    tagAtlText: "#f87171", tagAtlBorder: "#b91c1c", tagAtlBg: "rgba(127,29,29,0.3)",
    tagUpText: "#22d3ee",  tagUpBorder: "#0e7490",  tagUpBg: "rgba(22,78,99,0.3)",
    tagDownText: "#fb923c", tagDownBorder: "#c2410c", tagDownBg: "rgba(124,45,18,0.3)",
  };

  const thCells = orderedCoins
    .map(
      (c) =>
        `<th style="text-align:left;padding:8px 6px;border-bottom:1px solid ${WEB.headerBorder};color:${c.symbol === selectedSymbol ? WEB.selectedHeader : WEB.headerText};font-weight:600;font-size:13px;white-space:nowrap">${c.symbol.replace("USDT", "")}</th>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<title>Kline Lab 事件导出</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:${WEB.body};color:${WEB.text};padding:16px;font-size:16px;line-height:1.5}
.wrap{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid ${WEB.rowBorder};border-radius:10px;background:${WEB.tableBg}}
table{width:100%;border-collapse:collapse;min-width:300px}
th,td{padding:10px 8px}
thead tr{border-bottom:1px solid ${WEB.headerBorder}}
tbody tr{border-bottom:1px solid ${WEB.rowBorder};transition:background .15s}
tbody tr:hover{background:${WEB.rowHover}}
.price{text-align:right;font-family:"SF Mono","Cascadia Code","Consolas",monospace;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:16px}
.tag{display:inline-block;padding:3px 10px;border-radius:5px;font-size:13px;font-weight:600;border:1px solid}
.date{white-space:nowrap;font-size:15px}
</style>
</head>
<body>
<div class="wrap">
<table>
<thead>
<tr><th style="text-align:left;color:${WEB.headerText};font-weight:600;font-size:14px;padding:12px 8px">日期</th><th style="text-align:left;color:${WEB.headerText};font-weight:600;font-size:14px;padding:12px 8px">事件</th>${thCells}</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</div>
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
