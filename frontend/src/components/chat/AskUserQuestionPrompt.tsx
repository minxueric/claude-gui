import { useState } from "react";
import { AskUserQuestionRequest } from "../../hooks/useChatStream";

interface Props {
  req: AskUserQuestionRequest;
  onAnswer: (answers: Record<string, string>) => void;
}

export default function AskUserQuestionPrompt({ req, onAnswer }: Props) {
  // Selected label(s) per question. Single-select: string; multi-select: comma-joined.
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});

  const toggle = (qIdx: number, label: string, multi: boolean) => {
    setSelections((s) => {
      const cur = new Set(s[qIdx] || []);
      if (multi) {
        if (cur.has(label)) cur.delete(label);
        else cur.add(label);
      } else {
        cur.clear();
        cur.add(label);
      }
      return { ...s, [qIdx]: cur };
    });
  };

  const submit = () => {
    const answers: Record<string, string> = {};
    req.questions.forEach((q, i) => {
      const sel = selections[i];
      const o = otherText[i]?.trim();
      let val = "";
      if (sel && sel.size > 0) {
        val = [...sel].join(", ");
      }
      if (o) {
        val = val ? `${val}; Other: ${o}` : `Other: ${o}`;
      }
      answers[q.question] = val || "(no selection)";
    });
    onAnswer(answers);
  };

  const allAnswered = req.questions.every((_q, i) => {
    const sel = selections[i];
    return (sel && sel.size > 0) || (otherText[i]?.trim());
  });

  return (
    <li>
      <div className="mt-1 mb-1 rounded-lg border border-orange-300 bg-orange-50/40 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border-b border-orange-200">
          <span className="text-[10px] font-semibold text-orange-600 uppercase tracking-wider">
            Claude is asking
          </span>
          <span className="text-[11px] text-gray-500">
            {req.questions.length} question{req.questions.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="px-3 py-2 space-y-3">
          {req.questions.map((q, qIdx) => {
            const multi = !!q.multiSelect;
            return (
              <div key={qIdx} className="bg-white border border-gray-200 rounded-md p-3">
                {q.header && (
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    {q.header}
                  </div>
                )}
                <div className="text-[13px] text-gray-900 font-medium mb-2.5 leading-snug">
                  {q.question}
                </div>
                <div className="space-y-1.5">
                  {q.options.map((o, oIdx) => {
                    const checked = selections[qIdx]?.has(o.label) ?? false;
                    return (
                      <button
                        key={oIdx}
                        type="button"
                        onClick={() => toggle(qIdx, o.label, multi)}
                        className={
                          "w-full text-left px-3 py-2 rounded-md border transition-colors flex items-start gap-2.5 " +
                          (checked
                            ? "border-orange-400 bg-orange-50"
                            : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50")
                        }
                      >
                        <span
                          className={
                            "mt-0.5 shrink-0 w-4 h-4 inline-flex items-center justify-center " +
                            (multi ? "rounded-sm" : "rounded-full") +
                            " " +
                            (checked
                              ? "bg-orange-500 text-white"
                              : "border border-gray-300 bg-white")
                          }
                        >
                          {checked && (
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6.5l2.5 2.5L10 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={"text-[12.5px] font-medium " + (checked ? "text-orange-700" : "text-gray-900")}>
                            {o.label}
                          </div>
                          {o.description && (
                            <div className="text-[11.5px] text-gray-500 mt-0.5 leading-snug">
                              {o.description}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <input
                  value={otherText[qIdx] || ""}
                  onChange={(e) => setOtherText((s) => ({ ...s, [qIdx]: e.target.value }))}
                  placeholder="Other (free text, optional)…"
                  className="mt-2 w-full bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 text-[12px] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors"
                />
              </div>
            );
          })}
        </div>

        <div className="px-3 pb-3 flex justify-end">
          <button
            disabled={!allAnswered}
            onClick={submit}
            className="px-3.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5"
          >
            Send answer →
          </button>
        </div>
      </div>
    </li>
  );
}
