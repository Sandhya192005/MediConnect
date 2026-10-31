"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { ScrapeJob } from "./types";

/** Polls a scrape job every 2 s until it finishes (the bell notification also arrives live). */
export function useScrapeJob(initial: ScrapeJob | null, onDone?: (job: ScrapeJob) => void) {
  const [job, setJob] = useState<ScrapeJob | null>(initial);

  // Only switch when a *different* job appears; keep the finished state of the current one.
  const initialId = initial?.id;
  useEffect(() => {
    if (initial) setJob((prev) => (prev?.id === initial.id ? prev : initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "running")) return;
    const t = setTimeout(async () => {
      try {
        const next = await api<ScrapeJob>(`/api/scraper/jobs/${job.id}/`);
        setJob(next);
        if (next.status !== "pending" && next.status !== "running") onDone?.(next);
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [job, onDone]);

  return job;
}
