import { createContext, useContext, useState, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import MarkdownBlock from "../blocks/MarkdownBlock";

interface PreviewRequest {
  cwd: string;
  path: string;
}

interface Ctx {
  open: (req: PreviewRequest) => void;
}

const FilePreviewContext = createContext<Ctx | null>(null);

export function useFilePreview() {
  return useContext(FilePreviewContext);
}

function iconFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx"].includes(ext)) return "📘";
  if (["js", "jsx"].includes(ext)) return "📙";
  if (["py"].includes(ext)) return "🐍";
  if (["md", "mdx"].includes(ext)) return "📝";
  if (["json"].includes(ext)) return "{}";
  if (["css", "scss"].includes(ext)) return "🎨";
  if (["html"].includes(ext)) return "🌐";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "🖼";
  return "📄";
}

function Modal({ req, onClose }: { req: PreviewRequest; onClose: () => void }) {
  const filename = req.path.split("/").pop() || req.path;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const isImage = ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);
  const isMarkdown = ["md", "mdx", "markdown"].includes(ext);
  const isPdf = ext === "pdf";
  const isBinary = isImage || isPdf;
  const rawUrl = (() => {
    const b64 = btoa(unescape(encodeURIComponent(req.cwd)));
    return `/api/files/read?cwd=${b64}&path=${encodeURIComponent(req.path)}&encoding=base64&raw=1`;
  })();

  // Skip the JSON text fetch entirely for binary previews (PDF / image).
  const { data, isLoading, error } = useQuery({
    queryKey: ["file-read", req.cwd, req.path],
    queryFn: () => api.fileRead(req.cwd, req.path),
    enabled: !isBinary,
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[860px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
          <span className="text-base">{iconFor(filename)}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-gray-900 truncate">{filename}</div>
            <div className="text-[11px] text-gray-400 font-mono truncate">{req.path}</div>
          </div>
          {data && (
            <span className="text-[11px] text-gray-400 shrink-0">
              {(data.size / 1024).toFixed(1)} KB{data.truncated ? " (truncated)" : ""}
            </span>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500 text-[16px] leading-none shrink-0"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading && <div className="flex items-center justify-center h-40 text-gray-400 text-[13px]">Loading…</div>}
          {error && <div className="flex items-center justify-center h-40 text-red-500 text-[13px]">Failed to load file</div>}
          {isImage && (
            <div className="flex items-center justify-center p-8 bg-gray-50">
              <img
                src={rawUrl}
                alt={filename}
                className="max-w-full max-h-[60vh] object-contain rounded-lg shadow"
              />
            </div>
          )}
          {isPdf && (
            <iframe
              src={rawUrl}
              title={filename}
              className="w-full h-[70vh] bg-white"
            />
          )}
          {data && !isBinary && isMarkdown && (
            <div className="p-6">
              <MarkdownBlock text={data.text} />
            </div>
          )}
          {data && !isBinary && !isMarkdown && (
            <pre className="text-[12.5px] font-mono leading-relaxed text-gray-800 p-5 whitespace-pre-wrap break-words">
              {data.text}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<PreviewRequest | null>(null);
  return (
    <FilePreviewContext.Provider value={{ open: setReq }}>
      {children}
      {req && <Modal req={req} onClose={() => setReq(null)} />}
    </FilePreviewContext.Provider>
  );
}
