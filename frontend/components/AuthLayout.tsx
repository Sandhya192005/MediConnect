import Image from "next/image";
import Icon from "./Icons";

const POINTS = [
  { icon: "search", text: "Find specialists at hospitals near you" },
  { icon: "calendar", text: "Book a free slot in seconds" },
  { icon: "bell", text: "Get reminders by email and live alerts" },
];

/** Login / sign-up page frame: brand panel (large screens) + the form card. */
export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xl shadow-navy-900/5 lg:grid-cols-2">
      <aside className="bg-brand-gradient relative hidden flex-col justify-between p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10" />
        <div className="relative">
          <p className="text-sm font-semibold uppercase tracking-widest text-teal-50/80">MediConnect</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight">Connect · Consult · Care</h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15"><Icon name={p.icon} className="h-4 w-4" /></span>
                <span className="text-teal-50">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-teal-50/80">In an emergency, call 112 or 108. Don&apos;t wait for an online booking.</p>
      </aside>

      <div className="p-6 sm:p-10">
        <Image src="/logo-mark-clear.png" alt="MediConnect" width={64} height={64} priority />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-navy-800">{title}</h1>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
