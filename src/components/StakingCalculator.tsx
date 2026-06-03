"use client";

export default function StakingCalculator() {
  return (
    <div className="w-full" style={{ height: "calc(100vh - 100px)", minHeight: "600px" }}>
      <iframe
        src="/staking-calculator.html"
        className="w-full h-full border-0 rounded-lg"
        title="质押策略计算器"
        style={{ background: "#0f0f1a" }}
      />
    </div>
  );
}
