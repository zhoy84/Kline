"use client";

import { useState, useEffect } from "react";

interface Props {
  value: string; // 输入框显示的字符串值
  onRecompute: (threshold: number) => void; // 按钮点击时调用，传入解析后的数字阈值
  disabled?: boolean;
  recomputing?: boolean;
}

export default function DrawdownConfig({ value, onRecompute, disabled, recomputing }: Props) {
  // 输入框的本地显示值，与父组件完全隔离
  const [inputValue, setInputValue] = useState(value);

  // 当父组件的 value 变化时（例如切换币种重置为"20"），同步输入框
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 只在本地更新显示，完全不通知父组件
    setInputValue(e.target.value);
  };

  const handleRecompute = () => {
    // 只有按钮点击时，才从输入框读取值并调用父组件
    const threshold = parseInt(inputValue) || 20;
    onRecompute(threshold);
  };

  return (
    <div className="flex items-center gap-2 text-sm shrink-0">
      <span className="text-gray-400 whitespace-nowrap">阈值</span>
      <input
        type="number"
        min={5}
        max={50}
        value={inputValue}
        disabled={disabled}
        onChange={handleChange}
        className={`w-14 px-1.5 py-1 rounded text-gray-200 text-center text-sm border transition-colors ${
          disabled
            ? "bg-gray-800/50 border-gray-700 text-gray-500 cursor-not-allowed"
            : "bg-gray-800 border-gray-700 focus:border-blue-400 focus:outline-none"
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
