"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { money } from "@/lib/format";
import type { Settings } from "@/lib/types";

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, message: `Errore ${r.status}` }))) as { ok?: boolean; message?: string; error?: string; errors?: string[]; [k: string]: unknown };
}
const say = (r: { ok?: boolean; message?: string; error?: string; errors?: string[] }) => r.message ?? r.errors?.join("; ") ?? r.error ?? (r.ok ? "Fatto." : "Operazione non riuscita.");

export function SuggestionCard({ id, side, units, price, symbol }: { id: number; side: "buy" | "sell"; units: number; price: number; symbol: string }) {
  const router = useRouter();
  const [u, setU] = useState(String(units));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: "approve" | "reject") => {
    const n = Number(u.replace(",", "."));
    if (action === "approve") {
      if (!(n > 0)) { setMsg("Inserisci un numero di azioni valido."); return; }
      const label = side === "buy" ? `Comprare ${n} azioni di ${symbol} (≈ $${(n * price).toFixed(2)})?` : `Vendere ${n} azioni di ${symbol}?`;
      if (!confirm(`${label}\nConto DEMO.`)) return;
    }
    setBusy(true);
    const r = await call(`/api/suggestions/${id}`, "POST", { action, units: n });
    setMsg(say(r)); setBusy(false); router.refresh();
  };
  return (
    <div>
      <div className="row">
        <label>Numero di azioni <input type="number" min="0" step="0.0001" value={u} onChange={(e) => setU(e.target.value)} disabled={busy} /></label>
        <span className="muted">≈ ${(Number(u.replace(",", ".")) * price || 0).toFixed(2)}</span>
        <button className={side === "buy" ? "buy" : "sell"} disabled={busy} onClick={() => act("approve")}>{side === "buy" ? "Compra" : "Vendi"}</button>
        <button disabled={busy} onClick={() => act("reject")}>Rifiuta</button>
      </div>
      {msg && <div className="ok">{msg}</div>}
    </div>
  );
}

export function CloseButton({ instrumentId, units, symbol }: { instrumentId: number; units: number; symbol: string }) {
  const router = useRouter();
  const [u, setU] = useState(String(units));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const n = Number(u.replace(",", "."));
    if (!(n > 0)) return;
    if (!confirm(`Vendere ${n} azioni di ${symbol}? (conto DEMO)`)) return;
    setBusy(true);
    const r = await call("/api/positions/close", "POST", { instrumentId, units: n >= units * 0.995 ? null : n });
    setMsg(say(r)); setBusy(false); router.refresh();
  };
  return (
    <div className="row">
      <input type="number" min="0" step="0.0001" value={u} onChange={(e) => setU(e.target.value)} disabled={busy} aria-label={`Azioni da vendere di ${symbol}`} />
      <button className="sell" disabled={busy} onClick={go}>Vendi</button>
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}


/** Acquisto manuale di un titolo dalla pagina Analisi. */
export function BuyBox({ symbol, price, currency, defaultUnits }: { symbol: string; price: number; currency: string; defaultUnits: number }) {
  const router = useRouter();
  const [u, setU] = useState(String(defaultUnits));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(u.replace(",", "."));
  const go = async () => {
    if (!(n > 0)) { setMsg({ ok: false, text: "Inserisci un numero di azioni valido." }); return; }
    if (!confirm(`Comprare ${n} azioni di ${symbol} (≈ ${money(n * price, currency)})?\nConto DEMO.`)) return;
    setBusy(true);
    const r = await call("/api/positions/buy", "POST", { symbol, units: n });
    setMsg({ ok: !!r.ok, text: say(r) }); setBusy(false); router.refresh();
  };
  return (
    <div className="buybox">
      <div className="row">
        <input type="number" min="0" step="0.0001" value={u} onChange={(e) => setU(e.target.value)} disabled={busy} aria-label={`Azioni da comprare di ${symbol}`} />
        <button className="buy" disabled={busy} onClick={go}>Compra</button>
        <span className="muted est">≈ {money(n > 0 ? n * price : 0, currency)}</span>
      </div>
      {msg && <div className={msg.ok ? "ok" : "error"} style={{ margin: "6px 0 0" }}>{msg.text}</div>}
    </div>
  );
}

export function KillSwitch({ active }: { active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    await call("/api/settings", "POST", { kill_switch: !active });
    setBusy(false); router.refresh();
  };
  return <button className={active ? "primary" : "sell"} disabled={busy} onClick={toggle}>{active ? "Riattiva autopilot" : "⛔ Ferma subito l'autopilot"}</button>;
}

export function ScanButton() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (scope: "US" | "EU") => {
    setBusy(true); setMsg("Analisi in corso (fino a 1 minuto)…");
    const r = await call("/api/scan", "POST", { scope });
    setBusy(false);
    setMsg(r.ok ? `Scansione completata: ${r.created} nuove idee${r.usedClaude ? " (con analisi Claude)" : " (solo regole tecniche)"}.` : say(r));
    router.refresh();
  };
  return <div className="row"><button className="primary" disabled={busy} onClick={() => go("US")}>🔎 Cerca opportunità USA</button><button className="primary" disabled={busy} onClick={() => go("EU")}>🔎 Cerca opportunità Europa</button>{msg && <span className="muted">{msg}</span>}</div>;
}

export function TelegramSetup() {
  const [msg, setMsg] = useState("");
  const go = async () => { const r = await call("/api/telegram/setup", "POST"); setMsg(r.ok && !r.error ? "Collegato: controlla il messaggio su Telegram." : say(r)); };
  return <div className="row"><button onClick={go}>Collega / verifica Telegram</button>{msg && <span className="muted">{msg}</span>}</div>;
}

export function LogoutButton() {
  const router = useRouter();
  return <button aria-label="Esci" onClick={async () => { await call("/api/auth/logout", "POST"); router.push("/login"); router.refresh(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" /></svg><span className="lbl">Esci</span></button>;
}

export function WatchlistEditor({ items }: { items: Array<{ symbol: string; instrument_id: number; name?: string | null }> }) {
  const router = useRouter();
  const [sym, setSym] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const r = await call("/api/watchlist", "POST", { symbol: sym });
    setMsg(say(r)); setBusy(false); if (r.ok) setSym(""); router.refresh();
  };
  const del = async (s: string) => { await call(`/api/watchlist?symbol=${encodeURIComponent(s)}`, "DELETE"); router.refresh(); };
  return (
    <div className="card">
      <div className="row">
        <input type="text" style={{ maxWidth: 160 }} placeholder="NVDA, ENI.MI, SAN.MC, BMW.DE" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} />
        <button className="primary" disabled={busy || !sym} onClick={add}>Aggiungi</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {items.length === 0 && <span className="muted">Nessun titolo: aggiungine qualcuno (es. AAPL, MSFT, NVDA, SPY).</span>}
        {items.map((w) => <span key={w.symbol} className="badge">{w.symbol} <a href="#" aria-label={`Rimuovi ${w.symbol}`} onClick={(e) => { e.preventDefault(); del(w.symbol); }} title="Rimuovi">✕</a></span>)}
      </div>
    </div>
  );
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [s, setS] = useState({ ...initial, scan_times: initial.scan_times.join(", "), scan_times_eu: initial.scan_times_eu.join(", ") } as unknown as Record<string, string | number | boolean>);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | number | boolean) => setS((p) => ({ ...p, [k]: v }));
  const num = (k: string, label: string, hint: string, step = "any") => (
    <label>{label}<input type="number" step={step} min="0" value={String(s[k])} onChange={(e) => set(k, e.target.value)} /><small>{hint}</small></label>
  );
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (s.mode === "autopilot" && initial.mode !== "autopilot" &&
        !confirm("Attivare l'AUTOPILOT? L'app potrà comprare e vendere da sola sul conto DEMO entro i limiti impostati.")) return;
    setBusy(true);
    const split = (v: unknown) => String(v).split(",").map((x) => x.trim()).filter(Boolean);
    const payload = { ...s, scan_times: split(s.scan_times), scan_times_eu: split(s.scan_times_eu) };
    const r = await call("/api/settings", "POST", payload);
    setMsg({ ok: !!r.ok, text: r.ok ? "Impostazioni salvate." : say(r) }); setBusy(false); router.refresh();
  };
  return (
    <form className="settings" onSubmit={save}>
      <label>Modalità
        <select value={String(s.mode)} onChange={(e) => set("mode", e.target.value)}>
          <option value="advisor">Consulente: propongo, decidi tu</option>
          <option value="autopilot">Autopilot: opero io entro i limiti</option>
        </select>
        <small>In autopilot compro/vendo da solo solo se tutti i limiti sotto sono rispettati.</small>
      </label>
      {num("max_daily_invest_usd", "Massimo investibile al giorno ($)", "Tetto sugli acquisti dell'autopilot in una giornata di borsa.")}
      {num("max_position_usd", "Massimo per singola operazione ($)", "Importo massimo di ogni acquisto proposto o automatico.")}
      {num("max_open_positions", "Posizioni aperte massime", "Oltre questo numero l'autopilot non compra.", "1")}
      {num("take_profit_pct", "Soglia di guadagno per vendere (%)", "Vendo (o ti avviso) quando la posizione guadagna questa percentuale.")}
      {num("stop_loss_pct", "Soglia di perdita per vendere (%)", "Vendo (o ti avviso) quando la posizione perde questa percentuale. Obbligatoria.")}
      {num("buy_margin_pct", "Margine per comprare (%)", "Compro solo se il guadagno stimato verso il prezzo obiettivo supera questa percentuale.")}
      {num("trend_exit_min_profit_usd", "Chiudi su trend ribassista da profitto ($)", "Con almeno questo profitto in dollari, l'autopilot chiude la posizione se il trend (Supertrend, EMA 9/50 e indicatori) diventa ribassista su 1, 5 e 10 minuti. Sotto questa soglia vale solo lo stop-loss.", "0.5")}
      {num("max_overnight_usd", "Massimo overnight ($)", "Importo massimo investito in acquisti prima della chiusura su notizie attese (calendario, risultati, aspettative). 0 = disattivato. Mai prima di weekend e festivi; se all'apertura sono in perdita vengono vendute subito.", "10")}
      {num("start_equity", "Capitale iniziale ($)", "Capitale di partenza del conto demo: serve a calcolare l'utile/perdita totale dall'inizio mostrato sotto il patrimonio.", "1")}
      {num("scan_interval_min", "Cerca opportunità ogni (minuti)", "Scansione automatica con analisi di Claude per USA ed Europa, durante premarket e orari di borsa (USA dalle 08:00 ET, Europa dalle 08:00 ora italiana). 0 = solo agli orari fissi qui sotto. Ogni scansione usa l'IA: 15 minuti = circa 70 analisi al giorno.", "1")}
      {num("min_confidence", "Fiducia minima per l'autopilot (0-100)", "Le idee con fiducia inferiore restano in attesa della tua approvazione.", "1")}
      <label>Orari scansione USA (ora di New York, usati se l'intervallo sopra è 0)<input type="text" value={String(s.scan_times)} onChange={(e) => set("scan_times", e.target.value)} /><small>Giorni di borsa USA. 08:00 ET = premarket (14:00 in Italia). Esempio: 08:00, 10:00, 14:00</small></label>
      <label>Orari scansione Europa (ora italiana, usati se l'intervallo sopra è 0)<input type="text" value={String(s.scan_times_eu)} onChange={(e) => set("scan_times_eu", e.target.value)} /><small>Giorni di borsa europei (apertura 09:00–17:30). 08:30 = pre-apertura. Esempio: 08:30, 11:00, 15:00</small></label>
      <label className="row"><input type="checkbox" checked={!!s.alerts_enabled} onChange={(e) => set("alerts_enabled", e.target.checked)} /> Alert su Telegram attivi</label>
      <label className="row"><input type="checkbox" checked={!!s.allow_discovery} onChange={(e) => set("allow_discovery", e.target.checked)} /> Cerca anche titoli fuori dalla watchlist</label>
      <label className="row"><input type="checkbox" checked={!!s.auto_follow_sell_ideas} onChange={(e) => set("auto_follow_sell_ideas", e.target.checked)} /> L&apos;autopilot vende anche sulle idee di vendita (oltre che sulle soglie)</label>
      <div><button className="primary" disabled={busy} type="submit">Salva impostazioni</button>{msg && <div className={msg.ok ? "ok" : "error"}>{msg.text}</div>}</div>
    </form>
  );
}
