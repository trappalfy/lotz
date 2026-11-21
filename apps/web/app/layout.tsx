import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Background } from "@/components/Background";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const ogImage = process.env.STORAGE_PUBLIC_URL ? `${process.env.STORAGE_PUBLIC_URL.replace(/\/$/, "")}/og/latest.png` : undefined;
const description = "10,000 lots on one board. Yours until someone pays 1.5x for it.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Lotz — 1,000,000 pixels on Solana",
  description,
  openGraph: {
    title: "Lotz — 1,000,000 pixels on Solana",
    description,
    url: site,
    siteName: "Lotz",
    type: "website",
    images: ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: "The Lotz board" }] : undefined,
  },
  twitter: {
    card: "summary_large_image",
    title: "Lotz — 1,000,000 pixels on Solana",
    description,
    images: ogImage ? [ogImage] : undefined,
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="antialiased">
        <Providers>
          <Background />
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
