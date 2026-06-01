"use client";

interface Props {
  value: number;
  onChange: (val: number) => void;
}

export default function DrawdownConfig({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-gray-400 whitespace-nowrap shrink-0">
      <span>阈值</span>
      <input
        type="number"
        min={5}
        max={50}
        value={value}
        onChange={(e) => onChange(Math.max(5, Math.min(50, parseInt(e.target.value) || 20)))}
        className="w-14 px-1.5 py-1 bg-gray-800 border border-gray-700 rounded text-gray-200 text-center text-sm"
      />
      <span>%</span>
    </div>
  );
}
