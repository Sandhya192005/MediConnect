import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";
import Navbar from "@/components/Navbar";
import ChatWidget from "@/components/ChatWidget";
import Footer from "@/components/Footer";
import NotificationToast from "@/components/NotificationToast";
import { AuthProvider } from "@/lib/auth";
import { NotificationProvider } from "@/lib/notifications";
import "./globals.css";

// The pairing the taste skill dealt for the home page: Funnel Display for headings, Funnel Sans for text.
const funnelDisplay = Funnel_Display({ variable: "--font-funnel-display", subsets: ["latin"], weight: ["400", "500"] });
const funnelSans = Funnel_Sans({ variable: "--font-funnel-sans", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "MediConnect: hospital booking in Chennai",
  description: "Book hospital appointments with the right doctor, near you.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${funnelDisplay.variable} ${funnelSans.variable} flex min-h-screen flex-col font-sans text-slate-900 antialiased`}>
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
