"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import RoleGuard from "@/components/RoleGuard";
import ScrapeStatus from "@/components/ScrapeStatus";
import { api, errorMessage } from "@/lib/api";
import { timeAgo, type ScrapeJob } from "@/lib/types";
import { useScrapeJob } from "@/lib/useScrapeJob";

type Match = { id: number; name: string; city: string; source: string; is_approved: boolean; scraped_at: string | null; is_fresh: boolean; website: string };
type LookupResponse = { matches: Match[]; job: ScrapeJob | null; job_created: boolean };

function Lookup() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LookupResponse | null>(null);

  // When the background job finishes, open the hospital page.
  const onDone = useCallback((j: ScrapeJob) => {
    if (j.status === "done" && j.hospital) router.push(`/hospitals/${j.hospital}`);
  }, [router]);
  const job = useScrapeJob(result?.job ?? null, onDone);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api<LookupResponse>("/api/scraper/lookup/", { method: "POST", body: JSON.stringify({ q, url }) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link href="/hospitals" className="text-sm text-teal-700">← Hospitals near you</Link>
      <h1 className="mt-2 text-2xl font-bold">Look up any hospital</h1>
      <p className="mt-1 text-sm text-slate-600">
        We&apos;ll show what&apos;s on the hospital&apos;s <strong>own website</strong> (doctors, departments, timings, contact) so you can check it
        before you book. Saved copies younger than 24 hours appear instantly.
      </p>

      <form onSubmit={search} className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <label className="block text-sm">
          Hospital name and city
          <input className="input mt-1" placeholder="e.g. Greenfield Demo Hospital Chennai" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <p className="text-center text-xs text-slate-400">— or —</p>
        <label className="block text-sm">
          Hospital website
          <input className="input mt-1" placeholder="https://… (try http://mockhospital/ for the demo)" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" disabled={busy || (!q.trim() && !url.trim())}>{busy ? "Searching…" : "Look up"}</button>
      </form>

      {result && (
        <div className="mt-5 space-y-3">
          <ScrapeStatus job={job} />
          {result.matches.length === 0 && !job && <p className="text-sm text-slate-600">No hospitals found.</p>}
          {result.matches.map((m) => (
            <Link key={m.id} href={`/hospitals/${m.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-400">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{m.name}</span>
                {m.is_approved && m.source !== "scraped" ? (
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">MediConnect partner</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Info from its website</span>
                )}
              </div>
              <p className="text-sm text-slate-600">{m.city}</p>
              <p className="mt-1 text-xs text-slate-500">
                {m.scraped_at ? `Website info collected ${timeAgo(m.scraped_at)}${m.is_fresh ? "" : " · refreshing"}` : m.website ? "Website info not collected yet" : "No website listed"}
              </p>
            </Link>
          ))}
          {result.matches.length > 1 && <p className="text-xs text-slate-500">Several matches: open the right one, or add the city to your search.</p>}
        </div>
      )}
    </div>
  );
}

export default function LookupPage() {
  return (
    <RoleGuard role="patient">
      <Lookup />
    </RoleGuard>
  );
}
