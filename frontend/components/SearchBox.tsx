"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Suggestions = {
  doctors: { id: number; name: string; specialization: string; city: string }[];
  hospitals: { id: number; name: string; city: string }[];
};

/** Search input with autocomplete suggestions (Elasticsearch search_as_you_type). */
export default function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const router = useRouter();
  const [sugg, setSugg] = useState<Suggestions | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value.trim().length < 2) {
      setSugg(null);
      return;
    }
    const t = setTimeout(() => {
      api<Suggestions>(`/api/search/suggest/?q=${encodeURIComponent(value)}`)
        .then(setSugg)
        .catch(() => setSugg(null)); // search down: just no suggestions
    }, 150);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const hasSugg = sugg && (sugg.doctors.length > 0 || sugg.hospitals.length > 0);

  return (
    <div className="relative" ref={ref}>
      <input
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-label="Search doctors"
      />
      {open && hasSugg && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {sugg.doctors.map((d) => (
            <li key={`d${d.id}`}>
              <button onClick={() => router.push(`/doctors/${d.id}`)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="font-medium">Dr. {d.name}</span>
                <span className="text-slate-500"> · {d.specialization}, {d.city}</span>
              </button>
            </li>
          ))}
          {sugg.hospitals.map((h) => (
            <li key={`h${h.id}`}>
              <button
                onClick={() => {
                  onChange(h.name);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium">🏥 {h.name}</span>
                <span className="text-slate-500"> · {h.city}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
