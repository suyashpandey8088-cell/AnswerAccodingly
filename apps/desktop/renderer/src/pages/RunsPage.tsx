import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { RunTable } from "../components/RunTable";
import { Button, Card, EmptyState, ErrorState, LoadingPanel, PageHeader, Select } from "../components/ui";
import type { RunStatus } from "../types";

export function RunsPage() {
  const [status, setStatus] = useState("all");
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs(), refetchInterval: 10_000 });
  const filtered = runs.data?.items.filter((run) => status === "all" || run.status === status) || [];
  return <div>
    <PageHeader eyebrow="Execution history" title="Test runs" description="Monitor active work or inspect a completed run. Cancellation is performed by the backend, not just hidden in the UI." actions={<><Select aria-label="Filter runs by status" className="w-40" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{["running", "pending", "passed", "failed", "timeout", "error", "unknown", "cancelled"].map((value) => <option key={value} value={value}>{value}</option>)}</Select><Link to="/projects"><Button><Plus size={14} />New run</Button></Link></>} />
    {runs.error && <div className="mb-4"><ErrorState error={runs.error} /></div>}
    <Card>{runs.isLoading ? <LoadingPanel rows={6} /> : filtered.length ? <RunTable runs={filtered} /> : <EmptyState icon={Activity} title={runs.data?.items.length ? "No runs match this filter" : "No test runs yet"} description={runs.data?.items.length ? "Choose another status to see stored runs." : "Choose a project and start an authorized QA run."} action={<Link to="/projects"><Button variant="secondary">Open projects</Button></Link>} />}</Card>
    {runs.data && <div className="mt-3 text-[10px] text-slate-400">Showing {filtered.length} of {runs.data.total} stored runs</div>}
  </div>;
}
