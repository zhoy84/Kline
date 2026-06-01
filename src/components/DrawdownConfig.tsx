"use client";

import { useRef } from "react";

interface Props {
  value: number;
  disabled?: boolean;
  onChange: (val: number) => void;
  onBlur?: (val: number) => void;
}

function clamp(v: number): number {
  return Math.max(5, Math.min(50, v));
}

export default function DrawdownConfig({ value, disabled, onChange, onBlur }: Props) {
  const committedRef = useRef(value);

  const handleChange = (raw: string) => {
    onChange(clamp(parseInt(raw) || 20));
  };

  const handleFocus = () => {
    committedRef.current = value;
  };

  const handleBlur = () => {
    if (value !== committedRef.current) {
      committedRef.current = value;
      onBlur?.(value);
    }
  };

  return (
    <div className="flex items-center gap-1.5 text-sm text-gray-400 whitespace-nowrap shrink-0">
      <span>阈值</span>
      <input
        type="number"
        min={5}
        max={50}
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`w-14 px-1.5 py-1 rounded text-gray-200 text-center text-sm transition-colors ${
          disabled
            ? "bg-gray-800/50 border border-gray-700 text-gray-500 cursor-not-allowed"
            : "bg-gray-800 border border-gray-700"
        }`}
      />
      <span>%</span>
    </div>
  );
}
