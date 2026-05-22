import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { FilePreviewProvider } from "./components/chat/FilePreviewContext";
import "./index.css";
import "highlight.js/styles/github.css";

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <FilePreviewProvider>
          <App />
        </FilePreviewProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
