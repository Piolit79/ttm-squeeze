import type { ScanResult } from "../lib/api";

const DOT_CLASS: Record<string, string> = {
  orange: "bg-orange-500",
  red:    "bg-red-500",
  black:  "bg-slate-500",
  green:  "bg-green-500",
};

const MOM_CLASS: Record<string, string> = {
  cyan:   "text-cyan-400",
  blue:   "text-blue-400",
  yellow: "text-yellow-400",
  red_m:  "text-red-400",
};

function DotBadge({ dot }: { dot: string }) {
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${DOT_CLASS[dot] ?? "bg-slate-600"}`} />
  );
}

function MomCell({ state }: { state: { momentum: number; momentum_color: string; momentum_positive: boolean } }) {
  const color = MOM_CLASS[state.momentum_color] ?? "text-slate-400";
  return (
    <span className={`font-mono text-xs ${color}`}>
      {state.momentum > 0 ? "+" : ""}{state.momentum?.toFixed(2)}
    </span>
  );
}

interface Props {
  results: ScanResult[];
  onSelect: (ticker: string) => void;
  selected: string;
}

export default function ScanTable({ results, onSelect, selected }: Props) {
  const sorted = [...results].sort((a, b) => {
    if (a.signal_active !== b.signal_active) return a.signal_active ? -1 : 1;
    if (a.setting_up   !== b.setting_up)   return a.setting_up   ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 uppercase tracking-wider border-b border-slate-800">
            <th className="py-2 px-3 text-left">Ticker</th>
            <th className="py-2 px-3 text-left">Status</th>
            <th className="py-2 px-3 text-center">1H Dot</th>
            <th className="py-2 px-3 text-right">1H Mom</th>
            <th className="py-2 px-3 text-center">D Dot</th>
            <th className="py-2 px-3 text-right">D Mom</th>
            <th className="py-2 px-3 text-right">Entry</th>
            <th className="py-2 px-3 text-right">Stop</th>
            <th className="py-2 px-3 text-right">Target</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr
              key={r.ticker}
              onClick={() => onSelect(r.ticker)}
              className={`border-b border-slate-800/50 cursor-pointer transition-colors hover:bg-slate-800/40
                ${selected === r.ticker ? "bg-slate-800/60" : ""}
              `}
            >
              <td className="py-2.5 px-3 font-semibold text-white">{r.ticker}</td>
              <td className="py-2.5 px-3">
                {r.signal_active ? (
                  <span className="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded">
                    SIGNAL
                  </span>
                ) : r.setting_up ? (
                  <span className="text-xs font-semibold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
                    SETUP
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </td>
              <td className="py-2.5 px-3 text-center">
                <DotBadge dot={r.state_1h?.squeeze_dot ?? "green"} />
              </td>
              <td className="py-2.5 px-3 text-right">
                {r.state_1h && <MomCell state={r.state_1h as any} />}
              </td>
              <td className="py-2.5 px-3 text-center">
                <DotBadge dot={r.state_1d?.squeeze_dot ?? "green"} />
              </td>
              <td className="py-2.5 px-3 text-right">
                {r.state_1d && <MomCell state={r.state_1d as any} />}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-300">
                {r.latest_signal ? `$${r.latest_signal.entry.toFixed(2)}` : "—"}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-xs text-red-400">
                {r.latest_signal ? `$${r.latest_signal.stop.toFixed(2)}` : "—"}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-xs text-green-400">
                {r.latest_signal ? `$${r.latest_signal.target.toFixed(2)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
