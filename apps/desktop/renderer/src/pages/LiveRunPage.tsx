import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, BarChart3, CheckCircle2, Clock3, ListChecks, LoaderCircle, Square, Timer, Zap } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { formatElapsed, formatMs, shortId, stageLabel, titleCase } from "../api/format";
import { useElapsed } from "../hooks/useElapsed";
import { useRunEvents } from "../hooks/useRunEvents";
import { ConfirmDialog } from "../components/Dialog";
import { Button, Card, EmptyState, ErrorState, LoadingPanel, PageHeader, StatusBadge } from "../components/ui";

const stages = ["extracting", "solving", "selecting", "submitting", "verifying", "navigating"];

export function LiveRunPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const run = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.run(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 1500 : false;
    },
  });
  const { latest, error: streamError } = useRunEvents(id);
  const active = run.data?.status === "running" || run.data?.status === "pending";
  const elapsed = useElapsed(run.data?.started_at, active, run.data?.ended_at);
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(id),
    onSuccess: () => {
      setCancelOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["run", id] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  if (run.isLoading) return <Card><LoadingPanel rows={6} /></Card>;
  if (run.error || !run.data) return <ErrorState error={run.error || new Error("Run not found")} />;
  const data = run.data;
  const results = data.question_results;
  const lastResult = results.at(-1);
  const currentStage = active ? latest?.data.stage || "starting" : "complete";
  const currentQuestion = latest?.data.question_text || lastResult?.extraction_result?.text || "Waiting for the first visible question";
  const timer = latest?.data.timer || lastResult?.timer_data;
  const maxQuestions = data.config_snapshot.project?.safety_settings.max_questions || results.length || 1;
  const progress = Math.min(100, (results.length / maxQuestions) * 100);
  const currentSequence = latest?.data.sequence || Math.min(results.length + (active ? 1 : 0), maxQuestions);

  return <div>
    <Link to="/runs" className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-accent-600"><ArrowLeft size={13} />All test runs</Link>
    <PageHeader eyebrow={active ? "Live execution" : "Stored execution"} title={data.project_name || "Quiz QA run"} description={<span className="font-mono text-[11px]">Run {shortId(data.id)} · Started {new Date(data.started_at).toLocaleString()}</span>} actions={<><StatusBadge status={data.status} />{active && <Button variant="danger" onClick={() => setCancelOpen(true)}><Square size={13} />Cancel run</Button>}{!active && <Link to={`/reports?run=${data.id}`}><Button variant="secondary"><BarChart3 size={14} />Open report</Button></Link>}</>} />
    {(run.error || cancel.error || data.error_summary) && <div className="mb-4"><ErrorState error={cancel.error || data.error_summary} /></div>}

    <Card className="relative mb-6 overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${active ? "bg-accent-500" : data.status === "passed" ? "bg-emerald-500" : data.status === "unknown" ? "bg-violet-400" : "bg-red-400"}`} />
      <div className="grid gap-6 p-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-accent-600">{active ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}{active ? stageLabel(currentStage) : "Execution finished"}</div>
          <h2 className="mt-3 max-w-2xl text-[18px] font-medium leading-7 tracking-[-0.02em] text-slate-800">{currentQuestion}</h2>
          <div className="mt-3 text-[10px] text-slate-400">Question {currentSequence} of up to {maxQuestions} {latest?.data.question_id && <span className="ml-2 font-mono">{latest.data.question_id}</span>}</div>
          <div className="mt-6"><div className="mb-2 flex justify-between text-[10px] text-slate-500"><span>{results.length} question results persisted</span><span>{Math.round(progress)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-accent-500 transition-[width]" style={{ width: `${progress}%` }} /></div></div>
        </div>
        <div className="grid grid-cols-3 gap-3 xl:border-l xl:border-slate-100 xl:pl-6">
          <LiveMetric icon={Clock3} label="Elapsed" value={formatElapsed(elapsed)} />
          <LiveMetric icon={Timer} label="Visible timer" value={timer?.seconds !== null && timer?.seconds !== undefined ? `${Math.ceil(timer.seconds)}s` : "Unknown"} detail={timer ? `${titleCase(timer.status)}${timer.confidence !== null && timer.confidence !== undefined ? ` · ${Math.round(timer.confidence * 100)}%` : ""}` : "Not detected"} />
          <LiveMetric icon={Activity} label="Current stage" value={active ? titleCase(currentStage) : titleCase(data.status)} />
        </div>
      </div>
      <div className="border-t border-slate-100 px-6 py-5">
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">{stages.map((stage, index) => {
          const currentIndex = stages.indexOf(currentStage);
          const completed = !active || currentIndex > index;
          const current = active && currentIndex === index;
          return <div key={stage} className="flex min-w-[100px] flex-1 items-center"><div className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-semibold ${completed ? "border-accent-500 bg-accent-500 text-white" : current ? "border-accent-500 bg-accent-50 text-accent-700" : "border-slate-200 bg-white text-slate-400"}`}>{completed ? "✓" : index + 1}</span><span className={`whitespace-nowrap text-[9px] font-medium ${current ? "text-accent-700" : completed ? "text-slate-600" : "text-slate-400"}`}>{titleCase(stage)}</span></div>{index < stages.length - 1 && <div className={`mx-2 h-px min-w-3 flex-1 ${completed ? "bg-accent-300" : "bg-slate-200"}`} />}</div>;
        })}</div>
      </div>
    </Card>

    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <TimingCard label="Extraction" value={lastResult?.stage_timings.extraction_ms} />
      <TimingCard label="Solver" value={lastResult?.stage_timings.solver_ms} />
      <TimingCard label="Selection" value={lastResult?.stage_timings.selection_ms} />
      <TimingCard label="UI response" value={lastResult?.stage_timings.ui_response_ms} />
      <TimingCard label="Total question" value={lastResult?.stage_timings.total_question_ms} accent />
    </div>
    {streamError && <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-[10px] text-amber-700">Live stream: {streamError}. Authoritative polling continues while the run is active.</div>}

    <Card>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4"><ListChecks size={16} className="text-slate-400" /><div><h2 className="text-[12px] font-semibold text-slate-800">Question evidence</h2><p className="mt-0.5 text-[10px] text-slate-400">Results appear only after the backend persists them</p></div></div>
      {results.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead><tr className="border-b border-slate-50 text-[9px] uppercase tracking-wide text-slate-400"><th className="px-5 py-3">#</th><th className="px-4 py-3">Question</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Solver</th><th className="px-4 py-3">Correctness</th><th className="px-4 py-3">Latency</th></tr></thead><tbody>{results.map((question) => {
        const correctness = question.assertions.find((item) => item.name === "independent_correctness");
        return <tr key={question.id} className="border-b border-slate-50 text-[11px] last:border-0"><td className="px-5 py-3.5 font-mono text-slate-400">{question.sequence.toString().padStart(2, "0")}</td><td className="max-w-[300px] truncate px-4 py-3.5 font-medium text-slate-700">{question.question_identifier || question.extraction_result?.text || "Extraction failed"}</td><td className="px-4 py-3.5"><StatusBadge status={question.final_status} /></td><td className="px-4 py-3.5 text-slate-500">{question.solver_method || "—"}</td><td className="px-4 py-3.5">{correctness ? <StatusBadge status={correctness.status} label={correctness.status === "unknown" ? "Unverified" : correctness.status} /> : "—"}</td><td className="px-4 py-3.5 text-slate-500">{formatMs(question.stage_timings.total_question_ms)}</td></tr>;
      })}</tbody></table></div> : <EmptyState icon={Zap} title={active ? "Waiting for the first result" : "No question results"} description="Extraction, solver and verification evidence will appear here after incremental persistence." />}
    </Card>
    <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel this backend run?" description="Cancellation interrupts the managed task, closes the browser or desktop adapter, and retains all previously persisted question results." confirmLabel="Cancel run" dangerous loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
  </div>;
}

function LiveMetric({ icon: Icon, label, value, detail }: { icon: typeof Clock3; label: string; value: string; detail?: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><Icon size={14} className="mb-2 text-slate-400" /><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 truncate text-[12px] font-semibold text-slate-700" title={value}>{value}</div>{detail && <div className="mt-1 truncate text-[9px] text-slate-400">{detail}</div>}</div>;
}
function TimingCard({ label, value, accent }: { label: string; value?: number | null; accent?: boolean }) {
  return <Card className="p-4"><div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-2 text-lg font-semibold tracking-[-0.03em] ${accent ? "text-accent-700" : "text-slate-700"}`}>{formatMs(value)}</div></Card>;
}
