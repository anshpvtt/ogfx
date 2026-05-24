import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import TransitionProvider from "./TransitionProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "OGFX - Elite SMC Trading Engine",
  description: "Next.js, Supabase, and Stripe SaaS for deterministic Smart Money Concepts signals and backtesting.",
  keywords: "SMC trading engine, forex backtesting, Supabase SaaS, Stripe subscriptions, EURUSD, XAUUSD",
  openGraph: {
    title: "OGFX - Elite SMC Trading Engine",
    description: "Deterministic Smart Money Concepts signals and backtesting",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-[#0B0F19] text-white min-h-screen`}
      >
        <TransitionProvider>{children}</TransitionProvider>
      </body>
    </html>
  );
}
