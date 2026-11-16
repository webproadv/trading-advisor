import { requireAuth } from "@/lib/auth";
import { makeStore } from "@/lib/deps";
import { usd, pct, num, fmtPrice } from "@/lib/format";
import { upsidePct } from "@/lib/risk";
import { SuggestionCard } from "../components/Controls";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = { pending: "in attesa", approved: "in coda (mercato chiuso)", rejected: "rifiutata", executed: "eseguita", expired: "scaduta", failed: "fallita" };

export default async function Suggerimenti() {
  await requireAuth();
  const store = makeStore();
  const [pending, past] = await Promise.all([store.listSuggestions(["pending", "approved"], 50), store.listSuggestions(["executed", "rejected", "expired", "failed"], 30)]);
  return (
    <>
      <h1>Idee del consulente</h1>
      <p className="muted">Decidi tu se comprare o vendere e quante azioni: modifica il numero e conferma.</p>
      {pending.length === 0 && <div className="card muted">Nessuna idea in attesa. Il consulente scansiona il mercato agli orari impostati; puoi anche avviare una ricerca dalla pagina Portafoglio.</div>}
      <div className="sugg">
        {pending.map((s) => {
          const up = upsidePct(s.target_price, s.price_ref);
          return (
            <div className={`card idea ${s.side}`} key={s.id}>
              <div className="row"><h3 className={s.side === "buy" ? "pos" : "neg"}>{s.side === "buy" ? "▲ COMPRA" : "▼ VENDI"} {s.symbol}</h3>
                {s.rationale.startsWith("⏱") && <span className="badge warn">intraday</span>}
                <span className="badge">{ST[s.status]}</span>
                <span className={`meter ${s.confidence >= 70 ? "hi" : s.confidence < 50 ? "lo" : ""}`} title="Fiducia calcolata da indicatori, timeframe e analisi"><span className="bar"><i style={{ width: `${Math.min(100, Math.max(0, s.confidence))}%` }} /></span>fiducia {s.confidence}/100</span></div>
              <div className="meta">Prezzo di riferimento {fmtPrice(s.symbol, s.price_ref)} · proposta {num(s.units)} azioni (≈ {usd(s.amount_usd)})
                {s.target_price ? ` · obiettivo ${fmtPrice(s.symbol, s.target_price)}${up !== null ? ` (${pct(up)})` : ""}` : ""}{s.stop_price ? ` · stop ${fmtPrice(s.symbol, s.stop_price)}` : ""}</div>
              <div className="why">{s.rationale}</div>
              {s.sources?.length > 0 && <div className="src"><span>Fonti:</span>{s.sources.map((x) => <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer">{x.title || x.url}</a>)}</div>}
              {s.status === "pending" && <SuggestionCard id={s.id} side={s.side} units={s.units} price={s.units > 0 ? s.amount_usd / s.units : s.price_ref} symbol={s.symbol} />}
            </div>
          );
        })}
      </div>
      <h2>Storico</h2>
      <div className="scroll"><table className="rt">
        <thead><tr><th>Data</th><th>Titolo</th><th>Azione</th><th>Azioni</th><th>Stato</th></tr></thead>
        <tbody>
          {past.length === 0 && <tr><td colSpan={5} className="empty">Ancora nulla.</td></tr>}
          {past.map((s) => <tr key={s.id}><td data-label="Data">{new Date(s.created_at).toLocaleString("it-IT")}</td><td className="title" data-label="Titolo">{s.symbol}</td><td data-label="Azione">{s.side === "buy" ? "compra" : "vendi"}</td><td data-label="Azioni">{num(s.units)}</td><td data-label="Stato">{ST[s.status]}</td></tr>)}
        </tbody>
      </table></div>
    </>
  );
}
