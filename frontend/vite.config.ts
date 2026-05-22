import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        // SSE streams must not be buffered
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, req) => {
            if (req.headers.accept?.includes("text/event-stream")) {
              _proxyReq.setHeader("connection", "keep-alive");
            }
            // Preserve percent-encoded non-ASCII characters (e.g. Chinese paths)
            // http-proxy may decode them; re-set the path from the original URL
            if (req.url) {
              _proxyReq.path = req.url;
            }
          });
        },
      },
    },
  },
});
