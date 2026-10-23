import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Database, Globe2, KeyRound, Monitor, RefreshCw, Server, ShieldCheck, TerminalSquare, XCircle } from "lucide-react";
import { api } from "../api/client";
import { ConfirmDialog } from "../components/Dialog";
import { Button, Card, ErrorState, LoadingPanel, PageHeader } from "../components/ui";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const status = useQuery({ queryKey: ["system-status"], queryFn: api.systemStatus });
  const appInfo = useQuery({ queryKey: ["app-info"], queryFn: api.appInfo });
  const backend = useQuery({ queryKey: ["backend-status"], queryFn: api.backendStatus, refetchInterval: 10_000 });
  const restart = async () => {
    setRestarting(true);
    try {
      await api.restartBackend();
      setRestartOpen(false);
      await queryClient.invalidateQueries();
    } finally { setRestarting(false); }
  };

  return <div>
    <PageHeader eyebrow="Local workspace" title="Settings & capability status" description="Inspect actual runtime support and security boundaries. Sensitive credentials remain in backend environment variables." actions={window.quizPilot ? <Button variant="secondary" onClick={() => setRestartOpen(true)}><RefreshCw size={14} />Restart backend</Button> : undefined} />
    {status.error && <div className="mb-5"><ErrorState error={status.error} /></div>}
    <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {status.isLoading ? <><Card><LoadingPanel /></Card><Card><LoadingPanel /></Card></> : status.data && <>
        <CapabilityCard icon={Globe2} title="Browser automation" available={status.data.browser.available} detail={status.data.browser.detail} />
        <CapabilityCard icon={Monitor} title="Desktop OCR & input" available={status.data.desktop.available} detail={status.data.desktop.detail} />
        <CapabilityCard icon={TerminalSquare} title="Coding sandbox" available={status.data.sandbox.available} detail={status.data.sandbox.detail} />
        <CapabilityCard icon={Bot} title="Optional LLM" available={status.data.llm.configured} detail={status.data.llm.detail} neutral={!status.data.llm.configured} />
      </>}
    </div>
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="p-6"><SectionTitle icon={Server} title="Local backend" /><dl className="mt-5 space-y-4"><InfoRow label="Connection" value={backend.data?.detail || "Checking"} /><InfoRow label="State" value={backend.data?.state || "Unknown"} /><InfoRow label="Loopback port" value={backend.data?.port?.toString() || "Development proxy"} /><InfoRow label="Application" value={`${appInfo.data?.name || "QuizPilot AI"} ${appInfo.data?.version || "0.1.0"}`} /><InfoRow label="Runtime" value={`${appInfo.data?.packaged ? "Packaged" : "Development"} · ${appInfo.data?.platform || "web"}`} />{status.data && <InfoRow label="Python" value={status.data.python_version} />}</dl><div className="mt-5 rounded-lg bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">The Electron main process owns backend startup, health checks, session-token generation and graceful shutdown. React cannot launch processes.</div></Card>
      <Card className="p-6"><SectionTitle icon={ShieldCheck} title="Security boundaries" /><div className="mt-5 space-y-3">{["Context isolation and sandboxed renderer", "Node integration disabled in renderer", "Fixed, validated IPC methods only", "Explicit target allowlist and DNS/IP checks", "Session-token authentication on every /api request", "No stealth, monitoring evasion or OS permission bypass"].map((item) => <div key={item} className="flex items-center gap-2.5 text-[11px] text-slate-600"><CheckCircle2 size={14} className="text-accent-500" />{item}</div>)}</div>{status.data && <div className="mt-5 rounded-lg border border-slate-100 p-3"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Target policy</div><div className="mt-2 font-mono text-[10px] text-slate-600">{status.data.target_policy.allowlisted_hosts.join(", ")}</div><div className="mt-1 text-[10px] text-slate-400">{status.data.target_policy.loopback_only ? "Loopback addresses only" : "Public global addresses with explicit allowlist"}</div></div>}</Card>
      <Card className="p-6"><SectionTitle icon={Database} title="Persistence & diagnostics" /><div className="mt-5 space-y-4"><InfoRow label="Store" value={status.data?.persistence || "SQLite"} /><InfoRow label="Crash recovery" value="Interrupted runs marked error; saved results retained" /><InfoRow label="Screenshots" value="In-memory only by default" /><InfoRow label="Diagnostic capture" value="Explicit per-project opt-in" /></div><p className="mt-5 text-[10px] leading-5 text-slate-500">Question text and normalized results are stored for QA reports. Cookies, passwords, API keys and arbitrary page content are not captured. Configured retention applies to optional diagnostic artifacts.</p></Card>
      <Card className="p-6"><SectionTitle icon={KeyRound} title="AI provider & code execution" /><div className="mt-5 space-y-4"><InfoRow label="Provider" value={status.data?.llm.provider || "OpenAI-compatible"} /><InfoRow label="Default model" value={status.data?.llm.model || "Environment default"} /><InfoRow label="Credential" value={status.data?.llm.configured ? "Configured in environment" : "Not configured"} /><InfoRow label="Demo solver" value="Deterministic · works without a key" /></div><div className="mt-5 rounded-lg bg-slate-900 p-4 font-mono text-[10px] leading-5 text-slate-300"><div>QUIZPILOT_LLM_API_KEY=your-local-secret</div><div>QUIZPILOT_SANDBOX_ENABLED=true</div></div><p className="mt-3 text-[10px] leading-5 text-slate-500">Set these in the backend launch environment, not in project JSON. Sandbox execution additionally requires Docker and a locally available runtime image.</p></Card>
    </div>
    <ConfirmDialog open={restartOpen} onOpenChange={setRestartOpen} title="Restart the local backend?" description="Active runs will be interrupted. Already persisted results are retained, and interrupted runs are marked during recovery." confirmLabel="Restart backend" dangerous loading={restarting} onConfirm={() => void restart()} />
  </div>;
}

function CapabilityCard({ icon: Icon, title, available, detail, neutral }: { icon: typeof Globe2; title: string; available: boolean; detail: string; neutral?: boolean }) {
  return <Card className="p-5"><div className="flex items-center justify-between"><div className="rounded-lg bg-slate-50 p-2 text-slate-500"><Icon size={17} /></div>{available ? <CheckCircle2 size={17} className="text-emerald-500" /> : <XCircle size={17} className={neutral ? "text-slate-300" : "text-amber-500"} />}</div><h2 className="mt-4 text-[12px] font-semibold text-slate-800">{title}</h2><div className={`mt-1 text-[10px] font-semibold ${available ? "text-emerald-600" : neutral ? "text-slate-500" : "text-amber-600"}`}>{available ? "Available" : neutral ? "Optional" : "Unavailable / disabled"}</div><p className="mt-2 text-[10px] leading-4 text-slate-400">{detail}</p></Card>;
}
function SectionTitle({ icon: Icon, title }: { icon: typeof Server; title: string }) { return <h2 className="flex items-center gap-2 text-[13px] font-semibold text-slate-800"><Icon size={16} className="text-accent-500" />{title}</h2>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 text-[11px] last:border-0"><dt className="text-slate-400">{label}</dt><dd className="max-w-[65%] text-right font-medium text-slate-700">{value}</dd></div>; }
