"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { dashboardFor, useAuth } from "@/lib/auth";

export default function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-bold text-teal-700">
          MediConnect
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href={dashboardFor(user.role)} className="hover:text-teal-700">
                Dashboard
              </Link>
              <span className="hidden text-slate-500 sm:inline">{user.email}</span>
              <button
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-teal-700">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-teal-600 px-3 py-1.5 font-medium text-white hover:bg-teal-700"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
