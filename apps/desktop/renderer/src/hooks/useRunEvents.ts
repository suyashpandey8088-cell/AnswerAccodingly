import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { streamRunEvents } from "../api/client";
import type { LiveRunEvent } from "../types";

export function useRunEvents(runId: string | undefined) {
  const queryClient = useQueryClient();
  const [latest, setLatest] = useState<LiveRunEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    setLatest(null);
    setError(null);
    void streamRunEvents(runId, (event) => {
      setLatest(event);
      if (event.event === "question.result") {
        void queryClient.invalidateQueries({ queryKey: ["run", runId] });
        void queryClient.invalidateQueries({ queryKey: ["report", runId] });
        void queryClient.invalidateQueries({ queryKey: ["overview"] });
      }
      if (["run.completed", "run.cancelled", "run.failed"].includes(event.event)) {
        void queryClient.invalidateQueries({ queryKey: ["run", runId] });
        void queryClient.invalidateQueries({ queryKey: ["runs"] });
        void queryClient.invalidateQueries({ queryKey: ["report", runId] });
        void queryClient.invalidateQueries({ queryKey: ["overview"] });
      }
    }, controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Live event stream disconnected");
    });
    return () => controller.abort();
  }, [runId, queryClient]);

  return { latest, error };
}
