import { requireAuth } from "@/lib/auth";
import { makeDeps } from "@/lib/deps";
import { snapshot, type Snapshot } from "@/lib/engine";
import { sessionOf, etLabel, euSessionOf } from "@/lib/time";
import { fmtPrice, num, pct, usd } from "@/lib/format";
import { CloseButton, KillSwitch, ScanButton } from "./components/Controls";

export const dynamic = "force-dynamic";

const SESSION_LABEL: Record<string, string> = { closed: "Mercato chiuso", premarket: "Premarket", regular: "Sessione regolare", afterhours: "After-hours" };
const cls = (n: number | null) => (n === null ? "" : n >= 0 ? "pos" : "neg");

export default async function Home() {
  await requireAuth();
  const d = makeDeps();
  const now = new Date();
  const sess = sessionOf(now);
  const eu = euSessionOf(now);
  let snap: Snapshot | null = null;
  let error = "";
  try { snap = await snapshot(d); } catch (e) { error = (e as Error).message; }
  const [settings, lastTick, lastScan, pending] = await Promise.all([
    d.store.getSettings(),
    d.store.kvGet<{ ts: string }>("last_tick"),
    d.store.kvGet<{ slot: string; ts: string; created: number; summary: string; usedClaude: boolean }>("last_scan"),
    d.store.listSuggestions(["pending"], 50),
  ]);
  const tickAgeMin = lastTick ? (now.getTime() - new Date(lastTick.ts).getTime()) / 60000 : null;
  const stale = tickAgeMin === null || tickAgeMin > 15;

  return (
    <>
      <h1>Portafoglio demo</h1>
      <p className="muted" style={{ margin: "0 0 16px" }}>Conto eToro virtuale · dati aggiornati ogni 15 minuti in orario di mercato.</p>
      {error && <div className="error">Impossibile leggere il conto eToro: {error}. Controlla le chiavi demo e la pagina /api/debug.</div>}
      {stale && <div className="notice">Il monitoraggio automatico non risulta attivo{tickAgeMin !== null ? ` (ultimo controllo ${Math.round(tickAgeMin)} minuti fa)` : " (nessun controllo ancora eseguito)"}. Verifica il job pg_cron su Supabase.</div>}
      {settings.kill_switch && <div className="error">Kill switch attivo: nessuna operazione automatica.</div>}
      <div className="grid">
        <div className="card kpi"><div className="label">Giacenza (liquidità)</div><div className="value">{usd(snap?.cash)}</div></div>
        <div className="card kpi"><div className="label">Valore posizioni</div><div className="value">{usd(snap?.value)}</div></div>
        <div className="card kpi"><div className="label">Patrimonio totale</div><div className="value">{usd(snap?.equity)}</div></div>
        <div className="card kpi"><div className="label">Utile/perdita aperto</div><div className={`value ${cls(snap?.pnl ?? null)}`}>{usd(snap?.pnl)}</div></div>
      </div>
      <div className="status">
        <span className={`badge ${settings.mode === "autopilot" ? "danger" : ""}`}><span className="dot" />{settings.mode === "autopilot" ? "AUTOPILOT" : "CONSULENTE"}</span>
        <span className={`badge ${sess.session === "regular" ? "ok" : ""}`}>USA · {SESSION_LABEL[sess.session]}</span>
        <span className={`badge ${eu.session === "regular" ? "ok" : ""}`}>Europa · {SESSION_LABEL[eu.session]}</span>
        <span className="muted">{etLabel(now)}</span>
        <span className="muted">Idee in attesa: <a href="/suggerimenti">{pending.length}</a></span>
        {settings.mode === "autopilot" && <KillSwitch active={settings.kill_switch} />}
      </div>

      <h2>Posizioni aperte</h2>
      <div className="scroll">
        <table className="rt">
          <thead><tr><th>Titolo</th><th>Azioni</th><th>Prezzo carico</th><th>Prezzo ora</th><th>Investito</th><th>Valore</th><th>P/L</th><th>Vendi</th></tr></thead>
          <tbody>
            {(snap?.positions ?? []).length === 0 && <tr><td colSpan={8} className="empty">Nessuna posizione aperta.</td></tr>}
            {(snap?.positions ?? []).map((p) => (
              <tr key={p.positionId}>
                <td className="title" data-label="Titolo"><b>{p.symbol}</b></td>
                <td data-label="Azioni">{num(p.unitsEff)}</td>
                <td data-label="Prezzo carico">{fmtPrice(p.symbol, p.openRate)}</td>
                <td data-label="Prezzo ora">{fmtPrice(p.symbol, p.bid)}</td>
                <td data-label="Investito">{usd(p.amount)}</td>
                <td data-label="Valore">{usd(p.value)}</td>
                <td data-label="P/L" className={cls(p.pnl)}><span>{usd(p.pnl)} <small>({pct(p.pnlPct)})</small></span></td>
                <td data-label="Vendi">{p.unitsEff ? <CloseButton instrumentId={p.instrumentId} units={p.unitsEff} symbol={p.symbol} /> : <span className="muted">n/d</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Ricerca opportunità</h2>
      <div className="card">
        <ScanButton />
        <p className="muted" style={{ marginBottom: 0 }}>
          {lastScan ? `Ultima scansione: ${lastScan.slot} — ${lastScan.created} nuove idee (${lastScan.usedClaude ? "con ricerca web Claude" : "solo regole tecniche"}). ${lastScan.summary ?? ""}` : "Nessuna scansione ancora eseguita."}
        </p>
      </div>
      <p className="muted">Conto DEMO con denaro virtuale. Le idee non sono consulenza finanziaria.</p>
    </>
  );
}
