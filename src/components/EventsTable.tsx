"use client";

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
}

function getEventLabel(ev: NotableEvent): string {
  if (ev.event_type === "ath") return "ATH 新高";
  if (ev.event_type === "atl") return "ATL 新低";
  if (ev.direction === "UP") return "累计涨幅";
  return "累计跌幅";
}

function getEventColor(ev: NotableEvent): string {
  if (ev.event_type === "ath") return "text-green-400 bg-green-900/30 border-green-700";
  if (ev.event_type === "atl") return "text-red-400 bg-red-900/30 border-red-700";
  if (ev.direction === "UP") return "text-emerald-400 bg-emerald-900/30 border-emerald-700";
  return "text-orange-400 bg-orange-900/30 border-orange-700";
}

export default function EventsTable({ events, coins }: Props) {
  if (events.length === 0) {
    return (
      <div className="text-gray-400 text-center py-8 text-sm">
        暂无事件记录
      </div>
    );
  }

  const otherSymbols = coins.map((c) => c.symbol);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400">
            <th className="text-left py-2 px-2">日期</th>
            <th className="text-left py-2 px-2">事件</th>
            <th className="text-right py-2 px-2">价格</th>
            {otherSymbols.map((sym) => (
              <th key={sym} className="text-right py-2 px-2">
                {sym.replace("USDT", "")}
              </th>
            ))}
            <th className="text-right py-2 px-2">幅度</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr
              key={ev.id}
              className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
            >
              <td className="py-2 px-2 text-gray-300 whitespace-nowrap">
                {ev.event_date}
              </td>
              <td className="py-2 px-2">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
                    getEventColor(ev)
                  }`}
                >
                  {getEventLabel(ev)}
                </span>
              </td>
              <td className="py-2 px-2 text-right font-mono text-gray-200">
                ${ev.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              {otherSymbols.map((sym) => (
                <td key={sym} className="py-2 px-2 text-right font-mono text-gray-400">
                  {ev.other_prices?.[sym]
                    ? `$${ev.other_prices[sym].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "-"}
                </td>
              ))}
              <td className="py-2 px-2 text-right font-mono">
                {ev.change_pct != null ? (
                  <span className={ev.direction === "UP" ? "text-green-400" : "text-red-400"}>
                    {ev.direction === "UP" ? "+" : ""}{ev.change_pct.toFixed(1)}%
                  </span>
                ) : ev.event_type === "ath" ? (
                  <span className="text-green-400">新高</span>
                ) : (
                  <span className="text-blue-400">新低</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
