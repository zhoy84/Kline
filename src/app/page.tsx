"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import CoinSelector from "@/components/CoinSelector";
import EventsTable from "@/components/EventsTable";
import DrawdownConfig from "@/components/DrawdownConfig";

const KlineChart = dynamic(() => import("@/components/KlineChart"), { ssr: false });

interface Coin {
  id: number;
  symbol: string;
  name: string;
  active: boolean;
}

interface KlineData {
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface NotableEvent {
  id: number;
  coin_id: number;
  event_type: "ath" | "atl" | "drawdown";
  direction: "UP" | "DOWN";
  event_date: string;
  price: number;
  change_pct: number | null;
  other_prices: Record<string, number> | null;
}

export default function Home() {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [events, setEvents] = useState<NotableEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawdownThreshold, setDrawdownThreshold] = useState(20);

  // Fetch coins list
  useEffect(() => {
    fetch("/api/coins")
      .then(async (r) => {
        if (!r.ok) throw new Error(`API /api/coins returned ${r.status}`);
        const data = await r.json();
        setCoins(data);
        if (data.length > 0) setSelectedSymbol(data[0].symbol);
      })
      .catch((err) => console.error("Coins fetch error:", err));
  }, []);

  // Fetch klines + events when symbol changes
  const fetchData = useCallback(async (symbol: string) => {
    setLoading(true);
    try {
      const [klinesRes, eventsRes] = await Promise.all([
        fetch(`/api/klines?symbol=${symbol}&limit=2000`),
        fetch(`/api/events?symbol=${symbol}`),
      ]);

      if (!klinesRes.ok) throw new Error(`API /api/klines returned ${klinesRes.status}`);
      if (!eventsRes.ok) throw new Error(`API /api/events returned ${eventsRes.status}`);

      const klinesData = await klinesRes.json();
      const eventsData = await eventsRes.json();
      console.log(`Loaded ${klinesData.length} klines, ${eventsData.length} events for ${symbol}`);
      setKlines(klinesData);
      setEvents(eventsData);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSymbol) fetchData(selectedSymbol);
  }, [selectedSymbol, fetchData]);

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-[#1a1a2e]/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Crypto K-Line
            </h1>
            <span className="text-xs text-gray-500 hidden sm:inline">2020 ~ Now</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
            <CoinSelector
              coins={coins}
              selected={selectedSymbol}
              onSelect={setSelectedSymbol}
            />
            <DrawdownConfig value={drawdownThreshold} onChange={setDrawdownThreshold} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Chart - full width on mobile, left 60% on desktop */}
            <div className="w-full lg:w-[60%] min-h-[400px] lg:min-h-[600px] bg-[#1a1a2e] rounded-lg border border-gray-800">
              <KlineChart data={klines} />
            </div>

            {/* Events Table - full width on mobile, right 40% on desktop */}
            <div className="w-full lg:w-[40%] bg-[#1a1a2e] rounded-lg border border-gray-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-gray-300">
                  历史事件记录
                  <span className="text-xs text-gray-500 ml-2">({events.length})</span>
                </h2>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 160px)" }}>
                <EventsTable events={events} coins={coins} selectedSymbol={selectedSymbol} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

