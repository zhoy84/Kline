"use client";

import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0f0f1a] text-gray-100 flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <h2 className="text-xl font-bold text-red-400 mb-2">页面加载异常</h2>
            <p className="text-gray-400 text-sm mb-4">
              {this.state.error?.message || "未知错误"}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
            >
              重新加载
            </button>
            <p className="mt-4 text-xs text-gray-600">
              如果问题持续，请检查 Vercel 环境变量是否已配置 POSTGRES_URL
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
