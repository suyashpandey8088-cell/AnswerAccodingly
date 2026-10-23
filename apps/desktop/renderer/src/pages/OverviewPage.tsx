import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, CheckCircle2, Clock3, FolderKanban, Gauge, Plus, ShieldCheck, TimerOff, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { formatMs, formatPercent, titleCase } from "../api/format";
import { RunTable } from "../components/RunTable";
import { Button, Card, EmptyState, ErrorState, LoadingPanel, MetricCard, PageHeader, StatusBadge } from "../components/ui";

export function OverviewPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  if (overview.isLoading) return <div><PageHeader title="Overview" /><LoadingPanel rows={6} /></div>;
  if (overview.error || !overview.data) return <ErrorState error={overview.error} />;
  const data = overview.data;
  const trendData = data.performance_trends.map((item) => ({ ...item, pass_percent: item.pass_rate === null ? null : item.pass_rate * 100 }));

  return <div>
    <PageHeader eyebrow="QA command center" title="Quality signals, not guesswork." description="Observe extraction, interaction and independently verified outcomes across your authorized test environments." actions={<Link to="/projects?new=1"><Button><Plus size={15} />New QA project</Button></Link>} />

    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Projects" value={data.total_projects} detail={`${data.total_runs} stored ${data.total_runs === 1 ? "run" : "runs"}`} icon={FolderKanban} />
      <MetricCard label="Verified correctness" value={formatPercent(data.verified_correctness_rate)} detail="Only independent oracle-backed answers" icon={ShieldCheck} accent />
      <MetricCard label="P95 question latency" value={formatMs(data.p95_latency_ms)} detail={data.average_latency_ms !== null ? `${formatMs(data.average_latency_ms)} average` : "No measured runs"} icon={Gauge} />
      <MetricCard label="Timeout rate" value={formatPercent(data.timeout_rate)} detail={`${data.failed_questions} failed/error questions`} icon={TimerOff} />
    </div>

    {data.total_projects === 0 ? <Card className="mb-6 overflow-hidden">
      <div className="grid md:grid-cols-[1.1fr_0.9fr]">
        <div className="p-8"><div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent-50 px-3 py-1.5 text-[10px] font-semibold text-accent-700"><CheckCircle2 size={13} />Local demo ready · no API key required</div><h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-900">Run your first visible QA session</h2><p className="mt-3 max-w-lg text-xs leading-6 text-slate-500">Create the preconfigured local project, validate Chromium, then watch QuizPilot extract, solve, select, submit and verify six question types.</p><Link to="/projects?new=1" className="mt-6 inline-block"><Button>Create demo project<ArrowRight size={14} /></Button></Link></div>
        <div className="border-l border-slate-100 bg-slate-50/60 p-8"><div className="mb-4 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">The evidence pipeline</div>{["Inspect & normalize", "Solve independently", "Interact & observe", "Verify & report"].map((step, index) => <div key={step} className="flex items-center gap-3 border-b border-slate-200/70 py-3 last:border-0"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white font-mono text-[9px] font-semibold text-accent-600 shadow-sm">0{index + 1}</span><span className="text-[11px] font-medium text-slate-600">{step}</span></div>)}</div>
      </div>
    </Card> : <div className="mb-6 grid gap-6 xl:grid-cols-[1.45fr_0.75fr]">
      <Card>
        <PanelHeader title="Performance trend" description="Pass rate across recent completed runs" icon={TrendingUp} />
        {trendData.length ? <div className="h-[245px] px-3 pb-3"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}><defs><linearGradient id="passFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#728154" stopOpacity={0.24} /><stop offset="100%" stopColor="#728154" stopOpacity={0.015} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0f2" /><XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9199a6" }} tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#9199a6" }} tickLine={false} axisLine={false} unit="%" /><Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e8ed", fontSize: 11 }} formatter={(value) => [`${value ?? "—"}%`, "Pass rate"]} /><Area type="monotone" dataKey="pass_percent" stroke="#728154" strokeWidth={2} fill="url(#passFill)" connectNulls={false} /></AreaChart></ResponsiveContainer></div> : <EmptyState icon={Activity} title="No trend data yet" description="Complete a run with defined pass criteria to build this chart." />}
      </Card>
      <Card>
        <PanelHeader title="Recent failures" description="Latest persisted failure categories" icon={TimerOff} />
        {data.recent_failures.length ? <div className="px-5 pb-3">{data.recent_failures.map((failure) => <Link to={`/results?run=${failure.run_id}`} key={`${failure.run_id}-${failure.sequence}`} className="flex items-start gap-3 border-b border-slate-100 py-3 last:border-0 hover:bg-slate-50"><StatusBadge status={failure.status} /><div className="min-w-0"><div className="truncate text-[11px] font-semibold text-slate-700">{failure.question_id || `Question ${failure.sequence}`}</div><div className="mt-1 text-[10px] text-slate-400">{titleCase(failure.failure_category)} · {failure.project_name}</div></div></Link>)}</div> : <EmptyState icon={CheckCircle2} title="No recorded failures" description={data.total_runs ? "No failed, error or timeout questions are stored." : "Failure diagnostics will appear after a run."} />}
      </Card>
    </div>}

    <Card>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><PanelHeader title="Recent test runs" description="Actual stored runs, including unknown outcomes" icon={Clock3} /><Link to="/runs" className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-600">View all<ArrowRight size={13} /></Link></div>
      <RunTable runs={data.recent_runs} compact />
    </Card>
  </div>;
}

function PanelHeader({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Activity }) {
  return <div className="flex items-center gap-3 px-5 py-4"><div className="rounded-lg bg-slate-50 p-2 text-slate-500"><Icon size={15} /></div><div><h2 className="text-[12px] font-semibold text-slate-800">{title}</h2><p className="mt-0.5 text-[10px] text-slate-400">{description}</p></div></div>;
}
