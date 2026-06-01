"use client";

interface Props {
  value: number;
  onChange: (val: number) => void;
}

export default function DrawdownConfig({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span>回调阈值:</span>
      <input
        type="number"
        min={5}
        max={50}
        value={value}
        onChange={(e) => onChange(Math.max(5, Math.min(50, parseInt(e.target.value) || 20)))}
        className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-center"
      />
      <span>%</span>
    </div>
  );
}
