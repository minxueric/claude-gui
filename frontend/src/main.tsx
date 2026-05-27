import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import { FilePreviewProvider } from "./components/chat/FilePreviewContext";
import FeedbackButton from "./components/FeedbackButton";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";
import "highlight.js/styles/github.css";

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

// Store last unhandled error message for attaching to feedback reports.
window.addEventListener("error", (e) => {
  (window as any).__lastErrorMsg = e.message;
  if (localStorage.getItem("auto-report-errors") !== "true") return;
  const title = `[AutoBug] ${(e.message || "Unknown error").slice(0, 80)}`;
  const description = `## 未捕获的全局错误\n\n\`\`\`\n${e.error?.stack || e.message}\n\`\`\``;
  fetch("/api/feedback/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      includeSystemInfo: true,
      systemInfo: { ua: navigator.userAgent, url: window.location.href },
      isAutoReport: true,
    }),
  }).catch(() => { /* silent */ });
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message || String(e.reason) || "Unhandled promise rejection";
  (window as any).__lastErrorMsg = msg;
  if (localStorage.getItem("auto-report-errors") !== "true") return;
  const title = `[AutoBug] ${msg.slice(0, 80)}`;
  const description = `## 未处理的 Promise 拒绝\n\n\`\`\`\n${e.reason?.stack || msg}\n\`\`\``;
  fetch("/api/feedback/issue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      includeSystemInfo: true,
      systemInfo: { ua: navigator.userAgent, url: window.location.href },
      isAutoReport: true,
    }),
  }).catch(() => { /* silent */ });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <FilePreviewProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </FilePreviewProvider>
      </BrowserRouter>
    </QueryClientProvider>
    <Toaster richColors position="bottom-right" closeButton expand={false} />
    <FeedbackButton />
  </React.StrictMode>
);
