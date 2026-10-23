import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Monitor, MoreHorizontal, Play, Plus, Settings2, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { formatDate } from "../api/format";
import { ConfirmDialog } from "../components/Dialog";
import { ProjectDialog } from "../components/ProjectDialog";
import { Button, Card, EmptyState, ErrorState, LoadingPanel, PageHeader, StatusBadge } from "../components/ui";
import type { Project } from "../types";

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deleting, setDeleting] = useState<Project | null>(null);
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const createOpen = searchParams.get("new") === "1";
  const setCreateOpen = (open: boolean) => setSearchParams(open ? { new: "1" } : {});
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      setDeleting(null);
    },
  });

  return <div>
    <PageHeader eyebrow="Authorized environments" title="Projects" description="Reusable target, selector, solver and safety configurations for developer-owned quiz QA." actions={<Button onClick={() => setCreateOpen(true)}><Plus size={15} />New project</Button>} />
    {projects.error && <div className="mb-5"><ErrorState error={projects.error} /></div>}
    <Card>
      {projects.isLoading ? <LoadingPanel rows={4} /> : projects.data?.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left">
        <thead><tr className="border-b border-slate-100 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400"><th className="px-5 py-3.5">Project</th><th className="px-4 py-3.5">Adapter</th><th className="px-4 py-3.5">Environment</th><th className="px-4 py-3.5">Last run</th><th className="px-4 py-3.5">Status</th><th className="px-5 py-3.5 text-right">Actions</th></tr></thead>
        <tbody>{projects.data.items.map((project) => <tr key={project.id} className="group border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
          <td className="px-5 py-4"><button className="text-left" onClick={() => navigate(`/projects/${project.id}/configure`)}><div className="text-[12px] font-semibold text-slate-800 group-hover:text-accent-700">{project.name}</div><div className="mt-1 text-[10px] text-slate-400">{project.question_types.length} question types · {project.safety_settings.max_questions} max questions</div></button></td>
          <td className="px-4 py-4"><span className="inline-flex items-center gap-2 text-[11px] capitalize text-slate-600">{project.adapter_type === "browser" ? <Globe2 size={15} className="text-slate-400" /> : <Monitor size={15} className="text-slate-400" />}{project.adapter_type}</span></td>
          <td className="max-w-[220px] truncate px-4 py-4 font-mono text-[10px] text-slate-500">{environmentName(project)}</td>
          <td className="px-4 py-4 text-[11px] text-slate-500">{formatDate(project.last_run_at)}</td>
          <td className="px-4 py-4">{project.last_run_status ? <StatusBadge status={project.last_run_status} /> : <span className="text-[10px] text-slate-400">Not run</span>}</td>
          <td className="px-5 py-4"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" title="Configure and run" onClick={() => navigate(`/projects/${project.id}/configure`)}><Play size={14} />Run</Button><Button size="sm" variant="ghost" title="Edit configuration" onClick={() => navigate(`/projects/${project.id}/configure`)}><Settings2 size={15} /></Button><Button size="sm" variant="ghost" title="Delete project" onClick={() => setDeleting(project)}><Trash2 size={15} className="text-red-500" /></Button></div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState icon={MoreHorizontal} title="Create your first QA project" description="The local demo is preconfigured with stable selectors and independent oracles. No hosted account or LLM key is needed." action={<Button onClick={() => setCreateOpen(true)}><Plus size={14} />Create demo project</Button>} />}
    </Card>
    <div className="mt-4 flex items-center gap-2 text-[10px] leading-5 text-slate-400"><span className="h-1 w-1 rounded-full bg-accent-500" />Deleting a project also deletes its historical runs. Active runs must be cancelled first.</div>
    <ProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    <ConfirmDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title="Delete project and history?" description={`This permanently deletes ${deleting?.name || "this project"} and its stored results. This action cannot be undone.`} confirmLabel="Delete project" dangerous loading={deleteMutation.isPending} onConfirm={() => deleting && deleteMutation.mutate(deleting.id)} />
  </div>;
}

function environmentName(project: Project): string {
  if (project.adapter_type === "desktop") return project.target_config.application_name || project.target_config.window_title || "Unconfigured desktop";
  try { return new URL(project.target_config.url || "").host; } catch { return "Invalid target URL"; }
}
