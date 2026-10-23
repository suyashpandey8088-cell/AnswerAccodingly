import { useEffect, useState } from "react";

export function useElapsed(startedAt: string | undefined, active: boolean, endedAt?: string | null) {
  const calculate = () => {
    if (!startedAt) return 0;
    const end = active ? Date.now() : endedAt ? new Date(endedAt).getTime() : Date.now();
    return Math.max(0, end - new Date(startedAt).getTime());
  };
  const [elapsed, setElapsed] = useState(calculate);
  useEffect(() => {
    setElapsed(calculate());
    if (!active) return;
    const timer = window.setInterval(() => setElapsed(calculate()), 500);
    return () => window.clearInterval(timer);
  }, [startedAt, active, endedAt]);
  return elapsed;
}
