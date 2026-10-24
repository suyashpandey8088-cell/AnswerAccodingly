import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, Hand, Monitor, MousePointer2, Play, Plus, Settings2, ShieldCheck, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { ProjectDialog } from "../components/ProjectDialog";
import { StartRunDialog } from "../components/StartRunDialog";
import { Button, Card, ErrorState, LoadingPanel, PageHeader, StatusBadge } from "../components/ui";
import type { Project } from "../types";

export function AutopilotPage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [startProject, setStartProject] = useState<Project | null>(null);
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const status = useQuery({ queryKey: ["system-status"], queryFn: api.systemStatus });
  const desktopProjects = projects.data?.items.filter((project) => project.adapter_type === "desktop") ?? [];

  return <div>
    <PageHeader eyebrow="Windows · authorized desktop apps" title="Desktop Autopilot" description="A one-time calibrated Windows workflow that reads, solves, clicks, submits and navigates automatically after you confirm the run." actions={<Button onClick={() => setCreateOpen(true)}><Plus size={15} />New Autopilot</Button>} />

    <Card className="overflow-hidden border-slate-800 bg-slate-900 text-white">
      <div className="grid gap-8 p-7 lg:grid-cols-[1.15fr_0.85fr] lg:p-9">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-300"><Bot size={14} className="text-accent-300" />Hands-free after Start</div>
          <h2 className="mt-5 max-w-xl text-2xl font-semibold tracking-[-0.035em]">One authorized window. One confirmation. Then automatic quiz execution.</h2>
          <p className="mt-3 max-w-xl text-[12px] leading-6 text-slate-400">QuizPilot focuses only the configured Windows app, reads calibrated regions with OCR, maps the solver answer to the actual option, and continues until completion or a safety stop. It never guesses an option position or clicks outside the authorized window.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <Step number="01" icon={Monitor} title="Calibrate once" detail="Name a unique window and measure its question, answer and control regions." />
          <Step number="02" icon={ShieldCheck} title="Confirm the run" detail="Validate Windows, OCR and provider capabilities before visible input begins." />
          <Step number="03" icon={MousePointer2} title="Let it finish" detail="No further prompts. Cancel remains available and failures stop the run." />
        </div>
      </div>
    </Card>

    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <Capability title="Windows desktop runtime" ok={status.data?.desktop.available} loading={status.isLoading} detail={status.data?.desktop.detail || "Checking OCR, input and window support"} />
      <Capability title="AI answer provider" ok={status.data?.llm.configured} loading={status.isLoading} neutral detail={status.data?.llm.configured ? `${status.data.llm.model} · configured in the backend environment` : "Required for arbitrary questions. Set QUIZPILOT_LLM_API_KEY locally; deterministic fixtures can still run without it."} />
    </div>
    {status.data && status.data.desktop.platform !== "win32" && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-800">Real Windows window targeting requires running this backend on Windows. This environment can edit configurations and run mocked tests, but cannot verify a native Windows desktop.</div>}
    {(projects.error || status.error) && <div className="mt-4"><ErrorState error={projects.error || status.error} /></div>}

    <Card className="mt-6">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-[13px] font-semibold text-slate-800">Your Windows Autopilots</h2><p className="mt-1 text-[10px] text-slate-400">Saved target, calibration, provider and safety configurations.</p></div><Hand size={17} className="text-slate-300" /></div>
      {projects.isLoading ? <LoadingPanel rows={3} /> : desktopProjects.length ? <div className="divide-y divide-slate-100">{desktopProjects.map((project) => <div key={project.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-slate-800">{project.name}</div><div className="mt-1 truncate font-mono text-[10px] text-slate-400">{project.target_config.window_title || project.target_config.application_name}</div></div>
        <div className="text-[10px] text-slate-400">{project.safety_settings.max_questions} questions max</div>
        {project.last_run_status ? <StatusBadge status={project.last_run_status} /> : <span className="text-[10px] text-slate-400">Not run</span>}
        <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => navigate(`/projects/${project.id}/configure`)}><Settings2 size={14} />Configure</Button><Button size="sm" variant="secondary" onClick={() => setStartProject(project)}><Play size={13} />Start</Button></div>
      </div>)}</div> : <div className="px-6 py-10 text-center"><Bot size={26} className="mx-auto text-slate-300" /><h3 className="mt-3 text-[13px] font-semibold text-slate-700">No Windows Autopilot yet</h3><p className="mx-auto mt-2 max-w-md text-[11px] leading-5 text-slate-400">Create a desktop-only configuration. Arbitrary questions use your locally configured OpenAI-compatible provider; no credentials are stored in project JSON.</p><Button className="mt-5" onClick={() => setCreateOpen(true)}><Plus size={14} />Configure first Autopilot</Button></div>}
    </Card>

    <div className="mt-4 text-[10px] leading-5 text-slate-400">For authorized practice and owned applications only. AI answers can be wrong; reports distinguish generated answers, UI feedback and independent correctness. No proctoring or OS-protection bypass is included.</div>

    <ProjectDialog open={createOpen} preset="desktop" onOpenChange={setCreateOpen} onSaved={setStartProject} />
    {startProject && <StartRunDialog project={startProject} open={Boolean(startProject)} onOpenChange={(open) => { if (!open) setStartProject(null); }} />}
  </div>;
}

function Step({ number, icon: Icon, title, detail }: { number: string; icon: typeof Monitor; title: string; detail: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="flex items-center justify-between"><Icon size={16} className="text-accent-300" /><span className="font-mono text-[9px] text-slate-500">{number}</span></div><div className="mt-3 text-[11px] font-semibold text-slate-100">{title}</div><p className="mt-1 text-[10px] leading-4 text-slate-400">{detail}</p></div>;
}

function Capability({ title, ok, detail, loading, neutral = false }: { title: string; ok?: boolean; detail: string; loading: boolean; neutral?: boolean }) {
  return <Card className="flex items-start gap-3 p-4"><span className={`mt-0.5 ${ok ? "text-emerald-500" : neutral ? "text-slate-400" : "text-amber-500"}`}>{loading ? <span className="block h-4 w-4 animate-pulse rounded-full bg-slate-200" /> : ok ? <CheckCircle2 size={17} /> : <XCircle size={17} />}</span><div><div className="text-[11px] font-semibold text-slate-700">{title}</div><p className="mt-1 text-[10px] leading-4 text-slate-400">{loading ? "Checking local capability" : detail}</p></div></Card>;
}
