import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Save, ShieldCheck } from "lucide-react";
import { api, demoProject, getConnection } from "../api/client";
import type { Project, ProjectCreate, QuestionType } from "../types";
import { Button, Checkbox, ErrorState, Field, Input, Select } from "./ui";
import { titleCase } from "../api/format";

const questionTypes: QuestionType[] = ["multiple_choice", "multiple_select", "math", "logical", "text", "programming"];
const selectorLabels: Record<string, string> = {
  question_root: "Question container", question: "Question text", options: "Answer option", timer: "Timer",
  text_answer: "Text answer", code_answer: "Code editor", submit: "Submit", next: "Next", feedback: "Feedback", complete: "Completion state",
};
const regionNames = ["question", "timer", "answer", "submit", "next", "feedback", "complete", "option_1", "option_2", "option_3", "option_4", "option_5", "option_6"];

function cloneProject(project?: Project, template?: ProjectCreate): ProjectCreate {
  if (!project) return template ? structuredClone(template) : demoProject();
  return {
    name: project.name,
    adapter_type: project.adapter_type,
    target_config: structuredClone(project.target_config),
    selector_config: { ...project.selector_config },
    timeout_settings: { ...project.timeout_settings },
    solver_settings: { ...project.solver_settings },
    safety_settings: { ...project.safety_settings },
    question_types: [...project.question_types],
  };
}

export function ProjectForm({ project, template, desktopOnly = false, onSaved, onCancel }: { project?: Project; template?: ProjectCreate; desktopOnly?: boolean; onSaved: (project: Project) => void; onCancel?: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProjectCreate>(() => cloneProject(project, template));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (project || template) return;
    void getConnection().then((connection) => {
      const base = connection.baseUrl || "http://127.0.0.1:8765";
      setForm((current) => ({ ...current, target_config: { ...current.target_config, url: `${base.replace(/\/$/, "")}/demo/?scenario=normal` } }));
    }).catch(() => undefined);
  }, [project, template]);

  const mutation = useMutation({
    mutationFn: (data: ProjectCreate) => project ? api.updateProject(project.id, data) : api.createProject(data),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project", saved.id] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      onSaved(saved);
    },
  });

  const updateTarget = <K extends keyof ProjectCreate["target_config"]>(key: K, value: ProjectCreate["target_config"][K]) => {
    setForm((current) => ({ ...current, target_config: { ...current.target_config, [key]: value } }));
  };
  const updateRegion = (name: string, key: "x" | "y" | "width" | "height", raw: string) => {
    const current = form.target_config.regions[name] || { x: 0, y: 0, width: 0, height: 0 };
    updateTarget("regions", { ...form.target_config.regions, [name]: { ...current, [key]: Number(raw) } });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!form.name.trim()) return setFormError("Enter a project name.");
    if (form.adapter_type === "browser") {
      try {
        const url = new URL(form.target_config.url || "");
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        return setFormError("Enter a valid absolute HTTP(S) target URL. The backend applies its allowlist again before a run.");
      }
    } else if (form.target_config.capture_mode === "calibrated") {
      for (const required of ["question", "answer", "submit"]) {
        const region = form.target_config.regions[required];
        if (!region || region.width <= 0 || region.height <= 0) return setFormError(`Calibrate the ${required} region with positive width and height before saving.`);
      }
    } else if (!(form.target_config.window_title || form.target_config.application_name)?.trim()) {
      return setFormError("Select or enter the authorized Windows window title.");
    }
    if (!form.question_types.length) return setFormError("Enable at least one supported question type.");
    mutation.mutate(form);
  };

  return <form onSubmit={submit} className="space-y-6 px-6 py-6">
    {(mutation.error || formError) && <ErrorState error={formError || mutation.error} />}
    <section>
      <SectionTitle number="01" title="Project & authorized target" description="Choose exactly which developer-owned environment this agent may inspect." />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Project name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Checkout quiz regression" /></Field>
        <Field label="Adapter">{desktopOnly ? <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600">Windows Desktop · Live UIA/OCR & visible input</div> : <Select value={form.adapter_type} onChange={(event) => { const adapterType = event.target.value as ProjectCreate["adapter_type"]; setForm({ ...form, adapter_type: adapterType, target_config: { ...form.target_config, capture_mode: adapterType === "desktop" ? "live" : "calibrated" } }); }}><option value="browser">Browser · Playwright</option><option value="desktop">Windows Desktop · Live UIA/OCR</option></Select>}</Field>
      </div>
      {form.adapter_type === "browser" ? <div className="mt-4 space-y-4">
        <Field label="Authorized quiz URL" hint="Loopback targets are allowed by default. Redirects and DNS results are revalidated."><Input className="font-mono text-xs" value={form.target_config.url || ""} onChange={(event) => updateTarget("url", event.target.value)} placeholder="http://127.0.0.1:8765/demo/" /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Verification oracle" hint="Expected answers are never provided to the solver."><Select value={form.target_config.oracle_profile || ""} onChange={(event) => updateTarget("oracle_profile", event.target.value || null)}><option value="demo-v1">Local demo independent oracle</option><option value="">No correctness oracle · outcomes remain unknown</option></Select></Field>
          <Field label="Demo behavior"><Select value={form.target_config.demo_scenario} onChange={(event) => {
            const scenario = event.target.value as ProjectCreate["target_config"]["demo_scenario"];
            updateTarget("demo_scenario", scenario);
            try {
              const url = new URL(form.target_config.url || "");
              if (url.pathname.startsWith("/demo")) {
                url.searchParams.set("scenario", scenario);
                updateTarget("url", url.toString());
              }
            } catch { /* URL validation is shown on save. */ }
          }}><option value="normal">Normal workflow</option><option value="delayed">Delayed UI response</option><option value="incorrect_feedback">Incorrect feedback</option><option value="missing_element">Missing element</option><option value="timeout">Feedback timeout</option></Select></Field>
        </div>
        <Checkbox label="Run browser headlessly" description="Off by default. Keep this unchecked to observe the visible Chromium QA session." checked={form.target_config.headless} onChange={(checked) => updateTarget("headless", checked)} />
      </div> : <div className="mt-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2"><Field label="Application name"><Input value={form.target_config.application_name || ""} onChange={(event) => updateTarget("application_name", event.target.value)} placeholder="My assessment fixture" /></Field><Field label="Window title"><Input value={form.target_config.window_title || ""} onChange={(event) => updateTarget("window_title", event.target.value)} placeholder="Quiz window" /></Field></div>
        {form.target_config.capture_mode === "live" ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[11px] leading-5 text-emerald-800"><strong>Zero-calibration live capture.</strong> QuizPilot detects the question, answer controls, Submit, Next and completion on every screen using Windows UI Automation with OCR fallback. No screen coordinates or regions are used.</div> : <>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[11px] leading-5 text-amber-800"><strong>Legacy calibrated project.</strong> Keep the authorized Windows target visible in a fixed position and enter measured screen regions. On Windows, QuizPilot verifies a unique window, foreground focus and region containment before every click.</div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="grid grid-cols-[1.2fr_repeat(4,0.7fr)] gap-2 bg-slate-50 px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-slate-500"><span>Region</span><span>X</span><span>Y</span><span>Width</span><span>Height</span></div>
          {regionNames.map((name) => {
            const region = form.target_config.regions[name] || { x: 0, y: 0, width: 0, height: 0 };
            return <div key={name} className="grid grid-cols-[1.2fr_repeat(4,0.7fr)] items-center gap-2 border-t border-slate-100 px-3 py-2"><span className="text-[11px] font-medium text-slate-600">{titleCase(name)}{["question", "answer", "submit"].includes(name) && <span className="text-red-500"> *</span>}</span>{(["x", "y", "width", "height"] as const).map((key) => <Input key={key} aria-label={`${name} ${key}`} type="number" min={0} className="h-8 px-2 text-[11px]" value={region[key]} onChange={(event) => updateRegion(name, key, event.target.value)} />)}</div>;
          })}
        </div>
        </>}
      </div>}
    </section>

    <section className="border-t border-slate-100 pt-6">
      <SectionTitle number="02" title="Extraction & solving" description="Select the supported inputs and the independent answer-generation policy." />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{questionTypes.map((type) => <Checkbox key={type} label={titleCase(type)} checked={form.question_types.includes(type)} onChange={(checked) => setForm({ ...form, question_types: checked ? [...form.question_types, type] : form.question_types.filter((item) => item !== type) })} />)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Solver provider"><Select value={form.solver_settings.provider} onChange={(event) => setForm({ ...form, solver_settings: { ...form.solver_settings, provider: event.target.value as "deterministic" | "llm" } })}><option value="deterministic">Deterministic first</option><option value="llm">Deterministic + optional LLM</option></Select></Field>
        <Field label="Model identifier" hint="Credentials come only from the backend environment."><Input value={form.solver_settings.model || ""} onChange={(event) => setForm({ ...form, solver_settings: { ...form.solver_settings, model: event.target.value || null } })} placeholder="Environment default" /></Field>
        <Field label="Solver deadline (seconds)"><Input type="number" min={1} max={120} value={form.solver_settings.timeout_seconds} onChange={(event) => setForm({ ...form, solver_settings: { ...form.solver_settings, timeout_seconds: Number(event.target.value) } })} /></Field>
      </div>
      <div className="mt-4"><Checkbox label="Use isolated coding sandbox" description="Generated code is never executed in the API process. If Docker isolation is unavailable, correctness stays unsupported/unknown." checked={form.solver_settings.use_sandbox} onChange={(checked) => setForm({ ...form, solver_settings: { ...form.solver_settings, use_sandbox: checked } })} /></div>
      {form.adapter_type === "browser" && <details className="group mt-4 rounded-xl border border-slate-200 bg-slate-50/50">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-semibold text-slate-700"><span>Stable test selectors</span><ChevronDown size={15} className="transition group-open:rotate-180" /></summary>
        <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-2">{Object.entries(form.selector_config).map(([key, value]) => <Field key={key} label={selectorLabels[key] || titleCase(key)}><Input className="font-mono text-[11px]" value={value} onChange={(event) => setForm({ ...form, selector_config: { ...form.selector_config, [key]: event.target.value } })} /></Field>)}</div>
      </details>}
    </section>

    <section className="border-t border-slate-100 pt-6">
      <SectionTitle number="03" title="Timeouts & run safety" description="Bound the run and require explicit authority for visible actions." />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Operation (ms)"><Input type="number" min={250} value={form.timeout_settings.operation_ms} onChange={(event) => setForm({ ...form, timeout_settings: { ...form.timeout_settings, operation_ms: Number(event.target.value) } })} /></Field>
        <Field label="Feedback (ms)"><Input type="number" min={250} value={form.timeout_settings.feedback_ms} onChange={(event) => setForm({ ...form, timeout_settings: { ...form.timeout_settings, feedback_ms: Number(event.target.value) } })} /></Field>
        <Field label="Max questions"><Input type="number" min={1} max={100} value={form.safety_settings.max_questions} onChange={(event) => setForm({ ...form, safety_settings: { ...form.safety_settings, max_questions: Number(event.target.value) } })} /></Field>
        <Field label="Failure threshold"><Input type="number" min={1} max={100} value={form.safety_settings.failure_threshold} onChange={(event) => setForm({ ...form, safety_settings: { ...form.safety_settings, failure_threshold: Number(event.target.value) } })} /></Field>
        <Field label="Hard run deadline (seconds)"><Input type="number" min={5} max={7200} value={form.timeout_settings.run_seconds} onChange={(event) => setForm({ ...form, timeout_settings: { ...form.timeout_settings, run_seconds: Number(event.target.value) } })} /></Field>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><Checkbox label="Allow answer submission" description="If disabled, the agent can inspect/select but does not submit or navigate by submission." checked={form.safety_settings.allow_submit} onChange={(checked) => setForm({ ...form, safety_settings: { ...form.safety_settings, allow_submit: checked } })} /><Checkbox label="I am authorized to test this target" description="Required again immediately before every run. Never use this against a third-party assessment without permission." checked={form.safety_settings.operator_confirmed} onChange={(checked) => setForm({ ...form, safety_settings: { ...form.safety_settings, operator_confirmed: checked } })} /></div>
    </section>

    <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-6 py-4 backdrop-blur"><div className="hidden items-center gap-2 text-[10px] text-slate-400 sm:flex"><ShieldCheck size={13} className="text-accent-500" /> Configuration snapshot stored with every run</div><div className="flex gap-2">{onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}<Button type="submit" loading={mutation.isPending}><Save size={14} />{project ? "Save configuration" : "Create project"}</Button></div></div>
  </form>;
}

function SectionTitle({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="flex gap-3"><span className="mt-0.5 font-mono text-[10px] font-semibold text-accent-500">{number}</span><div><h2 className="text-sm font-semibold tracking-[-0.015em] text-slate-800">{title}</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">{description}</p></div></div>;
}
