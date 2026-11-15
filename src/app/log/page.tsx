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
      <div className="scroll"><table>
        <thead><tr><th>Data</th><th>Titolo</th><th>Lato</th><th>Azioni</th><th>Importo</th><th>Prezzo</th><th>Origine</th><th>P/L</th><th>Note</th></tr></thead>
        <tbody>
          {trades.length === 0 && <tr><td colSpan={9} className="muted">Nessuna operazione.</td></tr>}
          {trades.map((t) => <tr key={t.id}><td>{new Date(t.ts).toLocaleString("it-IT")}</td><td>{t.symbol}</td><td>{t.side === "buy" ? "acquisto" : "vendita"}</td><td>{num(t.units)}</td><td>{usd(t.amount_usd)}</td><td>{usd(t.price)}</td><td>{t.origin}</td><td>{t.pnl_usd != null ? usd(t.pnl_usd) : ""}</td><td>{t.note ?? ""}</td></tr>)}
        </tbody>
      </table></div>
      <h2>Eventi di sistema</h2>
      <div className="scroll"><table>
        <thead><tr><th>Data</th><th>Tipo</th><th>Dettaglio</th></tr></thead>
        <tbody>
          {events.map((e) => <tr key={e.id}><td>{new Date(e.ts).toLocaleString("it-IT")}</td><td>{e.type}</td><td><small>{JSON.stringify(e.payload).slice(0, 300)}</small></td></tr>)}
        </tbody>
      </table></div>
    </>
  );
}
