import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Navbar from "@/components/Navbar";
import ChatWidget from "@/components/ChatWidget";
import NotificationToast from "@/components/NotificationToast";
import { AuthProvider } from "@/lib/auth";
import { NotificationProvider } from "@/lib/notifications";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MediConnect",
  description: "Book hospital appointments with the right doctor, near you.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} min-h-screen bg-slate-50 text-slate-900 antialiased`}>
        <AuthProvider>
          <NotificationProvider>
            <Navbar />
            <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
            <NotificationToast />
            <ChatWidget />
          </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
