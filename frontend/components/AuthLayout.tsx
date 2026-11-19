import Image from "next/image";
import Link from "next/link";
import { HospitalIllustration } from "./HospitalThumb";
import Icon from "./Icons";

const POINTS = [
  { icon: "calendar", text: "Book appointments" },
  { icon: "hospital", text: "Hospitals near you" },
  { icon: "folder", text: "Access medical records" },
  { icon: "shield", text: "Trusted & secure" },
];

/**
 * Full-screen login / sign-up frame (reference design):
 * a soft teal brand panel on large screens and the form card on the right.
 */
export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="app-shell grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#e3f4f2] via-[#eef8f7] to-[#d5eeeb] px-12 py-12 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-teal-200/30 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/60 blur-2xl" />

        <Link href="/" className="relative flex items-center gap-3" aria-label="MediConnect home">
          <Image src="/logo-mark-clear.png" alt="" width={56} height={56} priority />
          <span>
            <span className="block text-3xl font-bold tracking-tight text-[#0b4f55]">MediConnect</span>
            <span className="block text-sm text-slate-600">Connect · Consult · Care</span>
          </span>
        </Link>

        <div className="relative my-auto max-w-lg py-10">
          <p className="text-4xl font-bold leading-tight tracking-tight text-[#0f2f3a] xl:text-5xl">
            Smart healthcare for a healthier tomorrow
          </p>
          <p className="mt-5 text-lg text-slate-600">
            Book appointments, find the right specialist near you, and stay connected with your healthcare team, all in one place.
          </p>
          {/* Drawn, not a photo (owner's choice); hidden on short screens so the panel never needs scrolling. */}
          <HospitalIllustration className="mt-8 w-full max-w-[460px] [@media(max-height:800px)]:hidden" />
          <ul className="mt-8 grid grid-cols-4 gap-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex flex-col gap-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-teal-600 shadow-sm">
                  <Icon name={p.icon} className="h-6 w-6" />
                </span>
                <span className="text-sm text-slate-700">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">
          In an emergency, call <a href="tel:112" className="font-[650] text-red-600">112</a> or an ambulance on{" "}
          <a href="tel:108" className="font-[650] text-red-600">108</a>. Don&apos;t wait for an online booking.
        </p>
      </aside>

      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* Logo for phones, where the brand panel is hidden */}
          <Link href="/" className="mb-6 flex items-center justify-center gap-2 lg:hidden" aria-label="MediConnect home">
            <Image src="/logo-mark-clear.png" alt="" width={40} height={40} priority />
            <span className="text-2xl font-bold tracking-tight text-[#0b4f55]">MediConnect</span>
          </Link>
          <div className="dash-card p-6 sm:p-8">
            <h1 className="text-2xl text-[#0f2f3a]">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Text input with an icon on the left, as in the reference design. The label is kept for screen readers. */
export function IconInput({
  icon,
  label,
  trailing,
  ...props
}: { icon: string; label: string; trailing?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <label className="block">
        <span className="sr-only">{label}</span>
        <Icon name={icon} className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
        <input {...props} className={`input rounded-xl py-3 pl-11 ${trailing ? "pr-11" : ""}`} />
      </label>
      {/* Outside the <label>, so a button here doesn't become part of the input's name. */}
      {trailing && <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>}
    </div>
  );
}
