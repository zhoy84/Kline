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
  if (ev.direction === "UP") return "涨幅";
  return "跌幅";
}

function getEventColor(ev: NotableEvent): string {
  if (ev.event_type === "ath") return "text-green-400 bg-green-900/30 border-green-700";
  if (ev.event_type === "atl") return "text-red-400 bg-red-900/30 border-red-700";
  if (ev.direction === "UP") return "text-emerald-400 bg-emerald-900/30 border-emerald-700";
  return "text-orange-400 bg-orange-900/30 border-orange-700";
}

/** Format a price value into display string */
function fmtPrice(p: number | undefined | null): string {
  if (p == null) return "-";
  return "$" + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format change indicator for the selected coin's price cell */
function changeSuffix(ev: NotableEvent): string {
  if (ev.change_pct != null) {
    const sign = ev.direction === "UP" ? "↑" : "↓";
    return `${sign}${Math.abs(ev.change_pct).toFixed(1)}%`;
  }
  if (ev.event_type === "ath") return "↑新高";
  if (ev.event_type === "atl") return "↓新低";
  return "";
}

export default function EventsTable({ events, coins, selectedSymbol }: Props) {
  // Order coins so the selected one is first
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
                // The event's own coin: show price from `price` + change indicator
                // Other coins: show price from `other_prices`
                const isOwn = c.symbol === selectedSymbol;
                const price = isOwn ? ev.price : ev.other_prices?.[c.symbol];
                const indicator = isOwn ? changeSuffix(ev) : "";

                return (
                  <td
                    key={c.symbol}
                    className={`py-2 px-1.5 text-right font-mono ${
                      isOwn ? "text-gray-200" : "text-gray-500"
                    }`}
                  >
                    {fmtPrice(price)}
                    {indicator && (
                      <span className="ml-1 text-xs">{indicator}</span>
                    )}
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
