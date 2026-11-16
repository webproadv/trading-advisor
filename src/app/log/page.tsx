import { requireAuth } from "@/lib/auth";
import { makeStore } from "@/lib/deps";
import { usd, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Log() {
  await requireAuth();
  const store = makeStore();
  const [trades, events] = await Promise.all([store.recentTrades(50), store.recentEvents(60)]);
  return (
    <>
      <h1>Registro</h1>
      <h2>Operazioni</h2>
      <div className="scroll"><table className="rt">
        <thead><tr><th>Data</th><th>Titolo</th><th>Lato</th><th>Azioni</th><th>Importo</th><th>Prezzo</th><th>Origine</th><th>P/L</th><th>Note</th></tr></thead>
        <tbody>
          {trades.length === 0 && <tr><td colSpan={9} className="empty">Nessuna operazione.</td></tr>}
          {trades.map((t) => <tr key={t.id}><td className="wide" data-label="Data">{new Date(t.ts).toLocaleString("it-IT")}</td><td className="title" data-label="Titolo">{t.symbol}</td><td data-label="Lato" className={t.side === "buy" ? "pos" : "neg"}>{t.side === "buy" ? "acquisto" : "vendita"}</td><td data-label="Azioni">{num(t.units)}</td><td data-label="Importo">{usd(t.amount_usd)}</td><td data-label="Prezzo">{usd(t.price)}</td><td data-label="Origine">{t.origin}</td><td data-label="P/L" className={(t.pnl_usd ?? 0) >= 0 ? "pos" : "neg"}>{t.pnl_usd != null ? usd(t.pnl_usd) : ""}</td><td className="wrap wide" data-label="Note">{t.note ?? ""}</td></tr>)}
        </tbody>
      </table></div>
      <h2>Eventi di sistema</h2>
      <div className="scroll"><table className="rt">
        <thead><tr><th>Data</th><th>Tipo</th><th>Dettaglio</th></tr></thead>
        <tbody>
          {events.map((e) => <tr key={e.id}><td className="wide" data-label="Data">{new Date(e.ts).toLocaleString("it-IT")}</td><td className="title" data-label="Tipo">{e.type}</td><td className="wrap wide" data-label="Dettaglio" style={{ wordBreak: "break-word" }}><small>{JSON.stringify(e.payload).slice(0, 300)}</small></td></tr>)}
        </tbody>
      </table></div>
    </>
  );
}
