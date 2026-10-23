import { useNavigate } from "react-router-dom";
import type { Project } from "../types";
import { Dialog } from "./Dialog";
import { ProjectForm } from "./ProjectForm";

export function ProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const saved = (project: Project) => {
    onOpenChange(false);
    navigate(`/projects/${project.id}/configure`);
  };
  return <Dialog open={open} onOpenChange={onOpenChange} title="Create a QA project" description="Configure an authorized target, independent solving and explicit run safety boundaries." wide>
    <ProjectForm onSaved={saved} onCancel={() => onOpenChange(false)} />
  </Dialog>;
}
