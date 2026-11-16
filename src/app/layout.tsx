import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { LogoutButton } from "./components/Controls";

export const metadata: Metadata = { title: "Trading Advisor — conto demo eToro", description: "Consulente di trading per il conto demo eToro" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        <header className="top">
          <span className="logo">📈 Trading Advisor</span>
          <span className="badge warn">DEMO · denaro virtuale</span>
          <nav>
            <Link href="/">Portafoglio</Link>
            <Link href="/suggerimenti">Idee</Link>
            <Link href="/analisi">Analisi</Link>
            <Link href="/impostazioni">Impostazioni</Link>
            <Link href="/log">Registro</Link>
            <LogoutButton />
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
