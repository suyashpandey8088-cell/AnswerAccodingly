import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, Filter, ListChecks, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { formatMs, titleCase } from "../api/format";
import { QuestionDetails } from "../components/QuestionDetails";
import { Button, Card, EmptyState, ErrorState, Input, LoadingPanel, PageHeader, Select, StatusBadge } from "../components/ui";
import type { QuestionResult } from "../types";

export function ResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs() });
  const selectedRunId = searchParams.get("run") || runs.data?.items[0]?.id || "";
  const run = useQuery({ queryKey: ["run", selectedRunId], queryFn: () => api.run(selectedRunId), enabled: Boolean(selectedRunId) });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [sort, setSort] = useState("sequence");
  const [selected, setSelected] = useState<QuestionResult | null>(null);

  const questions = useMemo(() => {
    const filtered = run.data?.question_results.filter((question) => {
      const haystack = `${question.question_identifier || ""} ${question.extraction_result?.text || ""}`.toLowerCase();
      return (!search || haystack.includes(search.toLowerCase())) &&
        (status === "all" || question.final_status === status) &&
        (type === "all" || question.question_type === type) &&
        (!failuresOnly || ["failed", "timeout", "error"].includes(question.final_status));
    }) || [];
    return [...filtered].sort((a, b) => {
      if (sort === "latency_desc") return (b.stage_timings.total_question_ms || 0) - (a.stage_timings.total_question_ms || 0);
      if (sort === "latency_asc") return (a.stage_timings.total_question_ms || Infinity) - (b.stage_timings.total_question_ms || Infinity);
      return a.sequence - b.sequence;
    });
  }, [run.data, search, status, type, failuresOnly, sort]);

  return <div>
    <PageHeader eyebrow="Question-level evidence" title="Results" description="Filter actual stored outcomes and inspect exactly why each answer passed, failed, timed out, or remained unknown." actions={<><Button variant="secondary" disabled={!selectedRunId} onClick={() => void api.download(selectedRunId, "csv")}><Download size={14} />CSV</Button><Button variant="secondary" disabled={!selectedRunId} onClick={() => void api.download(selectedRunId, "json")}><FileJson size={14} />JSON</Button></>} />
    <div className="mb-5 grid gap-3 rounded-xl border border-line bg-white p-4 shadow-panel lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.8fr_auto]">
      <Select aria-label="Select run" value={selectedRunId} onChange={(event) => setSearchParams({ run: event.target.value })}>{runs.data?.items.length ? runs.data.items.map((item) => <option key={item.id} value={item.id}>{item.project_name || "Project"} · {item.id.slice(0, 8)}</option>) : <option value="">No runs available</option>}</Select>
      <div className="relative"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><Input aria-label="Search questions" className="pl-9" placeholder="Search questions" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <Select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{["passed", "failed", "timeout", "error", "unknown", "skipped"].map((value) => <option key={value}>{value}</option>)}</Select>
      <Select aria-label="Filter by question type" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All question types</option>{["multiple_choice", "multiple_select", "math", "logical", "text", "programming", "unknown"].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</Select>
      <Button variant={failuresOnly ? "primary" : "secondary"} onClick={() => setFailuresOnly(!failuresOnly)}><Filter size={14} />Failures</Button>
    </div>
    <div className="mb-4 flex items-center justify-between gap-3"><div className="text-[10px] text-slate-400">{questions.length} of {run.data?.question_results.length || 0} questions</div><Select aria-label="Sort results" className="w-44" value={sort} onChange={(event) => setSort(event.target.value)}><option value="sequence">Question order</option><option value="latency_desc">Highest latency</option><option value="latency_asc">Lowest latency</option></Select></div>
    {run.error && <div className="mb-4"><ErrorState error={run.error} /></div>}
    <Card>{run.isLoading ? <LoadingPanel rows={6} /> : questions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-slate-100 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400"><th className="px-5 py-3">#</th><th className="px-4 py-3">Question</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Correctness</th><th className="px-4 py-3">Solver</th><th className="px-4 py-3">Total latency</th></tr></thead><tbody>{questions.map((question) => {
      const correctness = question.assertions.find((item) => item.name === "independent_correctness");
      return <tr key={question.id} onClick={() => setSelected(question)} className="cursor-pointer border-b border-slate-50 text-[11px] last:border-0 hover:bg-slate-50/70"><td className="px-5 py-4 font-mono text-slate-400">{question.sequence.toString().padStart(2, "0")}</td><td className="max-w-[320px] px-4 py-4"><div className="truncate font-semibold text-slate-700">{question.question_identifier || "Extraction failed"}</div><div className="mt-1 truncate text-[10px] font-normal text-slate-400">{question.extraction_result?.text || question.error_details || "No normalized text"}</div></td><td className="px-4 py-4 text-slate-500">{titleCase(question.question_type)}</td><td className="px-4 py-4"><StatusBadge status={question.final_status} /></td><td className="px-4 py-4">{correctness ? <StatusBadge status={correctness.status} label={correctness.status === "unknown" ? "Unverified" : correctness.status} /> : "—"}</td><td className="px-4 py-4 text-slate-500">{question.solver_method || "—"}</td><td className="px-4 py-4 font-mono text-[10px] text-slate-600">{formatMs(question.stage_timings.total_question_ms)}</td></tr>;
    })}</tbody></table></div> : <EmptyState icon={ListChecks} title={run.data?.question_results.length ? "No questions match these filters" : "No question results"} description={run.data?.question_results.length ? "Clear search or adjust the status/type filters." : "Select a completed run or start a new authorized QA session."} />}</Card>
    <QuestionDetails question={selected} open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} />
  </div>;
}
