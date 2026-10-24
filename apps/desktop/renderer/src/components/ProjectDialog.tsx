import { useNavigate } from "react-router-dom";
import { windowsAutopilotProject } from "../api/client";
import type { Project } from "../types";
import { Dialog } from "./Dialog";
import { ProjectForm } from "./ProjectForm";

export function ProjectDialog({ open, preset, onSaved, onOpenChange }: { open: boolean; preset?: "desktop"; onSaved?: (project: Project) => void; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const saved = (project: Project) => {
    onOpenChange(false);
    if (onSaved) onSaved(project);
    else navigate(`/projects/${project.id}/configure`);
  };
  const desktop = preset === "desktop";
  return <Dialog open={open} onOpenChange={onOpenChange} title={desktop ? "Configure Windows Desktop Autopilot" : "Create a QA project"} description={desktop ? "Calibrate one authorized Windows app once. After you confirm the run, solving, clicking, submission and navigation continue without further prompts." : "Configure an authorized target, independent solving and explicit run safety boundaries."} wide>
    <ProjectForm template={desktop ? windowsAutopilotProject() : undefined} desktopOnly={desktop} onSaved={saved} onCancel={() => onOpenChange(false)} />
  </Dialog>;
}
