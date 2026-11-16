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

  const pnlPct = snap && snap.invested > 0 ? (snap.pnl / snap.invested) * 100 : null;
  const totalPl = snap?.equity != null && settings.start_equity > 0 ? snap.equity - settings.start_equity : null;
  const tot = (snap?.cash ?? 0) + (snap?.value ?? 0);
  const invPct = tot > 0 ? Math.min(100, ((snap?.value ?? 0) / tot) * 100) : 0;
  const arrow = (n: number | null | undefined) => (n == null ? "" : n >= 0 ? "▲" : "▼");

  return (
    <>
      <h1>Portafoglio demo</h1>
      {error && <div className="error">Impossibile leggere il conto eToro: {error}. Controlla le chiavi demo e la pagina /api/debug.</div>}
      {stale && <div className="notice">Il monitoraggio automatico non risulta attivo{tickAgeMin !== null ? ` (ultimo controllo ${Math.round(tickAgeMin)} minuti fa)` : " (nessun controllo ancora eseguito)"}. Verifica il job pg_cron su Supabase.</div>}
      {settings.kill_switch && <div className="error">Kill switch attivo: nessuna operazione automatica.</div>}

      <section className="card hero" aria-label="Riepilogo conto">
        <div className="top">
          <div><div className="label">Patrimonio totale</div><div className="equity">{usd(snap?.equity)}</div>
            {totalPl !== null && <div className={`totpl ${cls(totalPl)}`}>{usd(totalPl)}</div>}</div>
          <div className="plbox">
            <div className="label">Utile / perdita aperto</div>
            <div className={`big ${cls(snap?.pnl ?? null)}`}>{usd(snap?.pnl)}</div>
            <span className={`pill ${cls(pnlPct)}`}>{arrow(pnlPct)} {pnlPct === null ? "n/d" : pct(pnlPct)}</span>
          </div>
        </div>
        <div className="alloc">
          <div className="bar" role="img" aria-label={`Investito ${invPct.toFixed(0)}%`}><i className="inv" style={{ width: `${invPct}%` }} /><i className="cash" style={{ width: `${100 - invPct}%` }} /></div>
          <div className="legend"><span>Investito {invPct.toFixed(0)}%</span><span>Liquidità {(100 - invPct).toFixed(0)}%</span></div>
        </div>
        <div className="stats">
          <div className="stat"><div className="k">Liquidità</div><div className="v">{usd(snap?.cash)}</div></div>
          <div className="stat"><div className="k">Valore</div><div className="v">{usd(snap?.value)}</div></div>
          <div className="stat"><div className="k">Investito</div><div className="v">{usd(snap?.invested)}</div></div>
          <div className="stat"><div className="k">Posizioni</div><div className="v">{snap?.positions.length ?? 0}</div></div>
        </div>
      </section>

      <div className="dash" style={{ marginTop: 18 }}>
        <div className="a-pos">
          <h2>Posizioni aperte</h2>
          <div className="scroll">
            <table className="rt pos-t">
              <thead><tr><th>Titolo</th><th>Azioni</th><th>Carico</th><th>Ora</th><th>Investito</th><th>Valore</th><th>P/L</th><th>Vendi</th></tr></thead>
              <tbody>
                {(snap?.positions ?? []).length === 0 && <tr><td colSpan={8} className="empty">Nessuna posizione aperta.</td></tr>}
                {(snap?.positions ?? []).map((p) => (
                  <tr key={p.positionId}>
                    <td className="title" data-label="Titolo"><b>{p.symbol}</b></td>
                    <td data-label="Azioni">{num(p.unitsEff)}</td>
                    <td data-label="Carico">{fmtPrice(p.symbol, p.openRate)}</td>
                    <td data-label="Ora">{fmtPrice(p.symbol, p.bid)}</td>
                    <td data-label="Investito">{usd(p.amount)}</td>
                    <td data-label="Valore">{usd(p.value)}</td>
                    <td data-label="P/L" className={`pl ${cls(p.pnl)}`}><span>{usd(p.pnl)}</span> <small>{arrow(p.pnlPct)} {pct(p.pnlPct)}</small></td>
                    <td data-label="Vendi" className="act">{p.unitsEff ? <CloseButton instrumentId={p.instrumentId} units={p.unitsEff} symbol={p.symbol} /> : <span className="muted">n/d</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card a-ideas">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <b>Idee in attesa</b><a href="/suggerimenti">{pending.length} · vedi tutte →</a>
            </div>
            <div className="mini">
              {pending.length === 0 && <span className="muted">Nessuna idea al momento.</span>}
              {pending.slice(0, 4).map((s) => (
                <a className="it" key={s.id} href="/suggerimenti" style={{ color: "inherit" }}>
                  <span><b className={s.side === "buy" ? "pos" : "neg"}>{s.side === "buy" ? "▲" : "▼"} {s.symbol}</b><div className="sub">{s.rationale.startsWith("⏱") ? "intraday · " : ""}≈ {usd(s.amount_usd)}</div></span>
                  <span className={`chip ${s.confidence >= 70 ? "pos" : s.confidence < 50 ? "neg" : ""}`}>{s.confidence}</span>
                </a>
              ))}
            </div>
          </div>

          <div className="card a-status">
            <div className="status" style={{ margin: 0 }}>
              <span className={`badge ${settings.mode === "autopilot" ? "danger" : ""}`}><span className="dot" />{settings.mode === "autopilot" ? "AUTOPILOT" : "CONSULENTE"}</span>
              <span className={`badge ${sess.session === "regular" ? "ok" : ""}`}>USA · {SESSION_LABEL[sess.session]}</span>
              <span className={`badge ${eu.session === "regular" ? "ok" : ""}`}>Europa · {SESSION_LABEL[eu.session]}</span>
            </div>
            <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>{etLabel(now)}</p>
            {settings.mode === "autopilot" && <div style={{ marginTop: 10 }}><KillSwitch active={settings.kill_switch} /></div>}
        </div>

          <div className="card a-scan">
            <b>Ricerca opportunità</b>
            <div style={{ marginTop: 10 }}><ScanButton /></div>
            <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
              {lastScan ? `Ultima scansione: ${lastScan.slot} — ${lastScan.created} nuove idee (${lastScan.usedClaude ? "con ricerca web Claude" : "solo regole tecniche"}). ${lastScan.summary ?? ""}` : "Nessuna scansione ancora eseguita."}
            </p>
          </div>
      </div>
      <p className="muted" style={{ marginTop: 22 }}>Conto DEMO con denaro virtuale. Le idee non sono consulenza finanziaria.</p>
    </>
  );
}
