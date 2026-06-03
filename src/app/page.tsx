"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import CoinSelector from "@/components/CoinSelector";
import EventsTable, { exportEventsAsHtml } from "@/components/EventsTable";
import DrawdownConfig from "@/components/DrawdownConfig";
import StakingCalculator from "@/components/StakingCalculator";

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
  const [tab, setTab] = useState<"kline" | "staking">("kline");
  const [coins, setCoins] = useState<Coin[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [events, setEvents] = useState<NotableEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawdownThreshold, setDrawdownThreshold] = useState(20);
  const [recomputing, setRecomputing] = useState(false);
  const initialLoadDone = useRef(false);

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
  const fetchData = useCallback(async (symbol: string, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [klinesRes, eventsRes] = await Promise.all([
        fetch(`/api/klines?symbol=${symbol}&limit=2000`),
        fetch(`/api/events?symbol=${symbol}`),
      ]);

      if (!klinesRes.ok) throw new Error(`API /api/klines returned ${klinesRes.status}`);
      if (!eventsRes.ok) throw new Error(`API /api/events returned ${eventsRes.status}`);

      const klinesData = await klinesRes.json();
      const eventsData = await eventsRes.json();
      setKlines(klinesData);
      setEvents(eventsData);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Initial load + symbol change
  useEffect(() => {
    if (selectedSymbol) {
      fetchData(selectedSymbol, true);
      initialLoadDone.current = true;
    }
  }, [selectedSymbol, fetchData]);

  // Auto-refresh every 60 seconds (no loading spinner)
  useEffect(() => {
    if (!initialLoadDone.current) return;
    const interval = setInterval(() => {
      if (selectedSymbol) fetchData(selectedSymbol, false);
    }, 60000);
    return () => clearInterval(interval);
  }, [selectedSymbol, fetchData]);

  // Export events as downloadable HTML file
  const handleExport = useCallback(() => {
    const html = exportEventsAsHtml(events, coins, selectedSymbol);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kline-events-${selectedSymbol.replace("USDT", "")}-${new Date().toISOString().split("T")[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [events, coins, selectedSymbol]);

  // Recompute events with current threshold
  const handleRecompute = useCallback(async () => {
    setRecomputing(true);
    try {
      const res = await fetch("/api/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: drawdownThreshold, lookback: 5 }),
      });
      if (!res.ok) throw new Error(`Recompute returned ${res.status}`);
      const data = await res.json();
      console.log(`Recomputed ${data.events} events`);
      // Refresh current view
      if (selectedSymbol) fetchData(selectedSymbol, false);
    } catch (err) {
      console.error("Recompute error:", err);
    } finally {
      setRecomputing(false);
    }
  }, [drawdownThreshold, selectedSymbol, fetchData]);

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-[#1a1a2e]/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                K-line Lab
              </h1>
            <span className="text-xs text-gray-500 hidden sm:inline">2020 ~ Now</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
            <div className="flex bg-gray-800 rounded-lg p-0.5 mr-2">
              <button
                onClick={() => setTab("kline")}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  tab === "kline" ? "bg-gray-700 text-gray-100" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                K-line Lab
              </button>
              <button
                onClick={() => setTab("staking")}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  tab === "staking" ? "bg-gray-700 text-gray-100" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                质押策略器
              </button>
            </div>
            {tab === "kline" && <span className="text-xs text-gray-600">K-line Lab</span>}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {tab === "kline" ? (
          loading ? (
            <div className="flex items-center justify-center h-96">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Chart */}
              <div className="w-full lg:w-[60%] min-h-[400px] lg:min-h-[600px] bg-[#1a1a2e] rounded-lg border border-gray-800">
                <KlineChart data={klines} />
              </div>
              {/* Events Table */}
              <div className="w-full lg:w-[40%] bg-[#1a1a2e] rounded-lg border border-gray-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-300">
                      历史事件记录
                      <span className="text-xs text-gray-500 ml-2">({events.length})</span>
                    </h2>
                    <button
                      onClick={handleExport}
                      className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors"
                    >
                      导出
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <CoinSelector
                      coins={coins}
                      selected={selectedSymbol}
                      onSelect={setSelectedSymbol}
                    />
                    <DrawdownConfig
                      value={drawdownThreshold}
                      onChange={setDrawdownThreshold}
                      disabled={recomputing}
                      onBlur={handleRecompute}
                    />
                  </div>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 160px)" }}>
                  <EventsTable events={events} coins={coins} selectedSymbol={selectedSymbol} />
                </div>
              </div>
            </div>
          )
        ) : (
          <StakingCalculator />
        )}
      </main>
    </div>
  );
}

