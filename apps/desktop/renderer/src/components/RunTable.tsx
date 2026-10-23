import { ArrowUpRight, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import type { TestRun } from "../types";
import { formatDate, formatMs, shortId } from "../api/format";
import { EmptyState, StatusBadge } from "./ui";

export function RunTable({ runs, compact = false }: { runs: TestRun[]; compact?: boolean }) {
  if (!runs.length) return <EmptyState title="No test runs yet" description="Start an authorized run to see real progress, assertions and latency here." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left">
    <thead><tr className="border-b border-slate-100 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400"><th className="px-5 py-3">Run</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Questions</th><th className="px-4 py-3">Median latency</th><th className="px-4 py-3">Started</th><th className="w-10" /></tr></thead>
    <tbody>{runs.map((run) => <tr key={run.id} className="border-b border-slate-50 text-[11px] last:border-0 hover:bg-slate-50/60">
      <td className="px-5 py-3.5"><Link to={`/runs/${run.id}`} className="font-mono font-semibold text-slate-700 hover:text-accent-600">{shortId(run.id)}</Link></td>
      <td className="max-w-[220px] truncate px-4 py-3.5 text-slate-600">{run.project_name || "Deleted project"}</td>
      <td className="px-4 py-3.5"><StatusBadge status={run.status} /></td>
      <td className="px-4 py-3.5 text-slate-600">{run.summary_metrics.total_questions ?? 0}<span className="text-slate-400">{run.summary_metrics.passed_questions !== undefined ? ` · ${run.summary_metrics.passed_questions} passed` : ""}</span></td>
      <td className="px-4 py-3.5 text-slate-600"><span className="inline-flex items-center gap-1.5"><Clock3 size={12} className="text-slate-400" />{formatMs(run.summary_metrics.median_total_latency_ms)}</span></td>
      <td className="px-4 py-3.5 text-slate-500">{formatDate(run.started_at)}</td>
      <td className="pr-4"><Link to={`/runs/${run.id}`} aria-label={`Open run ${run.id}`} className="text-slate-400 hover:text-accent-600"><ArrowUpRight size={15} /></Link></td>
    </tr>)}</tbody>
  </table>{!compact && <div className="border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400">Select a run to inspect question-level evidence.</div>}</div>;
}
