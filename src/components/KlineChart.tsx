"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, ColorType, IChartApi, CandlestickSeries } from "lightweight-charts";

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
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const resizeObserver = useRef<ResizeObserver | null>(null);

  const formatData = useCallback(() => {
    return data.map((d) => ({
      time: Math.floor(d.open_time / 1000) as any, // lightweight-charts uses seconds
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
  }, [data]);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    const container = chartContainerRef.current;
    const rect = container.getBoundingClientRect();

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#1a1a2e" },
        textColor: "#d1d5db",
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

    candlestickSeries.setData(formatData());
    chart.timeScale().fitContent();

    // Zoom to last ~400 candles for thicker candle rendering
    const chartData = formatData();
    candlestickSeries.setData(chartData);
    chart.timeScale().fitContent();

    // Zoom to last ~400 candles for thicker candle rendering
    if (chartData.length > 400) {
      const lastIdx = chartData.length - 1;
      chart.timeScale().setVisibleRange({
        from: chartData[lastIdx - 399].time as any,
        to: chartData[lastIdx].time as any,
      });
    }

    // Resize observer
    resizeObserver.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height: Math.max(400, height) });
        setContainerSize({ width, height });
      }
    });
    resizeObserver.current.observe(container);

    return () => {
      resizeObserver.current?.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, formatData]);

  return (
    <div
      ref={chartContainerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ minHeight: "400px", height: "100%" }}
    />
  );
}
