import Image from "next/image";
import Link from "next/link";

const features = [
  { title: "Find hospitals or doctors", text: "Search by hospital, specialty or doctor, even with typos." },
  { title: "Hospitals near you", text: "See nearby hospitals on a map." },
  { title: "Book in seconds", text: "Pick a free slot and get instant confirmation." },
  { title: "AI assistant", text: "Ask our chatbot to help you find and book." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
        <Image
          src="/logo.png"
          alt="MediConnect – Connect · Consult · Care"
          width={806}
          height={500}
          priority
          className="mx-auto h-auto w-full max-w-md mix-blend-multiply"
        />
        <h1 className="mt-6 text-3xl font-bold text-[#0f3b68] sm:text-4xl">Your health, one click away</h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-600">
          MediConnect helps you find the right doctor at a hospital near you and book an
          appointment without waiting on the phone.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="rounded-md bg-teal-600 px-5 py-2.5 font-medium text-white hover:bg-teal-700">
            Get started
          </Link>
          <Link href="/doctors" className="rounded-md border border-teal-600 px-5 py-2.5 font-medium text-teal-700 hover:bg-teal-50">
            Find hospitals or doctors
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
