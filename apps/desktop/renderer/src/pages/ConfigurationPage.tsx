import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Play, Save } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { ProjectForm } from "../components/ProjectForm";
import { StartRunDialog } from "../components/StartRunDialog";
import { Button, Card, ErrorState, LoadingPanel, PageHeader } from "../components/ui";

export function ConfigurationPage() {
  const { id = "" } = useParams();
  const [startOpen, setStartOpen] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.project(id), enabled: Boolean(id) });

  if (project.isLoading) return <Card><LoadingPanel rows={6} /></Card>;
  if (project.error || !project.data) return <ErrorState error={project.error || new Error("Project not found")} />;
  return <div>
    <Link to="/projects" className="mb-4 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-accent-600"><ArrowLeft size={13} />Back to projects</Link>
    <PageHeader eyebrow="Test configuration" title={project.data.name} description="Changes apply to future runs. Every run retains its own immutable configuration snapshot." actions={<Button onClick={() => setStartOpen(true)}><Play size={14} />Validate & start run</Button>} />
    {savedMessage && <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-[11px] text-emerald-700"><Save size={14} />Configuration saved locally.</div>}
    <Card className="overflow-hidden"><ProjectForm project={project.data} onSaved={() => { setSavedMessage(true); window.setTimeout(() => setSavedMessage(false), 3000); }} /></Card>
    <StartRunDialog project={project.data} open={startOpen} onOpenChange={setStartOpen} />
  </div>;
}
