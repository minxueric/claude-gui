interface Props {
  mode: string;
  onCycle: () => void;
}

const LABEL: Record<string, string> = {
  default: "default",
  acceptEdits: "accept edits",
  bypassPermissions: "bypass",
  plan: "plan",
};

const COLOR: Record<string, string> = {
  default: "text-ink2 border-rule2",
  acceptEdits: "text-clayDeep border-clay/60 bg-clayWash/40",
  bypassPermissions: "text-rust border-rust/60 bg-rust/10",
  plan: "text-amber2 border-amber2/60 bg-amber2/10",
};

export default function ModeBadge({ mode, onCycle }: Props) {
  const label = LABEL[mode] || mode;
  const cls = COLOR[mode] || COLOR.default;
  return (
    <button
      onClick={onCycle}
      title="Shift+Tab to cycle permission mode"
      className={`px-2.5 py-0.5 rounded-sm border font-mono text-[10.5px] uppercase tracking-wide transition-colors ${cls}`}
    >
      {label}
    </button>
  );
}
