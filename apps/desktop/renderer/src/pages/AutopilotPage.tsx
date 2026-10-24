import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppWindow, Bot, CheckCircle2, Monitor, MousePointer2, Play, RefreshCw, ScanSearch, ShieldCheck, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, windowsAutopilotProject } from "../api/client";
import { Button, Card, Checkbox, ErrorState, LoadingPanel, PageHeader } from "../components/ui";
import type { EnvironmentValidation } from "../types";

export function AutopilotPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [validation, setValidation] = useState<EnvironmentValidation | null>(null);
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const status = useQuery({ queryKey: ["system-status"], queryFn: api.systemStatus });
  const windows = useQuery({ queryKey: ["live-windows"], queryFn: api.visibleWindows, retry: false });

  const visibleWindows = useMemo(
    () => (windows.data?.items ?? []).filter((item) => item.title !== "QuizPilot AI"),
    [windows.data],
  );
  const duplicateTitles = useMemo(() => {
    const counts = new Map<string, number>();
    visibleWindows.forEach((item) => counts.set(item.title, (counts.get(item.title) ?? 0) + 1));
    return new Set([...counts].filter(([, count]) => count > 1).map(([title]) => title));
  }, [visibleWindows]);
  const selectedWindow = visibleWindows.find((item) => item.title === selectedTitle && !duplicateTitles.has(item.title));

  useEffect(() => {
    if (selectedTitle && !selectedWindow && !windows.isLoading) setSelectedTitle(null);
  }, [selectedTitle, selectedWindow, windows.isLoading]);
  useEffect(() => {
    setConfirmed(false);
    setValidation(null);
  }, [selectedTitle]);

  const start = useMutation({
    mutationFn: async () => {
      if (!selectedWindow || !confirmed) throw new Error("Select an authorized window and confirm this run first.");
      setValidation(null);
      const existing = projects.data?.items.find((project) =>
        project.adapter_type === "desktop"
        && project.target_config.capture_mode === "live"
        && project.target_config.window_title === selectedWindow.title,
      );
      const payload = windowsAutopilotProject(selectedWindow.title);
      const project = existing
        ? await api.updateProject(existing.id, payload)
        : await api.createProject(payload);
      const preflight = await api.validateProject(project.id, true);
      setValidation(preflight);
      if (!preflight.valid) throw new Error("Preflight stopped the run. Resolve the failed checks below; no input was sent.");
      return api.createRun(project.id, true);
    },
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${run.id}`);
    },
  });

  const runtime = windows.data?.runtime ?? status.data?.live_desktop;
  return <div>
    <PageHeader
      eyebrow="Windows · zero calibration"
      title="Live Desktop Autopilot"
      description="Select an authorized visible app. QuizPilot analyzes each live question, solves it, selects and submits the answer, and navigates until completion or a safety stop."
      actions={<Button variant="secondary" onClick={() => void windows.refetch()} loading={windows.isRefetching}><RefreshCw size={14} />Refresh windows</Button>}
    />

    <Card className="overflow-hidden border-slate-800 bg-slate-900 text-white">
      <div className="grid gap-8 p-7 lg:grid-cols-[1.15fr_0.85fr] lg:p-9">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-300"><ScanSearch size={14} className="text-accent-300" />UI Automation + OCR fallback</div>
          <h2 className="mt-5 max-w-xl text-2xl font-semibold tracking-[-0.035em]">No coordinates. No calibration. Live analysis on every question.</h2>
          <p className="mt-3 max-w-xl text-[12px] leading-6 text-slate-400">The interface is re-read before interaction. QuizPilot refuses stale questions, ambiguous options, missing controls, focus loss and out-of-window clicks. Generated answers, app feedback and independent correctness remain separate.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <Step number="01" icon={AppWindow} title="Choose the window" detail="Only visible, uniquely titled Windows apps are eligible." />
          <Step number="02" icon={ShieldCheck} title="Confirm once" detail="Authorize visible answering, submission and navigation for this run." />
          <Step number="03" icon={MousePointer2} title="Watch or cancel" detail="Evidence persists after every question; safety limits remain active." />
        </div>
      </div>
    </Card>

    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <Capability title="Live Windows runtime" ok={runtime?.available} loading={status.isLoading && windows.isLoading} detail={runtime?.detail || "Checking UIA, OCR and window support"} />
      <Capability title="AI answer provider" ok={status.data?.llm.configured} loading={status.isLoading} neutral detail={status.data?.llm.configured ? `${status.data.llm.model} · configured locally in the backend environment` : "Required for arbitrary questions. Set QUIZPILOT_LLM_API_KEY locally; never paste it into project data."} />
    </div>
    {(projects.error || status.error || windows.error) && <div className="mt-4"><ErrorState error={projects.error || status.error || windows.error} /></div>}

    <div className="mt-6 grid items-start gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <div className="border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2"><Monitor size={16} className="text-accent-500" /><h2 className="text-[13px] font-semibold text-slate-800">1. Select the authorized window</h2></div><p className="mt-1 text-[10px] leading-4 text-slate-400">Keep the quiz question visible. Minimized, duplicate-title and very small windows are not eligible.</p></div>
        {windows.isLoading ? <LoadingPanel rows={4} /> : visibleWindows.length ? <div className="max-h-[390px] space-y-2 overflow-y-auto p-4">{visibleWindows.map((item, index) => {
          const duplicate = duplicateTitles.has(item.title);
          const selected = selectedTitle === item.title && !duplicate;
          return <button key={`${item.title}-${index}`} type="button" disabled={duplicate} aria-pressed={selected} onClick={() => setSelectedTitle(item.title)} className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition ${selected ? "border-accent-500 bg-accent-50 ring-2 ring-accent-100" : "border-slate-200 bg-white hover:border-slate-300"} disabled:cursor-not-allowed disabled:opacity-55`}>
            <span className={`rounded-lg p-2 ${selected ? "bg-white text-accent-600" : "bg-slate-50 text-slate-400"}`}><AppWindow size={18} /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-slate-800">{item.title}</span><span className="mt-1 block text-[10px] text-slate-400">{duplicate ? "Duplicate title · close or rename one window" : `${item.bounds.width} × ${item.bounds.height} · visible window`}</span></span>
            <span className={`h-4 w-4 rounded-full border-4 ${selected ? "border-accent-500 bg-white" : "border-slate-200 bg-white"}`} />
          </button>;
        })}</div> : <div className="px-6 py-10 text-center"><AppWindow size={28} className="mx-auto text-slate-300" /><h3 className="mt-3 text-[13px] font-semibold text-slate-700">No eligible visible Windows windows</h3><p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-slate-400">On Windows, open your owned/authorized quiz app, restore its window and select Refresh windows. Live capture cannot be verified from a non-Windows backend.</p></div>}
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2"><Bot size={17} className="text-accent-500" /><h2 className="text-[13px] font-semibold text-slate-800">2. Confirm and start</h2></div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Authorized target</div><div className="mt-2 break-words text-[12px] font-semibold text-slate-800">{selectedWindow?.title || "No window selected"}</div><div className="mt-2 text-[10px] leading-4 text-slate-500">Live capture · up to 25 questions · 15 minute hard deadline · 3 failure stop</div></div>
        <div className="mt-4"><Checkbox label="I am authorized and confirm this run" description="I own this application or have explicit permission to automate it. QuizPilot may visibly select answers, submit and navigate." checked={confirmed} onChange={setConfirmed} disabled={!selectedWindow || start.isPending} /></div>
        {!runtime?.available && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">Start is unavailable until the backend runs on Windows with the pinned live-capture dependencies.</div>}
        {start.error && <div className="mt-4"><ErrorState error={start.error} /></div>}
        {validation && !validation.valid && <div className="mt-4 space-y-2">{validation.checks.filter((check) => !check.passed && check.name !== "submission_authorized").map((check) => <div key={check.name} className="rounded-lg border border-red-100 bg-red-50 p-3 text-[10px] leading-4 text-red-700"><strong className="block capitalize">{check.name.replaceAll("_", " ")}</strong>{check.detail}</div>)}</div>}
        <Button className="mt-5 w-full" size="lg" disabled={!selectedWindow || !confirmed || !runtime?.available || projects.isLoading} loading={start.isPending} onClick={() => start.mutate()}><Play size={15} />{start.isPending ? "Validating & starting…" : "Start live Autopilot"}</Button>
        <p className="mt-3 text-center text-[10px] leading-4 text-slate-400">One confirmation. No further prompts unless the run stops for safety.</p>
      </Card>
    </div>

    <div className="mt-5 text-[10px] leading-5 text-slate-400">For owned or explicitly authorized practice and QA applications only. AI answers can be wrong. No proctoring/exam-rule or OS-protection bypass is included. Real native UIA/OCR behavior must be verified on your Windows target.</div>
  </div>;
}

function Step({ number, icon: Icon, title, detail }: { number: string; icon: typeof Monitor; title: string; detail: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="flex items-center justify-between"><Icon size={16} className="text-accent-300" /><span className="font-mono text-[9px] text-slate-500">{number}</span></div><div className="mt-3 text-[11px] font-semibold text-slate-100">{title}</div><p className="mt-1 text-[10px] leading-4 text-slate-400">{detail}</p></div>;
}

function Capability({ title, ok, detail, loading, neutral = false }: { title: string; ok?: boolean; detail: string; loading: boolean; neutral?: boolean }) {
  return <Card className="flex items-start gap-3 p-4"><span className={`mt-0.5 ${ok ? "text-emerald-500" : neutral ? "text-slate-400" : "text-amber-500"}`}>{loading ? <span className="block h-4 w-4 animate-pulse rounded-full bg-slate-200" /> : ok ? <CheckCircle2 size={17} /> : <XCircle size={17} />}</span><div><div className="text-[11px] font-semibold text-slate-700">{title}</div><p className="mt-1 text-[10px] leading-4 text-slate-400">{loading ? "Checking local capability" : detail}</p></div></Card>;
}
