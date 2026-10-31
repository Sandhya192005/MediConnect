import type { ScrapeJob } from "@/lib/types";

/** Shows what the background scraper is doing right now. */
export default function ScrapeStatus({ job }: { job: ScrapeJob | null }) {
  if (!job) return null;
  if (job.status === "pending" || job.status === "running") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-md bg-sky-50 p-3 text-sm text-sky-800">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
        Fetching the latest info from the hospital&apos;s website… This usually takes 10–60 seconds.
      </p>
    );
  }
  if (job.status === "done") return null;
  return (
    <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
      {job.message || "We couldn't collect information from the website."}
    </p>
  );
}
