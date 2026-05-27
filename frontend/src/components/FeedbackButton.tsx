import { useState, useRef } from "react";
import { api } from "../lib/api";
import { toast } from "../lib/toast";

interface Props {
  prefillTitle?: string;
  prefillDescription?: string;
  onClose?: () => void;
}

interface SystemInfo {
  version?: string;
  ua: string;
  url: string;
  lastError?: string;
  [key: string]: string | undefined;
}

async function getVersion(): Promise<string | undefined> {
  try {
    const r = await fetch("/api/health");
    if (r.ok) {
      const d = await r.json();
      return d.version || undefined;
    }
  } catch { /* ignore */ }
  return undefined;
}

export function FeedbackModal({ prefillTitle = "", prefillDescription = "", onClose }: Props) {
  const [title, setTitle] = useState(prefillTitle || "[Bug] ");
  const [description, setDescription] = useState(prefillDescription);
  const [includeSystemInfo, setIncludeSystemInfo] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ url: string; number: number | null } | null>(null);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      let systemInfo: SystemInfo | undefined;
      if (includeSystemInfo) {
        const version = await getVersion();
        systemInfo = {
          version,
          ua: navigator.userAgent,
          url: window.location.href,
          lastError: (window as any).__lastErrorMsg || undefined,
        };
      }
      const result = await api.submitFeedback({
        title: title.trim(),
        description: description.trim(),
        includeSystemInfo,
        systemInfo: includeSystemInfo ? systemInfo : undefined,
        isAutoReport: false,
      });
      setSubmitted(result);
    } catch (e) {
      toast.error("提交失败", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-[480px] max-w-[92vw] p-6 border border-gray-200" onClick={(e) => e.stopPropagation()}>
          <div className="text-center">
            <div className="text-3xl mb-3">✓</div>
            <h2 className="text-[16px] font-semibold text-gray-900 mb-1">Issue 已提交</h2>
            {submitted.number && (
              <p className="text-[13px] text-gray-500 mb-4">Issue #{submitted.number}</p>
            )}
            {submitted.url && (
              <a
                href={submitted.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-[13px] text-orange-600 hover:text-orange-700 underline mb-4"
              >
                在 GitHub 上查看 →
              </a>
            )}
            <button
              onClick={onClose}
              className="block w-full mt-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-[13px] font-medium text-gray-700 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-w-[92vw] border border-gray-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-900">反馈 / Report a Bug</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-[16px]">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1">标题 Title <span className="text-red-400">*</span></label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="[Bug] 简短描述问题..."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1">描述 Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder={"复现步骤：\n1. ...\n2. ...\n\n期望行为：...\n实际行为：..."}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors resize-none font-mono"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSystemInfo}
              onChange={(e) => setIncludeSystemInfo(e.target.checked)}
              className="rounded border-gray-300 text-orange-500 focus:ring-orange-400"
            />
            <span className="text-[12px] text-gray-600">自动附带系统信息（版本、URL、错误日志）</span>
          </label>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-gray-700 hover:bg-white transition-colors">
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting || !title.trim()}
            className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[12.5px] font-medium disabled:opacity-50 transition-colors"
          >
            {submitting ? "提交中…" : "提交 Issue →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ title?: string; description?: string }>({});

  // Expose a global trigger so ErrorBoundary / toast actions can open it pre-filled.
  (window as any).__openFeedback = (opts: { title?: string; description?: string }) => {
    setPrefill(opts || {});
    setOpen(true);
  };

  return (
    <>
      <button
        onClick={() => { setPrefill({}); setOpen(true); }}
        title="反馈 / Report a bug"
        className="fixed bottom-[72px] right-4 z-[9990] w-8 h-8 rounded-full bg-gray-200 hover:bg-orange-500 hover:text-white text-gray-600 text-[14px] font-bold shadow-sm transition-colors flex items-center justify-center select-none"
      >
        ?
      </button>
      {open && (
        <FeedbackModal
          prefillTitle={prefill.title}
          prefillDescription={prefill.description}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
