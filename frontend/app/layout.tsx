import type { Metadata } from "next";
import { Funnel_Display, Funnel_Sans } from "next/font/google";
import AppChrome from "@/components/AppChrome";
import ChatWidget from "@/components/ChatWidget";
import NotificationToast from "@/components/NotificationToast";
import { AuthProvider } from "@/lib/auth";
import { NotificationProvider } from "@/lib/notifications";
import "./globals.css";

// Funnel Display for headings, Funnel Sans for text. Loaded as variable fonts (all weights):
// public pages use 400/500, the logged-in dashboards also use semibold headings.
const funnelDisplay = Funnel_Display({ variable: "--font-funnel-display", subsets: ["latin"] });
const funnelSans = Funnel_Sans({ variable: "--font-funnel-sans", subsets: ["latin"] });

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
            <AppChrome>{children}</AppChrome>
            <NotificationToast />
            <ChatWidget />
          </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
