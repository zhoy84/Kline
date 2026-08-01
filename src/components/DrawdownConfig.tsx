"use client";

import { useState, useEffect } from "react";

interface Props {
  value: number;
  onRecompute: (threshold: number) => void;
  disabled?: boolean;
  recomputing?: boolean;
}

export default function DrawdownConfig({ value, onRecompute, disabled, recomputing }: Props) {
  const [input, setInput] = useState(String(value));

  useEffect(() => {
    setInput(String(value));
  }, [value]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const onClick = () => {
    const v = parseInt(input) || 20;
    onRecompute(v);
  };

  return (
    <div className="flex items-center gap-2 text-sm shrink-0">
      <span className="text-gray-400 whitespace-nowrap">阈值</span>
      <input
        type="number"
        min={5}
        max={50}
        value={input}
        disabled={disabled}
        onChange={onChange}
        className={`w-14 px-1.5 py-1 rounded text-gray-200 text-center text-sm border transition-colors ${
          disabled
            ? "bg-gray-800/50 border-gray-700 text-gray-500 cursor-not-allowed"
            : "bg-gray-800 border-gray-700 focus:border-blue-400 focus:outline-none"
        }`}
      />
      <span className="text-gray-500 text-xs">%</span>
      <button
        onClick={onClick}
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
