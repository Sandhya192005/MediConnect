import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Navbar from "@/components/Navbar";
import ChatWidget from "@/components/ChatWidget";
import Footer from "@/components/Footer";
import NotificationToast from "@/components/NotificationToast";
import { AuthProvider } from "@/lib/auth";
import { NotificationProvider } from "@/lib/notifications";
import "./globals.css";

// Rounded, friendly sans-serif that sits well next to the logo's lettering.
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MediConnect · Connect · Consult · Care",
  description: "Book hospital appointments with the right doctor, near you.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} flex min-h-screen flex-col font-sans text-slate-900 antialiased`}>
        <AuthProvider>
          <NotificationProvider>
            <Navbar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
            <Footer />
            <NotificationToast />
            <ChatWidget />
          </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
