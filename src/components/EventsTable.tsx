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

function fmtPrice(p: number | undefined | null): string {
  if (p == null) return "-";
  return "$" + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
                return (
                  <td
                    key={c.symbol}
                    className={`py-2 px-1.5 text-right font-mono ${
                      isOwn ? "text-gray-200" : "text-gray-500"
                    }`}
                  >
                    {fmtPrice(price)}
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
