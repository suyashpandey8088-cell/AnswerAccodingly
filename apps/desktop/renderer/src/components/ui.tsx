import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { AlertCircle, ArrowUpRight, Inbox, LoaderCircle, type LucideIcon } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RunStatus, TestStatus } from "../types";
import { titleCase } from "../api/format";

export function cn(...values: Parameters<typeof clsx>) { return twMerge(clsx(...values)); }

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref,
) {
  const variants = {
    primary: "bg-slate-800 text-white border-slate-800 hover:bg-slate-700 shadow-sm",
    secondary: "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-sm",
    ghost: "bg-transparent text-slate-600 border-transparent hover:bg-slate-100",
    danger: "bg-white text-red-700 border-red-200 hover:bg-red-50",
  };
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-[13px]", lg: "h-11 px-5 text-sm" };
  return <button ref={ref} className={cn("inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-not-allowed disabled:opacity-50", variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
    {loading && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}{children}
  </button>;
});

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-panel", className)} {...props} />;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div>
      {eyebrow && <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-accent-600">{eyebrow}</div>}
      <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function StatusBadge({ status, label }: { status: RunStatus | TestStatus | "ready" | "healthy"; label?: string }) {
  const styles: Record<string, string> = {
    passed: "bg-emerald-50 text-emerald-700 border-emerald-100",
    passed_dot: "bg-emerald-500",
    ready: "bg-emerald-50 text-emerald-700 border-emerald-100",
    healthy: "bg-emerald-50 text-emerald-700 border-emerald-100",
    failed: "bg-red-50 text-red-700 border-red-100",
    error: "bg-red-50 text-red-700 border-red-100",
    timeout: "bg-amber-50 text-amber-700 border-amber-100",
    running: "bg-blue-50 text-blue-700 border-blue-100",
    pending: "bg-slate-50 text-slate-600 border-slate-200",
    unknown: "bg-violet-50 text-violet-700 border-violet-100",
    skipped: "bg-slate-50 text-slate-500 border-slate-200",
    cancelled: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const dot = ["passed", "ready", "healthy"].includes(status) ? "bg-emerald-500" : ["failed", "error"].includes(status) ? "bg-red-500" : status === "timeout" ? "bg-amber-500" : status === "running" ? "bg-blue-500 animate-pulse" : status === "unknown" ? "bg-violet-400" : "bg-slate-400";
  return <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.055em]", styles[status] || styles.pending)}><span className={cn("h-1.5 w-1.5 rounded-full", dot)} />{label || titleCase(status)}</span>;
}

export function MetricCard({ label, value, detail, icon: Icon, accent }: { label: string; value: ReactNode; detail?: string; icon: LucideIcon; accent?: boolean }) {
  return <Card className="p-5">
    <div className="flex items-start justify-between">
      <div className="text-[11px] font-semibold uppercase tracking-[0.075em] text-muted">{label}</div>
      <div className={cn("rounded-lg bg-slate-50 p-2 text-slate-500", accent && "bg-accent-50 text-accent-600")}><Icon size={16} strokeWidth={1.8} /></div>
    </div>
    <div className="mt-3 text-[27px] font-semibold tracking-[-0.04em] text-ink">{value}</div>
    {detail && <div className="mt-1.5 text-[11px] text-slate-500">{detail}</div>}
  </Card>;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-[240px] flex-col items-center justify-center px-6 py-12 text-center">
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-400"><Icon size={23} strokeWidth={1.5} /></div>
    <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
    <p className="mt-2 max-w-sm text-xs leading-5 text-muted">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>;
}

export function ErrorState({ error }: { error: unknown }) {
  return <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 p-4 text-xs leading-5 text-red-700"><AlertCircle size={17} className="mt-0.5 shrink-0" /><div><strong className="mb-0.5 block font-semibold">Something needs attention</strong>{error instanceof Error ? error.message : "The request could not be completed."}</div></div>;
}

export function LoadingPanel({ rows = 3 }: { rows?: number }) {
  return <div className="animate-pulse space-y-3 p-5" aria-label="Loading"><div className="h-4 w-1/3 rounded bg-slate-100" />{Array.from({ length: rows }, (_, index) => <div key={index} className="h-12 rounded-lg bg-slate-50" />)}</div>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 disabled:bg-slate-50", className)} {...props} />;
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100", className)} {...props}>{children}</select>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={cn("block", className)}><span className="mb-1.5 block text-[11px] font-semibold text-slate-700">{label}</span>{children}{hint && <span className="mt-1.5 block text-[10px] leading-4 text-slate-500">{hint}</span>}</label>;
}

export function Checkbox({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3.5", disabled && "cursor-not-allowed opacity-60")}><input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent-600" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span><span className="block text-xs font-semibold text-slate-700">{label}</span>{description && <span className="mt-1 block text-[10px] leading-4 text-slate-500">{description}</span>}</span></label>;
}

export function SubtleLink({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-600">{children}<ArrowUpRight size={13} /></span>;
}
