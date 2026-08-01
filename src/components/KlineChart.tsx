"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, CandlestickSeries, Time, MouseEventParams } from "lightweight-charts";

interface KlineData {
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  data: KlineData[];
}

export default function KlineChart({ data }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    const container = chartContainerRef.current;
    const rect = container.getBoundingClientRect();

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#1a1a2e" },
        textColor: "#d1d5db",
      },
      localization: {
        timeFormatter: (time: Time) => {
          // time is in seconds (Unix epoch), convert to milliseconds for Date
          const d = new Date((time as number) * 1000);
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          return `${y}-${m}-${day}`;
        },
      },
      grid: {
        vertLines: { color: "#2a2a4a" },
        horzLines: { color: "#2a2a4a" },
      },
      width: rect.width,
      height: Math.max(400, rect.height),
      crosshair: {
        mode: 0,
      },
      timeScale: {
        timeVisible: false,
        borderColor: "#2a2a4a",
        tickMarkFormatter: (time: Time) => {
          // time is in seconds (Unix epoch), convert to milliseconds for Date
          const d = new Date((time as number) * 1000);
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, "0");
          return `${y}-${m}`;
        },
      },
      rightPriceScale: {
        borderColor: "#2a2a4a",
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      wickUpColor: "#22c55e",
    });

    const chartData = data.map((d) => ({
      time: Math.floor(d.open_time / 1000) as any,
      open: Number(d.open),      // 转为数字
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
    }));

    candlestickSeries.setData(chartData);
    chart.timeScale().fitContent();

    // --- Hover tooltip showing OHLC + change % ---
    const tooltip = document.createElement("div");
    tooltip.style.cssText = `
      position: absolute;
      display: none;
      background: rgba(26, 26, 46, 0.95);
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 11px;
      line-height: 1.7;
      color: #d1d5db;
      pointer-events: none;
      z-index: 20;
      min-width: 150px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    `;
    container.style.position = "relative";
    container.appendChild(tooltip);

    const fmtPrice = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const onCrosshairMove = (param: MouseEventParams) => {
      const hovered = param.seriesData.get(candlestickSeries) as
        | { open: number; high: number; low: number; close: number; time: Time }
        | undefined;

      if (!hovered || !param.point) {
        tooltip.style.display = "none";
        return;
      }

      const { open, high, low, close } = hovered;
      const changePct = ((close - open) / open) * 100;
      const isUp = close >= open;
      const color = isUp ? "#22c55e" : "#ef4444";
      const sign = changePct >= 0 ? "+" : "";
      const arrow = isUp ? "▲" : "▼";

      const t = hovered.time;
      const dateStr = typeof t === "number"
        ? new Date(t * 1000).toISOString().split("T")[0]
        : String(t);

      tooltip.innerHTML = `
        <div style="font-weight:600;color:#e5e7eb;margin-bottom:4px;">${dateStr}</div>
        <div style="display:flex;justify-content:space-between;gap:16px;">
          <span style="color:#9ca3af;">开盘</span><span>${fmtPrice(open)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;">
          <span style="color:#9ca3af;">最高</span><span>${fmtPrice(high)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;">
          <span style="color:#9ca3af;">最低</span><span>${fmtPrice(low)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;">
          <span style="color:#9ca3af;">收盘</span><span>${fmtPrice(close)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;border-top:1px solid #2a2a4a;margin-top:4px;padding-top:4px;color:${color};font-weight:600;">
          <span>涨跌幅</span><span>${arrow} ${sign}${changePct.toFixed(2)}%</span>
        </div>
      `;
      tooltip.style.display = "block";

      // Position near the crosshair, flip to the left if it would overflow the right edge
      const { x, y } = param.point;
      const containerWidth = container.clientWidth;
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const margin = 16;
      let left = x + margin;
      if (left + tooltipWidth > containerWidth - 4) {
        left = x - tooltipWidth - margin;
      }
      let top = y - tooltipHeight - margin;
      if (top < 4) {
        top = y + margin;
      }
      tooltip.style.left = `${Math.max(4, left)}px`;
      tooltip.style.top = `${Math.max(4, top)}px`;
    };

    chart.subscribeCrosshairMove(onCrosshairMove);

    // Zoom to show recent candles with better visibility
    // Show last 70 candles (~70 days), with the latest candle at the right edge
    const displayCount = 70;
    if (chartData.length > displayCount) {
      const lastIdx = chartData.length - 1;
      // Display last displayCount candles, including the latest one
      const viewStart = lastIdx - displayCount + 1;
      const viewEnd = lastIdx;  // Include latest candle
      chart.timeScale().setVisibleRange({
        from: chartData[viewStart].time as any,
        to: chartData[viewEnd].time as any,
      });
    } else if (chartData.length > 0) {
      // For less data, show everything
      chart.timeScale().fitContent();
    }

    // Resize observer
    resizeObserver.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height: Math.max(400, height) });
      }
    });
    resizeObserver.current.observe(container);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      tooltip.remove();
      resizeObserver.current?.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  return (
    <div
      ref={chartContainerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ minHeight: "300px", height: "100%" }}
    />
  );
}
