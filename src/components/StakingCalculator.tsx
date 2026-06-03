"use client";

export default function StakingCalculator() {
  return (
    <div className="w-full overflow-auto" style={{ height: "calc(100vh - 100px)", minHeight: "600px" }}>
      <iframe
        src="/staking-calculator.html"
        className="border-0"
        title="质押策略计算器"
        style={{ width: "100%", height: "100%", minHeight: "1200px", background: "#0f0f1a" }}
      />
    </div>
  );
}
