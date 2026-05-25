import { PlanExitRequest } from "../../hooks/useChatStream";
import MarkdownBlock from "../blocks/MarkdownBlock";

interface Props {
  req: PlanExitRequest;
  onDecide: (d: "approve_auto" | "approve_keep" | "keep_planning") => void;
}

const PRE_PLAN_LABEL: Record<string, string> = {
  default: "Default (ask each tool)",
  acceptEdits: "Accept edits",
  bypassPermissions: "Bypass",
  plan: "Plan",
};

export default function PlanExitPrompt({ req, onDecide }: Props) {
  const restoreTarget = req.prePlanMode === "default" || req.prePlanMode === "plan"
    ? "acceptEdits"
    : req.prePlanMode;
  return (
    <li>
      <div className="mt-1 mb-1 rounded-lg border border-amber-300 bg-amber-50/40 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200">
          <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
            Plan ready for approval
          </span>
          <span className="text-[11px] text-gray-500">Review and choose how to continue</span>
        </div>

        <div className="px-3 py-2 max-h-[420px] overflow-y-auto bg-white">
          <MarkdownBlock text={req.plan || "*(empty plan)*"} />
        </div>

        <div className="px-3 py-2 bg-amber-50/50 border-t border-amber-200 flex flex-wrap justify-end gap-1.5">
          <button
            onClick={() => onDecide("keep_planning")}
            className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-white text-[12px] font-medium transition-colors"
            title="Tell Claude to refine the plan; stay in plan mode"
          >
            Keep planning
          </button>
          <button
            onClick={() => onDecide("approve_keep")}
            className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-white text-[12px] font-medium transition-colors"
            title={`Approve and restore previous mode: ${PRE_PLAN_LABEL[req.prePlanMode] || req.prePlanMode}`}
          >
            Approve · stay {req.prePlanMode === "default" ? "default" : PRE_PLAN_LABEL[req.prePlanMode] || req.prePlanMode}
          </button>
          <button
            onClick={() => onDecide("approve_auto")}
            className="px-3.5 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5"
            title={`Approve and switch to ${restoreTarget} so Claude can execute file edits automatically`}
          >
            Approve · auto-edit →
          </button>
        </div>
      </div>
    </li>
  );
}
