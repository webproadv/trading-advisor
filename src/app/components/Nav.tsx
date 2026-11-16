"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./Controls";

const I = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ITEMS = [
  { href: "/", label: "Conto", icon: I("M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2") },
  { href: "/suggerimenti", label: "Idee", icon: I("M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z") },
  { href: "/analisi", label: "Analisi", icon: I("M4 19V9M10 19V5M16 19v-7M22 19H2") },
  { href: "/impostazioni", label: "Impost.", icon: I("M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4") },
  { href: "/log", label: "Registro", icon: I("M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6") },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="main" aria-label="Navigazione principale">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return <Link key={i.href} href={i.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>{i.icon}<span className="lbl">{i.label}</span></Link>;
      })}
      <LogoutButton />
    </nav>
  );
}
