"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  symbol: string;
  value: number;
  disabled?: boolean;
  onChange: (val: number) => void;
  onRecompute: () => void;
  recomputing?: boolean;
  onExitPreview?: () => void; // 退出预览
}

function clamp(v: number): number {
  return Math.max(5, Math.min(50, v));
}

function getStored(symbol: string): number {
  try {
    const raw = localStorage.getItem(`kline_${symbol}_drawdown_threshold`);
    if (raw !== null) {
      const v = clamp(parseInt(raw, 10));
      if (!isNaN(v)) return v;
    }
  } catch {}
  return 20;
}

function store(symbol: string, val: number) {
  try {
    localStorage.setItem(`kline_${symbol}_drawdown_threshold`, String(val));
  } catch {}
}

export default function DrawdownConfig({
  symbol,
  value,
  disabled,
  onChange,
  onRecompute,
  recomputing,
  onExitPreview,
}: Props) {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const [rawInput, setRawInput] = useState<string>(String(value));
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 同步父组件传入的 value（例如切换币种时）
  useEffect(() => {
    setDisplayValue(value);
    setRawInput(String(value));
  }, [value]);

  const handleFocus = () => {
    if (!disabled) {
      setIsEditing(true);
      setRawInput(String(displayValue));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRawInput(e.target.value);
  };

  const handleBlur = () => {
    setIsEditing(false);
    const v = clamp(parseInt(rawInput) || displayValue);
    store(symbol, v);
    if (v !== displayValue) {
      setDisplayValue(v);
      onChange(v);
    } else {
      setRawInput(String(displayValue));
    }
  };

  const valueToShow = isEditing ? rawInput : String(displayValue);

  const handleRecompute = () => {
    const rawVal = rawInput.trim();
    const num = rawVal ? parseInt(rawVal) : displayValue;
    const v = clamp(num || displayValue);
    store(symbol, v);
    if (v !== displayValue) {
      setDisplayValue(v);
      onChange(v);
    }
    onRecompute();
  };

  return (
    <div className="flex items-center gap-1 text-sm shrink-0">
      <span className="text-gray-400 whitespace-nowrap">阈值</span>
      <input
        ref={inputRef}
        type="number"
        min={5}
        max={50}
        value={valueToShow}
        disabled={disabled}
        onChange={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`w-14 px-1.5 py-1 rounded text-gray-200 text-center text-sm border transition-colors ${
          disabled
            ? "bg-gray-800/50 border-gray-700 text-gray-500 cursor-not-allowed"
            : "bg-gray-800 border-gray-700 focus:border-gray-500 focus:outline-none"
        }`}
      />
      <span className="text-gray-500 text-xs">%</span>
      <button
        onClick={handleRecompute}
        disabled={disabled || recomputing}
        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
          disabled || recomputing
            ? "bg-gray-700/50 text-gray-500 cursor-not-allowed"
            : "bg-gray-700 text-gray-200 hover:bg-gray-600 active:bg-gray-500"
        }`}
      >
        {recomputing ? "计算中..." : "重新计算"}
      </button>
      {onExitPreview && (
        <button
          onClick={onExitPreview}
          disabled={disabled || recomputing}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            disabled || recomputing
              ? "bg-gray-700/50 text-gray-500 cursor-not-allowed"
              : "bg-gray-600 text-gray-200 hover:bg-gray-500"
          }`}
        >
          取消
        </button>
      )}
    </div>
  );
}
