import { Component, ReactNode } from "react";
import { api } from "../lib/api";
import { toast } from "../lib/toast";

interface Props {
  children: ReactNode;
  autoReport?: boolean;
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

  componentDidCatch(error: Error) {
    const autoReport = localStorage.getItem("auto-report-errors") === "true";
    if (!autoReport) return;
    const title = `[AutoBug] ${error.message.slice(0, 80)}`;
    const description = `## 自动捕获的错误\n\n\`\`\`\n${error.stack || error.message}\n\`\`\``;
    api.submitFeedback({
      title,
      description,
      includeSystemInfo: true,
      systemInfo: { ua: navigator.userAgent, url: window.location.href },
      isAutoReport: true,
    }).then((r) => {
      toast.error(`崩溃已上报 Issue #${r.number || "?"}`, {
        description: "点击查看",
      });
    }).catch(() => { /* silent */ });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-white">
          <div className="max-w-md text-center px-6">
            <p className="text-[28px] mb-3">💥</p>
            <h1 className="text-[18px] font-semibold text-gray-900 mb-2">页面崩溃了</h1>
            <p className="text-[13px] text-gray-500 mb-4 font-mono break-all">
              {this.state.error?.message}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 rounded-lg bg-orange-500 text-white text-[13px] font-medium hover:bg-orange-600 transition-colors"
              >
                重试
              </button>
              <button
                onClick={() => {
                  const msg = this.state.error?.message || "";
                  (window as any).__openFeedback?.({
                    title: `[Bug] ${msg.slice(0, 60)}`,
                    description: `## 错误\n\n\`\`\`\n${this.state.error?.stack || msg}\n\`\`\``,
                  });
                }}
                className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-[13px] font-medium hover:bg-gray-50 transition-colors"
              >
                报告问题
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
