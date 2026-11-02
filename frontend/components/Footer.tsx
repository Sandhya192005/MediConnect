import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.png" alt="" width={36} height={36} className="mix-blend-multiply" />
            <span className="text-lg font-extrabold">
              <span className="text-navy-800">Medi</span>
              <span className="text-teal-600">Connect</span>
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-500">Connect · Consult · Care</p>
          <p className="mt-3 max-w-sm text-sm text-slate-600">
            Find the right specialist at a hospital near you and book in seconds. Information from hospital
            websites is shown with its source, so you can check before you visit.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-navy-800">For patients</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><Link href="/doctors" className="hover:text-teal-700">Find hospitals or doctors</Link></li>
            <li><Link href="/hospitals" className="hover:text-teal-700">Hospitals near me</Link></li>
            <li><Link href="/patient/appointments" className="hover:text-teal-700">My appointments</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-navy-800">Emergency</h3>
          <p className="mt-3 text-sm text-slate-600">
            In a medical emergency, call <a href="tel:112" className="font-semibold text-red-600">112</a> or an
            ambulance on <a href="tel:108" className="font-semibold text-red-600">108</a>. Don&apos;t wait for an online booking.
          </p>
        </div>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} MediConnect · A student project · Not a substitute for medical advice
      </div>
    </footer>
  );
}
