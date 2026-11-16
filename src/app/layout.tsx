import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./components/Nav";

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const, themeColor: "#070a14" };
export const metadata: Metadata = { title: "Trading Advisor — conto demo eToro", description: "Consulente di trading per il conto demo eToro" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        <header className="top">
          <Link href="/" className="brand"><span className="orb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-5 4 4 8-9M15 7h5v5" /></svg></span>Trading Advisor</Link>
          <span className="demo">DEMO · denaro virtuale</span>
          <Nav />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
