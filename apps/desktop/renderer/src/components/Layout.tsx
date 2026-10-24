import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, Bot, FlaskConical, FolderKanban, LayoutDashboard, ListChecks, ScanSearch, Settings, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { cn } from "./ui";

const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/autopilot", label: "Desktop Autopilot", icon: Bot },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/runs", label: "Test runs", icon: Activity },
  { to: "/results", label: "Results", icon: ListChecks },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];
const pageNames: Record<string, string> = { "/": "Overview", "/autopilot": "Desktop Autopilot", "/projects": "Projects", "/runs": "Test runs", "/results": "Results", "/reports": "Reports", "/settings": "Settings" };

export function Layout() {
  const location = useLocation();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000, retry: false });
  const backend = useQuery({ queryKey: ["backend-status"], queryFn: api.backendStatus, refetchInterval: 10_000 });
  const basePath = `/${location.pathname.split("/")[1]}`;
  const pageName = location.pathname.includes("/configure") ? "Test configuration" : location.pathname.match(/^\/runs\/[^/]+/) ? "Live run" : pageNames[basePath] || "QuizPilot AI";

  return <div className="min-h-screen bg-canvas text-ink">
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[232px] flex-col border-r border-slate-200/80 bg-white max-lg:w-[72px]">
      <div className="flex h-[72px] items-center gap-3 border-b border-slate-100 px-5 max-lg:justify-center max-lg:px-0">
        <div className="relative rounded-[10px] bg-slate-800 p-2 text-white shadow-sm"><ScanSearch size={21} strokeWidth={1.8} /><span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-accent-500" /></div>
        <div className="max-lg:hidden"><div className="text-[15px] font-bold tracking-[-0.035em]">QuizPilot <span className="text-accent-600">AI</span></div><div className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.18em] text-slate-400">Quality autopilot</div></div>
      </div>
      <div className="flex-1 px-3 py-6 max-lg:px-2">
        <div className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 max-lg:hidden">Workspace</div>
        <nav className="space-y-1" aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} title={label} className={({ isActive }) => cn("group flex h-10 items-center gap-3 rounded-lg px-3 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 max-lg:justify-center max-lg:px-0", isActive && "bg-accent-50 font-semibold text-accent-700 hover:bg-accent-50 hover:text-accent-700")}>
            {({ isActive }) => <><Icon size={17} strokeWidth={isActive ? 2 : 1.7} /><span className="max-lg:hidden">{label}</span>{isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-500 max-lg:hidden" />}</>}
          </NavLink>)}
        </nav>
        <div className="mb-3 mt-8 px-3 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 max-lg:hidden">System</div>
        <NavLink to="/settings" title="Settings" className={({ isActive }) => cn("flex h-10 items-center gap-3 rounded-lg px-3 text-[12px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 max-lg:justify-center max-lg:px-0", isActive && "bg-accent-50 font-semibold text-accent-700")}><Settings size={17} strokeWidth={1.7} /><span className="max-lg:hidden">Settings</span></NavLink>
      </div>
      <div className="p-3 max-lg:p-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 max-lg:flex max-lg:justify-center max-lg:border-0 max-lg:bg-transparent">
          <div className="flex items-center gap-2">{health.isSuccess && health.data.status === "ok" ? <Wifi size={14} className="text-emerald-600" /> : <WifiOff size={14} className="text-red-500" />}<span className="text-[10px] font-semibold text-slate-700 max-lg:hidden">Backend {health.isSuccess ? "connected" : "unavailable"}</span></div>
          <div className="mt-1.5 text-[9px] leading-4 text-slate-400 max-lg:hidden">{backend.data?.detail || "Checking local service"}<br />Local only · v0.1.0</div>
        </div>
        <div className="mt-3 flex items-center gap-2 px-2 text-[9px] text-slate-400 max-lg:hidden"><ShieldCheck size={12} className="text-accent-500" /> Authorized testing only</div>
      </div>
    </aside>

    <div className="ml-[232px] min-h-screen max-lg:ml-[72px]">
      <header className="sticky top-0 z-20 flex h-[58px] items-center justify-between border-b border-slate-200/70 bg-canvas/90 px-7 backdrop-blur-md">
        <div className="flex items-center gap-2 text-[11px]"><span className="text-slate-400">Workspace</span><span className="text-slate-300">/</span><span className="font-semibold text-slate-700">{pageName}</span></div>
        <div className="flex items-center gap-4"><div className="flex items-center gap-2 text-[10px] font-medium text-slate-500"><span className={cn("h-1.5 w-1.5 rounded-full", health.isSuccess ? "bg-emerald-500" : "bg-red-500")} />{health.isSuccess ? "All systems local" : "Backend needs attention"}</div><div className="h-4 w-px bg-slate-200" /><div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"><FlaskConical size={13} className="text-accent-500" /> QA workspace</div></div>
      </header>
      <main className="mx-auto max-w-[1540px] p-7 max-xl:p-5"><Outlet /></main>
    </div>
  </div>;
}
