"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, CandlestickSeries, Time } from "lightweight-charts";

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
