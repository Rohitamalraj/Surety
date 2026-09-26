import type { Metadata } from "next";
import { Sora, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "./surety.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";

// Sora for headings (geometric, confident), IBM Plex Mono for every number, address and label.
const display = Sora({ variable: "--font-display", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Surety — insure the agent",
  description:
    "Parametric, on-chain insurance for AI agents. When an insured agent breaks its own published rules, the payout is a contract call — same day, no adjuster.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
