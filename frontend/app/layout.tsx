import type { Metadata } from "next";
import { Bricolage_Grotesque, Spline_Sans_Mono, Pixelify_Sans } from "next/font/google";
import "./globals.css";
import "./surety.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { DitherArt } from "@/components/DitherArt";

// Display grotesque (headings), terminal mono (all data), pixel accent (wordmark) —
// the same three-face system as the reference.
const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"], weight: ["400", "600", "700", "800"] });
const mono = Spline_Sans_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "600"] });
const pixel = Pixelify_Sans({ variable: "--font-pixel", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Surety — insure the agent",
  description:
    "Parametric, on-chain insurance for AI agents. When an insured agent breaks its own published rules, the payout is a contract call — same day, no adjuster.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${pixel.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* ambient dither behind everything: living paper grain */}
        <div aria-hidden className="app-dither">
          <DitherArt shape="field" gap={5} className="h-full w-full" />
        </div>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
