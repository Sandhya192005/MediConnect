import Link from "next/link";

const features = [
  { title: "Find doctors", text: "Search by name, specialization or hospital." },
  { title: "Hospitals near you", text: "See nearby hospitals on a map." },
  { title: "Book in seconds", text: "Pick a free slot and get instant confirmation." },
  { title: "AI assistant", text: "Ask our chatbot to help you find and book." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-700 px-6 py-16 text-center text-white">
        <h1 className="text-4xl font-bold sm:text-5xl">Your health, one click away</h1>
        <p className="mx-auto mt-4 max-w-xl text-teal-50">
          MediConnect helps you find the right doctor at a hospital near you and book an
          appointment without waiting on the phone.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="rounded-md bg-white px-5 py-2.5 font-medium text-teal-700">
            Get started
          </Link>
          <Link href="/login" className="rounded-md border border-white/60 px-5 py-2.5 font-medium">
            Log in
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-teal-700">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{f.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
