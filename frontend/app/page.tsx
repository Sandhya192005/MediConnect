import Image from "next/image";
import Link from "next/link";
import HomeSearch from "@/components/HomeSearch";
import Icon from "@/components/Icons";

const SPECIALTIES = [
  { name: "Cardiology", q: "heart", icon: "heart" },
  { name: "Dermatology", q: "skin", icon: "skin" },
  { name: "Orthopedics", q: "bone", icon: "bone" },
  { name: "Pediatrics", q: "child", icon: "baby" },
  { name: "Neurology", q: "brain", icon: "brain" },
  { name: "ENT", q: "ear", icon: "ear" },
  { name: "General Medicine", q: "general physician", icon: "stethoscope" },
  { name: "Gynecology", q: "gynecology", icon: "user" },
];

const STEPS = [
  { icon: "search", title: "Search", text: "Type a hospital, a doctor, or just what hurts: “heart”, “skin”, “kids”. Typos are fine." },
  { icon: "hospital", title: "Choose a hospital", text: "See MediConnect hospitals with their specialists, or any hospital on the map." },
  { icon: "calendar", title: "Book a slot", text: "Pick a free time and get confirmation by email and a live notification." },
];

const FEATURES = [
  { icon: "map", title: "Every hospital on the map", text: "Partners for instant booking, and every other hospital nearby to check before you go." },
  { icon: "globe", title: "Info from their websites", text: "Doctors and timings read from each hospital’s own website, always with the source." },
  { icon: "bell", title: "Reminders that arrive", text: "Email and live alerts 24 hours and 1 hour before your visit." },
  { icon: "chat", title: "AI assistant", text: "Ask in your own words; it finds doctors and free slots. You confirm every booking." },
];

export default function Home() {
  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white px-6 py-12 shadow-sm sm:px-10 lg:py-16">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-teal-100/60 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-navy-100/60 blur-3xl" />
        <div className="relative grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">
              <Icon name="pin" className="h-3.5 w-3.5" /> Chennai · Tamil Nadu
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-navy-800 sm:text-5xl">
              Your health, <span className="text-brand-gradient">one click away</span>
            </h1>
            <p className="mt-4 max-w-lg text-lg text-slate-600">
              Find the right specialist at a hospital near you and book an appointment without waiting on the phone.
            </p>
            <div className="mt-6 max-w-xl">
              <HomeSearch />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="text-slate-500">Popular:</span>
              {["heart", "skin doctor", "kids", "Apollo"].map((q) => (
                <Link key={q} href={`/doctors?q=${encodeURIComponent(q)}`} className="chip">{q}</Link>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-solid px-5 py-3">
                Get started <Icon name="arrow" className="h-4 w-4" />
              </Link>
              <Link href="/hospitals" className="btn-outline px-5 py-3">
                <Icon name="map" className="h-4 w-4" /> Hospitals near me
              </Link>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md">
            <div className="bg-brand-gradient absolute inset-6 rounded-[2rem] opacity-15 blur-2xl" />
            <div className="relative rounded-[2rem] border border-slate-100 bg-white p-6 shadow-xl shadow-navy-900/10">
              <Image src="/logo.png" alt="MediConnect – Connect · Consult · Care" width={806} height={500} priority className="h-auto w-full mix-blend-multiply" />
            </div>
            <div className="absolute -bottom-6 left-4 hidden items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-lg sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><Icon name="check" className="h-4 w-4" /></span>
              <span className="text-sm"><span className="block font-semibold text-navy-800">Instant booking</span><span className="text-xs text-slate-500">at partner hospitals</span></span>
            </div>
            <div className="absolute -right-3 -top-6 hidden items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-lg sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-50 text-navy-700"><Icon name="bell" className="h-4 w-4" /></span>
              <span className="text-sm"><span className="block font-semibold text-navy-800">Live reminders</span><span className="text-xs text-slate-500">email + in-app</span></span>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-navy-800 sm:text-3xl">How it works</h2>
          <p className="mt-2 text-slate-600">From “I need a doctor” to a booked visit in three steps.</p>
        </div>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card relative p-6">
              <span className="absolute right-5 top-5 text-4xl font-extrabold text-slate-100">{i + 1}</span>
              <span className="bg-brand-gradient flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-md shadow-teal-700/20">
                <Icon name={s.icon} />
              </span>
              <h3 className="mt-4 font-semibold text-navy-800">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Specialties */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-2xl font-bold text-navy-800 sm:text-3xl">Find a specialist</h2>
            <p className="mt-2 text-slate-600">Pick a specialty to see the hospitals that have one.</p>
          </div>
          <Link href="/doctors" className="text-sm font-semibold text-teal-700 hover:underline">All hospitals and doctors →</Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SPECIALTIES.map((s) => (
            <Link key={s.name} href={`/doctors?q=${encodeURIComponent(s.q)}`} className="card-hover group flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 transition group-hover:bg-teal-600 group-hover:text-white">
                <Icon name={s.icon} />
              </span>
              <span className="font-medium text-slate-800">{s.name}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-700"><Icon name={f.icon} /></span>
            <h3 className="mt-3 font-semibold text-navy-800">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{f.text}</p>
          </div>
        ))}
      </section>

      {/* Call to action */}
      <section className="bg-brand-gradient relative overflow-hidden rounded-3xl px-6 py-12 text-center text-white sm:px-12">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-white/10" />
        <h2 className="relative text-2xl font-bold sm:text-3xl">Ready when you are</h2>
        <p className="relative mx-auto mt-2 max-w-xl text-teal-50">
          Create a free account to book, get reminders and keep all your visits in one place. Doctors can join too.
        </p>
        <div className="relative mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="btn bg-white px-5 py-3 text-teal-800 hover:bg-teal-50">Create an account</Link>
          <Link href="/doctors" className="btn border border-white/50 px-5 py-3 text-white hover:bg-white/10">Find hospitals or doctors</Link>
        </div>
      </section>
    </div>
  );
}
