"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  symbol: string;
  value: number;
  disabled?: boolean;
  onChange: (val: number) => void;
  onRecompute: () => void;
  recomputing?: boolean;
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
      // focus 后 input 立即获得焦点
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
      // 恢复为 displayValue
      setRawInput(String(displayValue));
    }
  };

  const valueToShow = isEditing ? rawInput : String(displayValue);

  const handleChange = (raw: string) => {
    const v = clamp(parseInt(raw) || 20);
    store(symbol, v);
    onChange(v);
  };

  const handleRecompute = () => {
    const rawVal = rawInput.trim();
    const num = rawVal ? parseInt(rawVal) : displayValue;
    const v = clamp(num || displayValue);
    store(symbol, v);
    // 如果与 displayValue 不同，先更新 displayValue 和触发 onChange
    if (v !== displayValue) {
      setDisplayValue(v);
      onChange(v);
    }
    onRecompute();
  };

  return (
    <div className="flex items-center gap-2 text-sm shrink-0">
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
        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
          disabled || recomputing
            ? "bg-gray-700/50 text-gray-500 cursor-not-allowed"
            : "bg-gray-700 text-gray-200 hover:bg-gray-600 active:bg-gray-500"
        }`}
      >
        {recomputing ? "计算中..." : "重新计算"}
      </button>
    </div>
  );
}
