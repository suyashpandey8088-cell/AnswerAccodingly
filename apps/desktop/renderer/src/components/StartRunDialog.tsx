import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Play, ShieldAlert, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Project } from "../types";
import { Dialog } from "./Dialog";
import { Button, Checkbox, ErrorState, LoadingPanel } from "./ui";
import { titleCase } from "../api/format";

export function StartRunDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const validation = useQuery({
    queryKey: ["environment-validation", project.id, confirmed, project.updated_at],
    queryFn: () => api.validateProject(project.id, confirmed),
    enabled: open,
    retry: false,
  });
  const start = useMutation({
    mutationFn: () => api.createRun(project.id, true),
    onSuccess: (run) => {
      onOpenChange(false);
      navigate(`/runs/${run.id}`);
    },
  });
  const changeOpen = (next: boolean) => {
    if (!next) setConfirmed(false);
    onOpenChange(next);
  };

  const desktop = project.adapter_type === "desktop";
  const live = desktop && project.target_config.capture_mode === "live";
  return <Dialog open={open} onOpenChange={changeOpen} title={desktop ? "Validate & start Windows Autopilot" : "Validate & start QA run"} description={live ? "After this confirmation there are no further prompts: live UIA/OCR analysis, solving, answer clicks, submission and navigation continue until completion or a safety stop." : desktop ? "After this confirmation there are no further prompts: calibrated OCR, solving, answer clicks, submission and navigation continue until completion or a safety stop." : "QuizPilot will visibly inspect and interact only with the configured target. No fallback target is selected."} wide>
    <div className="grid gap-6 px-6 py-6 md:grid-cols-[0.85fr_1.15fr]">
      <div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Target snapshot</div><div className="mt-2 text-sm font-semibold text-slate-800">{project.name}</div><div className="mt-1 text-[11px] capitalize text-slate-500">{project.adapter_type} adapter · {project.safety_settings.max_questions} questions max</div><div className="mt-3 break-all rounded-lg bg-white p-2.5 font-mono text-[10px] leading-4 text-slate-500">{project.target_config.url || project.target_config.application_name || project.target_config.window_title}</div></div>
        <div className="mt-4"><Checkbox label="I confirm this run and its visible actions" description={project.safety_settings.allow_submit ? `Including ${live ? "live" : "calibrated"} answer selection, submission and navigation.` : "Inspection and answer selection only; submission is disabled."} checked={confirmed} onChange={setConfirmed} /></div>
        {!project.safety_settings.operator_confirmed && <div className="mt-3 flex gap-2 text-[10px] leading-4 text-amber-700"><ShieldAlert size={15} className="shrink-0" />Project authorization is not enabled. Save it in the configuration before starting.</div>}
      </div>
      <div>
        <div className="mb-3 text-[11px] font-semibold text-slate-700">Environment checks</div>
        {validation.isLoading ? <LoadingPanel rows={5} /> : validation.error ? <ErrorState error={validation.error} /> : <div className="space-y-2">{validation.data?.checks.map((check) => <div key={check.name} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3"><span className={`mt-0.5 rounded-full p-1 ${check.passed ? "bg-emerald-50 text-emerald-600" : check.name === "submission_authorized" ? "bg-slate-50 text-slate-400" : "bg-red-50 text-red-500"}`}>{check.passed ? <Check size={11} /> : <X size={11} />}</span><div><div className="text-[11px] font-semibold text-slate-700">{titleCase(check.name)}</div><div className="mt-0.5 text-[10px] leading-4 text-slate-500">{check.detail}</div></div></div>)}</div>}
      </div>
    </div>
    {(start.error || (validation.data && !validation.data.valid && confirmed)) && <div className="px-6 pb-4">{start.error ? <ErrorState error={start.error} /> : <div className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-800">Resolve the failed checks above before starting. No target or dependency fallback will be used.</div>}</div>}
    <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4"><Button variant="secondary" onClick={() => changeOpen(false)}>Cancel</Button><Button disabled={!confirmed || !validation.data?.valid} loading={start.isPending} onClick={() => start.mutate()}><Play size={14} />{desktop ? "Start hands-free Autopilot" : "Start authorized run"}</Button></div>
  </Dialog>;
}
