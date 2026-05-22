import { useEffect, useState } from "react";
import { diffLines, Change } from "diff";
import { api } from "../../lib/api";

interface Props {
  name: string; // "Edit" | "Write" | "MultiEdit"
  input: any;
  cwd?: string;
}

interface DiffSection {
  title?: string;
  filePath?: string;
  changes: Change[];
  loading?: boolean;
  error?: string;
}

const COLLAPSE_LINES = 40;

function countLines(changes: Change[]): number {
  let n = 0;
  for (const c of changes) {
    n += (c.value.match(/\n/g) || []).length + (c.value.endsWith("\n") ? 0 : 1);
  }
  return n;
}

interface DiffRow {
  sign: "+" | "-" | " ";
  text: string;
  oldNo?: number;
  newNo?: number;
}

function renderDiffLines(changes: Change[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const c of changes) {
    const lines = c.value.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    for (const ln of lines) {
      if (c.added) {
        rows.push({ sign: "+", text: ln, newNo });
        newNo++;
      } else if (c.removed) {
        rows.push({ sign: "-", text: ln, oldNo });
        oldNo++;
      } else {
        rows.push({ sign: " ", text: ln, oldNo, newNo });
        oldNo++;
        newNo++;
      }
    }
  }
  return rows;
}

// Pair removed/added lines into left/right columns for side-by-side view.
interface SideRow {
  left?: { text: string; no: number; type: "del" | "ctx" };
  right?: { text: string; no: number; type: "add" | "ctx" };
}

function pairForSideBySide(rows: DiffRow[]): SideRow[] {
  const out: SideRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.sign === " ") {
      out.push({
        left: { text: r.text, no: r.oldNo!, type: "ctx" },
        right: { text: r.text, no: r.newNo!, type: "ctx" },
      });
      i++;
      continue;
    }
    // Collect consecutive del+add hunks
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (i < rows.length && rows[i].sign === "-") { dels.push(rows[i]); i++; }
    while (i < rows.length && rows[i].sign === "+") { adds.push(rows[i]); i++; }
    const len = Math.max(dels.length, adds.length);
    for (let k = 0; k < len; k++) {
      out.push({
        left: dels[k] ? { text: dels[k].text, no: dels[k].oldNo!, type: "del" } : undefined,
        right: adds[k] ? { text: adds[k].text, no: adds[k].newNo!, type: "add" } : undefined,
      });
    }
  }
  return out;
}

function InlineDiffBody({ changes }: { changes: Change[] }) {
  const rows = renderDiffLines(changes);
  return (
    <div className="font-mono text-[11.5px] leading-relaxed bg-white overflow-x-auto">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            "flex " +
            (r.sign === "+" ? "bg-green-50" : r.sign === "-" ? "bg-red-50" : "")
          }
        >
          <span className="w-10 text-right pr-2 text-gray-400 shrink-0 select-none tabular-nums">{r.oldNo ?? ""}</span>
          <span className="w-10 text-right pr-2 text-gray-400 shrink-0 select-none tabular-nums">{r.newNo ?? ""}</span>
          <span className={
            "w-4 shrink-0 select-none text-center " +
            (r.sign === "+" ? "text-green-600" : r.sign === "-" ? "text-red-500" : "text-gray-300")
          }>{r.sign}</span>
          <span className={
            "whitespace-pre flex-1 pr-3 " +
            (r.sign === "+" ? "text-green-800" : r.sign === "-" ? "text-red-700" : "text-gray-700")
          }>{r.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

function SideBySideDiffBody({ changes }: { changes: Change[] }) {
  const pairs = pairForSideBySide(renderDiffLines(changes));
  return (
    <div className="font-mono text-[11.5px] leading-relaxed bg-white grid grid-cols-2 divide-x divide-gray-200">
      <div className="overflow-x-auto min-w-0">
        {pairs.map((p, i) => (
          <div key={i} className={"flex " + (p.left?.type === "del" ? "bg-red-50" : "")}>
            <span className="w-9 text-right pr-2 text-gray-400 shrink-0 select-none tabular-nums sticky left-0 bg-inherit z-10">{p.left?.no ?? ""}</span>
            <span className="w-3 shrink-0 select-none text-red-500 text-center sticky left-9 bg-inherit z-10">{p.left?.type === "del" ? "-" : ""}</span>
            <span className={"whitespace-pre pr-3 " + (p.left?.type === "del" ? "text-red-700" : "text-gray-700")}>{p.left?.text || " "}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto min-w-0">
        {pairs.map((p, i) => (
          <div key={i} className={"flex " + (p.right?.type === "add" ? "bg-green-50" : "")}>
            <span className="w-9 text-right pr-2 text-gray-400 shrink-0 select-none tabular-nums sticky left-0 bg-inherit z-10">{p.right?.no ?? ""}</span>
            <span className="w-3 shrink-0 select-none text-green-600 text-center sticky left-9 bg-inherit z-10">{p.right?.type === "add" ? "+" : ""}</span>
            <span className={"whitespace-pre pr-3 " + (p.right?.type === "add" ? "text-green-800" : "text-gray-700")}>{p.right?.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffCard({ title, filePath, changes, loading, error }: DiffSection) {
  const lineCount = changes ? countLines(changes) : 0;
  const collapsible = lineCount > COLLAPSE_LINES;
  const [open, setOpen] = useState(!collapsible);
  const [sideBySide, setSideBySide] = useState(true);
  let adds = 0;
  let dels = 0;
  for (const c of changes || []) {
    const n = (c.value.match(/\n/g) || []).length + (c.value.endsWith("\n") ? 0 : 1);
    if (c.added) adds += n;
    else if (c.removed) dels += n;
  }
  return (
    <div className="my-1 border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-gray-100 bg-gray-50">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80">
          <span className="text-orange-500 font-mono text-[11px] shrink-0">⚙ {title}</span>
          {filePath && (
            <span className="font-mono text-[11.5px] text-gray-700 truncate">{filePath}</span>
          )}
          {!loading && !error && (
            <span className="font-mono text-[10.5px] shrink-0 ml-auto">
              <span className="text-green-600">+{adds}</span>{" "}
              <span className="text-red-500">−{dels}</span>
            </span>
          )}
          {loading && <span className="font-mono text-[10px] text-gray-400 ml-auto">loading…</span>}
          {error && <span className="font-mono text-[10px] text-red-500 ml-auto" title={error}>{error}</span>}
          <span className="text-gray-400 text-[10px] shrink-0">{open ? "▾" : "▸"}</span>
        </button>
        {open && !loading && !error && changes.length > 0 && (
          <button
            onClick={() => setSideBySide((v) => !v)}
            title={sideBySide ? "Switch to inline view" : "Switch to side-by-side view"}
            className="px-2 py-0.5 rounded border border-gray-200 text-[10px] font-medium text-gray-600 hover:border-orange-300 hover:text-orange-600 shrink-0"
          >
            {sideBySide ? "Inline" : "Side-by-side"}
          </button>
        )}
      </div>
      {open && !loading && !error && (
        <>
          {sideBySide ? <SideBySideDiffBody changes={changes} /> : <InlineDiffBody changes={changes} />}
          {collapsible && (
            <button
              onClick={() => setOpen(false)}
              className="w-full text-[10.5px] text-gray-400 py-1 hover:bg-gray-50 border-t border-gray-100 font-mono"
            >
              collapse
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function EditDiffBlock({ name, input, cwd }: Props) {
  const filePath: string | undefined = input?.file_path;

  const [diskText, setDiskText] = useState<string | null>(null);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskError, setDiskError] = useState<string | null>(null);

  useEffect(() => {
    if (name !== "Write" || !cwd || !filePath) return;
    let cancelled = false;
    setDiskLoading(true);
    setDiskError(null);
    api
      .fileRead(cwd, filePath)
      .then((r) => {
        if (!cancelled) setDiskText(r.text ?? "");
      })
      .catch((e) => {
        if (!cancelled) {
          const msg = String(e?.message || e);
          if (msg.includes("404") || /not found/i.test(msg)) {
            setDiskText("");
          } else {
            setDiskError(msg);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setDiskLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, cwd, filePath]);

  if (name === "Edit") {
    const oldS = String(input?.old_string ?? "");
    const newS = String(input?.new_string ?? "");
    const changes = diffLines(oldS, newS);
    return <DiffCard title="Edit" filePath={filePath} changes={changes} />;
  }

  if (name === "MultiEdit") {
    const edits: any[] = Array.isArray(input?.edits) ? input.edits : [];
    return (
      <div>
        <div className="text-[10.5px] font-mono text-gray-500 px-1 mt-1">
          MultiEdit — {edits.length} edit{edits.length === 1 ? "" : "s"} on {filePath}
        </div>
        {edits.map((e, i) => {
          const changes = diffLines(String(e?.old_string ?? ""), String(e?.new_string ?? ""));
          return (
            <DiffCard key={i} title={`Edit ${i + 1}/${edits.length}`} filePath={filePath} changes={changes} />
          );
        })}
      </div>
    );
  }

  if (name === "Write") {
    const content = String(input?.content ?? "");
    if (diskLoading) {
      return <DiffCard title="Write" filePath={filePath} changes={[]} loading />;
    }
    if (diskError) {
      const changes: Change[] = [{ value: content, added: true, removed: false, count: 0 } as Change];
      return <DiffCard title="Write" filePath={filePath} changes={changes} error={diskError} />;
    }
    const base = diskText ?? "";
    const changes = diffLines(base, content);
    return <DiffCard title="Write" filePath={filePath} changes={changes} />;
  }

  return (
    <pre className="text-[11px] text-gray-500 font-mono">{JSON.stringify(input, null, 2)}</pre>
  );
}
