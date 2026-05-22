interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_cost_usd: number;
}

export default function UsageBadge({ totals }: { totals: UsageTotals }) {
  const fresh = totals.input_tokens + totals.output_tokens;
  const cache = totals.cache_creation_input_tokens + totals.cache_read_input_tokens;
  return (
    <span
      className="font-mono text-[10.5px] text-ink2 inline-flex items-baseline gap-2"
      title={
        `input ${totals.input_tokens.toLocaleString()}\n` +
        `output ${totals.output_tokens.toLocaleString()}\n` +
        `cache write ${totals.cache_creation_input_tokens.toLocaleString()}\n` +
        `cache read ${totals.cache_read_input_tokens.toLocaleString()}\n` +
        `cost $${totals.total_cost_usd.toFixed(6)}`
      }
    >
      <span>{fresh.toLocaleString()} tok</span>
      {cache > 0 && <span className="text-muted">+ {cache.toLocaleString()} cache</span>}
      {totals.total_cost_usd > 0 && (
        <span className="text-clay">${totals.total_cost_usd.toFixed(4)}</span>
      )}
    </span>
  );
}
