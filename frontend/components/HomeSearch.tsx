"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "./Icons";

/** The big search box on the home page: sends you to "Find hospitals or doctors" with your words. */
export default function HomeSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/doctors?q=${encodeURIComponent(q.trim())}` : "/doctors");
      }}
      className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg shadow-navy-900/5"
      role="search"
    >
      <Icon name="search" className="ml-2 h-5 w-5 shrink-0 text-slate-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Hospital, doctor or specialty, e.g. “heart”"
        aria-label="Search hospitals or doctors"
        className="min-w-0 flex-1 bg-transparent px-1 py-2 text-slate-900 outline-none placeholder:text-slate-400"
      />
      <button className="btn-solid shrink-0">Search</button>
    </form>
  );
}
