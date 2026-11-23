// Motore del consulente: monitoraggio, scansioni, suggerimenti, esecuzione e autopilot (solo conto DEMO).
import type { ClaudeLike, HeldRow, QuantRow, RawIdea } from "./claude";
import type { EtoroLike } from "./etoro";
import { clamp, esc, fmtPrice, mapLimit, num, pct, round2, round4, usd } from "./format";
import { blendConfidence, quantConfidence } from "./confidence";
import { FRAMES, analyze, favorableBuy, favorableSell, mtfSummary, potentialScore, techPanel, trendState, type Analysis, type Mtf, type Tech, type TrendState } from "./indicators";
import { MIN_ORDER_USD, exitDecision, sizeBuy, upsidePct } from "./risk";
import type { Store } from "./store";
import { parseChatIds, type Button, type TelegramLike } from "./telegram";
import { autoScanSlots, dueScanSlots, dueScanSlotsEu, etLabel, euLabel, euSessionOf, isPremarketSlot, isRegularFor, marketOf, nextDayTrades, romeDay, scopeOfSlot, sessionFor, sessionOf, type Group } from "./time";
import type { Candle, Position, Rate, Settings, SourceRef, Suggestion } from "./types";

export interface Deps {
  store: Store; etoro: EtoroLike; tg: TelegramLike; claude: ClaudeLike; now: () => Date;
  /** USD per 1 unita' di valuta (es. EUR). Assente = solo titoli in USD. */
  fx?: (currency: string) => Promise<number>;
}

/** Quanti USD vale 1 unita' di prezzo del titolo (1 per i titoli USA). */
async function fxOf(d: Deps, symbol: string): Promise<number> {
  const cur = marketOf(symbol).currency;
  if (cur === "USD") return 1;
  if (!d.fx) throw new Error(`conversione ${cur}/USD non configurata`);
  return d.fx(cur);
}

const SUGGESTION_TTL_H = 20;
const INTRADAY_TTL_H = 6;          // le idee intraday scadono in giornata
const INTRADAY_MIN_UPSIDE_PCT = 1.5; // margine minimo di acquisto per le idee intraday
const OVERNIGHT_TTL_H = 1;        // le idee overnight valgono fino alla chiusura

// ------------------------------------------------------------------ utilita'
async function once(d: Deps, key: string): Promise<boolean> {
  if (await d.store.kvGet(`once:${key}`)) return false;
  await d.store.kvSet(`once:${key}`, d.now().toISOString());
  return true;
}

async function notify(d: Deps, html: string, buttons?: Button[][]) {
  const s = await d.store.getSettings();
  if (!s.alerts_enabled || !d.tg.enabled) return;
  try { await d.tg.send(html, buttons); } catch (e) { await d.store.logEvent("telegram_error", { error: (e as Error).message }); }
}

type SymMap = Record<string, string>; // instrumentId -> simbolo
async function symMap(d: Deps): Promise<SymMap> {
  const m = ((await d.store.kvGet<SymMap>("symbols")) ?? {}) as SymMap;
  for (const w of await d.store.listWatchlist()) m[String(w.instrument_id)] = w.symbol;
  return m;
}
async function rememberSymbol(d: Deps, id: number, symbol: string) {
  const m = ((await d.store.kvGet<SymMap>("symbols")) ?? {}) as SymMap;
  if (m[String(id)] !== symbol) { m[String(id)] = symbol; await d.store.kvSet("symbols", m); }
}

export function dropIncomplete(candles: Candle[], intervalSec: number, now: Date): Candle[] {
  const last = candles[candles.length - 1];
  if (last && new Date(last.t).getTime() + intervalSec * 1000 > now.getTime()) return candles.slice(0, -1);
  return candles;
}

// ------------------------------------------------------------------ analisi tecnica live
const TECH_TTL_MS = 14 * 60_000;

/** Scarica le candele a 30 minuti, 1 ora e 4 ore e calcola il pannello tecnico di ciascun timeframe con prezzo live. */
export async function refreshIntraday(d: Deps, symbol: string, instrumentId: number, live: number | null): Promise<Mtf | null> {
  const now = d.now();
  const frames = { "30m": null, "1h": null, "4h": null } as Mtf["frames"];
  let any = false;
  for (const f of FRAMES) {
    try {
      const raw = await d.etoro.candles(instrumentId, f.interval, 150);
      const completed = dropIncomplete(raw, f.sec, now);
      const partial = completed.length < raw.length ? raw[raw.length - 1] : null;
      const price = live ?? completed[completed.length - 1]?.c ?? null;
      if (price === null) continue;
      frames[f.frame] = techPanel(completed, price, partial, now.toISOString());
      if (frames[f.frame]) any = true;
    } catch (e) { await d.store.logEvent("mtf_error", { symbol, frame: f.frame, error: (e as Error).message }); }
  }
  if (!any) return null;
  const m: Mtf = { asOf: now.toISOString(), frames };
  await d.store.kvSet(`mtf:${symbol}`, m);
  return m;
}

/** Scarica le candele giornaliere, calcola analisi di trend e pannello tecnico con prezzo live (piu' i timeframe intraday), e li salva. */
export async function refreshTech(d: Deps, symbol: string, instrumentId: number, live: number | null): Promise<{ a: Analysis; tech: Tech | null; mtf: Mtf | null } | null> {
  const now = d.now();
  const raw = await d.etoro.candles(instrumentId, "OneDay", 130);
  const completed = dropIncomplete(raw, 86400, now);
  const partial = completed.length < raw.length ? raw[raw.length - 1] : null;
  const a = analyze(completed);
  if (!a) return null;
  const tech = techPanel(completed, live ?? a.last, partial, now.toISOString());
  await d.store.kvSet(`analysis:${symbol}`, a);
  if (tech) await d.store.kvSet(`tech:${symbol}`, tech);
  const mtf = await refreshIntraday(d, symbol, instrumentId, live);
  return { a, tech, mtf };
}

const mtfRow = (m: Mtf | null): Pick<QuantRow, "mtf" | "mtfAlignment"> => {
  if (!m) return {};
  const mtf: NonNullable<QuantRow["mtf"]> = {};
  for (const f of FRAMES) {
    const t = m.frames[f.frame];
    mtf[f.frame] = t ? { verdict: t.signals.verdict, rsi14: t.rsi14, macdHist: t.macdHist, adx: t.adx, stochK: t.stochK, atrPct: t.atrPct } : null;
  }
  return { mtf, mtfAlignment: mtfSummary(m).alignment };
};

const techRow = (t: Tech | null): QuantRow["tech"] => t ? {
  mom10Pct: t.mom10Pct, stochK: t.stochK, stochD: t.stochD, stochRsiK: t.stochRsiK, macdHist: t.macdHist, adx: t.adx, plusDI: t.plusDI,
  minusDI: t.minusDI, willR: t.willR, cci20: t.cci20, atrPct: t.atrPct, pivot: t.pivots?.p ?? null, r1: t.pivots?.r1 ?? null, s1: t.pivots?.s1 ?? null,
  votes: { buy: t.signals.buy, sell: t.signals.sell, neutral: t.signals.neutral, verdict: t.signals.verdict },
} : undefined;

// ------------------------------------------------------------------ portafoglio
export interface PosView extends Position {
  symbol: string; bid: number | null; unitsEff: number | null; value: number | null; pnl: number | null; pnlPct: number | null;
}
export interface Snapshot { cash: number | null; positions: PosView[]; invested: number; value: number; equity: number | null; pnl: number }

export async function snapshot(d: Deps): Promise<Snapshot> {
  const pf = await d.etoro.portfolio();
  const longs = pf.positions.filter((p) => p.isBuy);
  const ids = [...new Set(longs.map((p) => p.instrumentId))];
  const rates = ids.length ? await d.etoro.rates(ids) : {};
  const sm = await symMap(d);
  const positions: PosView[] = longs.map((p) => {
    const bid = rates[p.instrumentId]?.bid ?? null;
    const unitsEff = p.units ?? (p.openRate > 0 ? p.amount / p.openRate : null);
    // valore in USD = importo investito x variazione di prezzo (indipendente dalla valuta di quotazione)
    const value = bid !== null && p.openRate > 0 ? p.amount * (bid / p.openRate) : null;
    const pnl = value !== null ? value - p.amount : null;
    return { ...p, symbol: sm[String(p.instrumentId)] ?? `ID ${p.instrumentId}`, bid, unitsEff, value, pnl, pnlPct: bid !== null && p.openRate > 0 ? (bid / p.openRate - 1) * 100 : null };
  });
  const invested = positions.reduce((s, p) => s + p.amount, 0);
  const value = positions.reduce((s, p) => s + (p.value ?? p.amount), 0);
  return { cash: pf.cash, positions, invested, value, equity: pf.cash !== null ? pf.cash + value : null, pnl: value - invested };
}

// ------------------------------------------------------------------ messaggi
export function suggestionHtml(s: Suggestion, header?: string): string {
  const up = upsidePct(s.target_price, s.price_ref);
  const icon = s.side === "buy" ? "🟢 COMPRA" : "🔴 VENDI";
  const lines = [
    header ? `<i>${esc(header)}</i>` : "",
    `<b>${icon} ${esc(s.symbol)}</b> — idea #${s.id}`,
    `Prezzo ${fmtPrice(s.symbol, s.price_ref)}${s.target_price ? ` · target ${fmtPrice(s.symbol, s.target_price)} (${pct(up)})` : ""}${s.stop_price ? ` · stop ${fmtPrice(s.symbol, s.stop_price)}` : ""}`,
    `Proposta: ${num(s.units, 4)} azioni ≈ ${usd(s.amount_usd)} · fiducia ${s.confidence}/100`,
    s.rationale ? `Motivo: ${esc(s.rationale)}` : "",
    s.sources?.length ? `Fonti: ${s.sources.slice(0, 3).map((x) => `<a href="${esc(x.url)}">${esc(x.title.slice(0, 40))}</a>`).join(" · ")}` : "",
    "<i>Analisi a scopo educativo su conto demo, non consulenza finanziaria.</i>",
  ];
  return lines.filter(Boolean).join("\n");
}
const buttonsFor = (s: Suggestion): Button[][] => [[{ text: "✅ Approva", data: `a:${s.id}` }, { text: "❌ Rifiuta", data: `r:${s.id}` }]];

// ------------------------------------------------------------------ creazione idee
interface ProposeCtx {
  settings: Settings; snap: Snapshot; rates: Record<number, Rate>; day: string; now: Date; pending: Suggestion[];
  idOf: Map<string, number>; // simbolo -> instrumentId noto
  investedAuto: number;
}

async function resolveInstrument(d: Deps, c: ProposeCtx, symbol: string, discovery: boolean): Promise<number | null> {
  const known = c.idOf.get(symbol);
  if (known) return known;
  if (!discovery) return null;
  const found = await d.etoro.search(symbol);
  if (!found) return null;
  c.idOf.set(symbol, found.instrumentId);
  await rememberSymbol(d, found.instrumentId, symbol);
  return found.instrumentId;
}

export async function proposeIdea(
  d: Deps, c: ProposeCtx, idea: RawIdea, sources: SourceRef[], origin: "scan" | "monitor",
): Promise<{ created?: Suggestion; skipped?: string }> {
  const { settings } = c;
  const symbol = idea.symbol;
  if (c.pending.some((p) => p.symbol === symbol && p.side === idea.side)) return { skipped: "gia' presente tra le idee in attesa" };
  const id = await resolveInstrument(d, c, symbol, idea.side === "buy" && settings.allow_discovery);
  if (!id) return { skipped: "non trovato su eToro o fuori watchlist" };
  let rate = c.rates[id];
  if (!rate) { rate = (await d.etoro.rates([id]))[id]; if (rate) c.rates[id] = rate; }
  if (!rate) return { skipped: "prezzo non disponibile" };
  const refs = sources.filter((s) => idea.source_urls.includes(s.url)).slice(0, 4);
  const intraday = idea.horizon === "intraday";
  const overnight = idea.horizon === "overnight";
  const expires_at = new Date(c.now.getTime() + (overnight ? OVERNIGHT_TTL_H : intraday ? INTRADAY_TTL_H : SUGGESTION_TTL_H) * 3600_000).toISOString();
  const tag = overnight ? "🌙 OVERNIGHT (notizia attesa: acquisto prima della chiusura, uscita all'apertura se in perdita) · " : intraday ? "⏱ INTRADAY (da chiudere entro la sessione) · " : "";
  const confMeta = { claude: idea.rule ? null : clamp(idea.confidence, 0, 100), rule: idea.rule === true, horizon: overnight ? "overnight" : intraday ? "intraday" : "swing" };

  if (idea.side === "buy") {
    const price = rate.ask;
    const k = await fxOf(d, symbol);
    const target = idea.target_price ?? price * (1 + settings.take_profit_pct / 100);
    const up = upsidePct(target, price);
    const minUp = intraday || overnight ? Math.min(settings.buy_margin_pct, INTRADAY_MIN_UPSIDE_PCT) : settings.buy_margin_pct;
    if (up === null || up < minUp) return { skipped: `upside ${up === null ? "n/d" : up.toFixed(1) + "%"} sotto il margine di acquisto (${minUp}%)` };
    if (c.snap.positions.some((p) => p.instrumentId === id)) return { skipped: "gia' in portafoglio" };
    const stop = idea.stop_price && idea.stop_price < price ? idea.stop_price : price * (1 - (intraday ? Math.min(settings.stop_loss_pct, 1.5) : settings.stop_loss_pct) / 100);
    const size = sizeBuy({ settings, price: price * k, cash: c.snap.cash, investedToday: c.investedAuto, openCount: c.snap.positions.length });
    // in modalita' consulente proponiamo comunque la dimensione ideale; i limiti bloccano solo l'autopilot
    const cashOnly = c.snap.cash === null ? Infinity : Math.max(0, c.snap.cash * 0.98);
    const amount = round2(Math.min(settings.max_position_usd, cashOnly));
    if (amount < MIN_ORDER_USD) return { skipped: size.reasons[0] ?? "giacenza insufficiente" };
    const bl = await confidenceFor(d, symbol, "buy", price, target, stop, idea, settings, null);
    const created = await d.store.createSuggestion({
      symbol, instrument_id: id, side: "buy", units: round4(amount / (price * k)), amount_usd: amount, price_ref: price,
      target_price: round2(target), stop_price: round2(stop), confidence: bl.confidence,
      rationale: `${tag}${idea.rationale}\n${bl.note}`.trim(), sources: refs, origin, expires_at,
    });
    await d.store.kvSet(`conf:${created.id}`, confMeta);
    return { created };
  }

  // vendita: solo titoli in portafoglio
  const held = c.snap.positions.filter((p) => p.instrumentId === id);
  if (!held.length) return { skipped: "non in portafoglio" };
  const units = held.reduce((s, p) => s + (p.unitsEff ?? 0), 0);
  const price = rate.bid;
  const ks = await fxOf(d, symbol);
  const pnlPct = held[0]?.pnlPct ?? null;
  const bs = await confidenceFor(d, symbol, "sell", price, idea.target_price, idea.stop_price, idea, settings, pnlPct);
  const created = await d.store.createSuggestion({
    symbol, instrument_id: id, side: "sell", units: round4(units), amount_usd: round2(units * price * ks), price_ref: price,
    target_price: idea.target_price, stop_price: idea.stop_price, confidence: bs.confidence,
    rationale: `${tag}${idea.rationale}\n${bs.note}`.trim(), sources: refs, origin, expires_at,
  });
  await d.store.kvSet(`conf:${created.id}`, confMeta);
  return { created };
}

/** Fiducia finale di un'idea: dati quantitativi (indicatori salvati) combinati con quella dichiarata da Claude. */
async function confidenceFor(
  d: Deps, symbol: string, side: "buy" | "sell", price: number, target: number | null, stop: number | null,
  idea: RawIdea, settings: Settings, pnlPct: number | null,
) {
  const [analysis, tech, mtf] = await Promise.all([d.store.kvGet<Analysis>(`analysis:${symbol}`), d.store.kvGet<Tech>(`tech:${symbol}`), d.store.kvGet<Mtf>(`mtf:${symbol}`)]);
  const q = quantConfidence({ side, price, target, stop, analysis, tech, mtf, pnlPct, takeProfitPct: settings.take_profit_pct, stopLossPct: settings.stop_loss_pct });
  const ruleOnly = idea.rule === true;
  return blendConfidence(ruleOnly ? null : clamp(idea.confidence, 0, 100), q, ruleOnly);
}

async function proposeCtx(d: Deps, snap: Snapshot, rates: Record<number, Rate>): Promise<ProposeCtx> {
  const now = d.now();
  const settings = await d.store.getSettings();
  const day = romeDay(now);
  const idOf = new Map<string, number>();
  const sm = await symMap(d);
  for (const [id, sym] of Object.entries(sm)) idOf.set(sym, Number(id));
  return {
    settings, snap, rates, day, now, idOf, pending: await d.store.listSuggestions(["pending", "approved"], 100),
    investedAuto: await d.store.investedToday(day, "autopilot"),
  };
}

// ------------------------------------------------------------------ esecuzione
export interface ExecOpts { by: "manual" | "autopilot"; units?: number; amountUsd?: number }
export interface ExecResult { ok: boolean; status: Suggestion["status"]; message: string }

export async function executeSuggestion(d: Deps, id: number, opts: ExecOpts): Promise<ExecResult> {
  const s = await d.store.getSuggestion(id);
  if (!s) return { ok: false, status: "failed", message: "Idea non trovata." };
  if (s.status !== "pending" && s.status !== "approved") return { ok: false, status: s.status, message: `Idea gia' ${s.status}.` };
  const now = d.now();
  if (new Date(s.expires_at).getTime() < now.getTime() && s.status === "pending") {
    await d.store.updateSuggestion(id, { status: "expired" });
    return { ok: false, status: "expired", message: "Idea scaduta: i prezzi non sono piu' attuali." };
  }
  const day = romeDay(now);
  if (!isRegularFor(s.symbol, now)) {
    if (opts.by !== "manual") return { ok: false, status: s.status, message: "Mercato chiuso." };
    await d.store.updateSuggestion(id, { status: "approved", result: { queuedUnits: opts.units ?? null } });
    return { ok: true, status: "approved", message: `Mercato ${marketOf(s.symbol).group === "US" ? "USA" : "europeo"} chiuso: approvata e messa in coda, partira' all'apertura (se il prezzo e' ancora in linea).` };
  }
  try {
    const rate = (await d.etoro.rates([s.instrument_id]))[s.instrument_id];
    if (!rate) throw new Error("prezzo non disponibile");
    const queuedUnits = (s.result as { queuedUnits?: number | null } | null | undefined)?.queuedUnits ?? undefined;
    const units = opts.units ?? queuedUnits;
    const k = await fxOf(d, s.symbol);
    let msg: string;

    if (s.side === "buy") {
      if (Math.abs(rate.ask / s.price_ref - 1) > 0.05) throw new Error(`il prezzo si e' mosso oltre il 5% (${num(s.price_ref, 2)} → ${num(rate.ask, 2)}): rigenera l'idea`);
      const amount = round2(opts.amountUsd ?? (units ? units * rate.ask * k : s.amount_usd));
      if (amount < MIN_ORDER_USD) throw new Error(`importo sotto il minimo di $${MIN_ORDER_USD}`);
      const pf = await d.etoro.portfolio();
      if (pf.cash !== null && amount > pf.cash) throw new Error(`giacenza insufficiente (${usd(pf.cash)})`);
      const open = await d.etoro.openBuy(s.instrument_id, amount);
      await d.store.addTrade({
        day, symbol: s.symbol, instrument_id: s.instrument_id, side: "buy", amount_usd: amount,
        units: round4(amount / ((open.price ?? rate.ask) * k)), price: open.price ?? rate.ask, position_id: open.positionId ?? null,
        origin: opts.by, suggestion_id: id, note: open.positionId ? undefined : "positionId non restituito",
      });
      await rememberSymbol(d, s.instrument_id, s.symbol);
      await d.store.updateSuggestion(id, { status: "executed", executed_at: now.toISOString(), result: { ...open, amount } });
      msg = `Acquisto eseguito (demo): ${s.symbol} per ${usd(amount)} a circa ${fmtPrice(s.symbol, open.price ?? rate.ask)}.`;
    } else {
      const pf = await d.etoro.portfolio();
      const mine = pf.positions.filter((p) => p.isBuy && p.instrumentId === s.instrument_id)
        .sort((a, b) => String(a.openDateTime).localeCompare(String(b.openDateTime)));
      if (!mine.length) throw new Error("nessuna posizione aperta su questo titolo");
      const unitsOf = (p: Position) => p.units ?? (p.openRate > 0 ? p.amount / p.openRate : 0);
      const total = mine.reduce((a, p) => a + unitsOf(p), 0);
      let remaining = Math.min(units ?? s.units, total);
      let closedUnits = 0, pnl = 0;
      for (const p of mine) {
        if (remaining <= 1e-9) break;
        const pu = unitsOf(p);
        const full = remaining >= pu * 0.995;
        await d.etoro.close(p.positionId, p.instrumentId, full ? null : round4(remaining));
        const u = full ? pu : remaining;
        pnl += u * (rate.bid - p.openRate) * k;
        closedUnits += u; remaining -= u;
        await d.store.addTrade({
          day, symbol: s.symbol, instrument_id: s.instrument_id, side: "sell", amount_usd: round2(u * rate.bid * k),
          units: round4(u), price: rate.bid, position_id: p.positionId, origin: opts.by, suggestion_id: id, pnl_usd: round2(u * (rate.bid - p.openRate) * k),
        });
      }
      await d.store.updateSuggestion(id, { status: "executed", executed_at: now.toISOString(), result: { closedUnits, pnl: round2(pnl) } });
      msg = `Vendita eseguita (demo): ${s.symbol}, ${num(closedUnits, 4)} azioni a circa ${fmtPrice(s.symbol, rate.bid)} (P/L ${usd(pnl)}).`;
    }
    await d.store.logEvent("executed", { id, by: opts.by, msg });
    await notify(d, `${opts.by === "autopilot" ? "🤖 Autopilot: " : "✅ "}${esc(msg)}`);
    return { ok: true, status: "executed", message: msg };
  } catch (e) {
    const err = (e as Error).message;
    await d.store.updateSuggestion(id, { status: "failed", result: { error: err } });
    await d.store.logEvent("exec_error", { id, error: err });
    await notify(d, `⚠️ Operazione non eseguita (${esc(s.symbol)}): ${esc(err)}`);
    return { ok: false, status: "failed", message: err };
  }
}

export async function rejectSuggestion(d: Deps, id: number): Promise<ExecResult> {
  const s = await d.store.getSuggestion(id);
  if (!s) return { ok: false, status: "failed", message: "Idea non trovata." };
  if (s.status !== "pending" && s.status !== "approved") return { ok: false, status: s.status, message: `Idea gia' ${s.status}.` };
  await d.store.updateSuggestion(id, { status: "rejected" });
  return { ok: true, status: "rejected", message: "Idea rifiutata." };
}

/** Chiusura manuale/automatica diretta di un titolo (senza passare da un'idea). */
export class MarketClosedError extends Error {}

/** Acquisto manuale (es. dalla pagina Analisi): a mercato aperto, senza i limiti dell'autopilot ma entro la giacenza. */
export async function buyManual(d: Deps, symbol: string, units: number): Promise<string> {
  const w = (await d.store.listWatchlist()).find((x) => x.symbol === symbol);
  if (!w) throw new Error("titolo non presente in watchlist");
  if (!(units > 0) || !Number.isFinite(units)) throw new Error("numero di azioni non valido");
  const now = d.now();
  if (!isRegularFor(symbol, now)) throw new MarketClosedError(`Mercato ${marketOf(symbol).group === "US" ? "USA" : "europeo"} chiuso: l'acquisto e' possibile solo a mercato aperto.`);
  const rate = (await d.etoro.rates([w.instrument_id]))[w.instrument_id];
  if (!rate) throw new Error("prezzo non disponibile");
  const k = await fxOf(d, symbol);
  const amount = round2(units * rate.ask * k);
  if (amount < MIN_ORDER_USD) throw new Error(`importo sotto il minimo di $${MIN_ORDER_USD}`);
  const pf = await d.etoro.portfolio();
  if (pf.cash !== null && amount > pf.cash) throw new Error(`giacenza insufficiente (${usd(pf.cash)})`);
  const open = await d.etoro.openBuy(w.instrument_id, amount);
  await d.store.addTrade({
    day: romeDay(now), symbol, instrument_id: w.instrument_id, side: "buy", amount_usd: amount,
    units: round4(amount / ((open.price ?? rate.ask) * k)), price: open.price ?? rate.ask, position_id: open.positionId ?? null,
    origin: "manual", suggestion_id: null, note: open.positionId ? "acquisto manuale da Analisi" : "acquisto manuale da Analisi; positionId non restituito",
  });
  await rememberSymbol(d, w.instrument_id, symbol);
  const msg = `Acquisto eseguito (demo): ${symbol} per ${usd(amount)} a circa ${fmtPrice(symbol, open.price ?? rate.ask)}.`;
  await d.store.logEvent("executed", { by: "manual", symbol, msg });
  await notify(d, `✅ ${esc(msg)}`);
  return msg;
}

export async function closeSymbol(d: Deps, instrumentId: number, units: number | null, by: "manual" | "autopilot", note: string): Promise<string> {
  const now = d.now();
  const day = romeDay(now);
  const rate = (await d.etoro.rates([instrumentId]))[instrumentId];
  if (!rate) throw new Error("prezzo non disponibile");
  const pf = await d.etoro.portfolio();
  const sm = await symMap(d);
  const known = sm[String(instrumentId)];
  const symbol = known ?? `ID ${instrumentId}`;
  // controllo di mercato sul listino del titolo (USA o europeo); se il simbolo non e' noto decide eToro
  if (known && !isRegularFor(known, now)) throw new MarketClosedError(`Mercato ${marketOf(known).group === "US" ? "USA" : "europeo"} chiuso: la vendita e' possibile solo a mercato aperto.`);
  const k = await fxOf(d, symbol);
  const mine = pf.positions.filter((p) => p.isBuy && p.instrumentId === instrumentId)
    .sort((a, b) => String(a.openDateTime).localeCompare(String(b.openDateTime)));
  if (!mine.length) throw new Error("nessuna posizione aperta su questo titolo");
  const unitsOf = (p: Position) => p.units ?? (p.openRate > 0 ? p.amount / p.openRate : 0);
  let remaining = units === null ? Infinity : units;
  let pnl = 0, closed = 0;
  for (const p of mine) {
    if (remaining <= 1e-9) break;
    const pu = unitsOf(p);
    const full = remaining >= pu * 0.995;
    await d.etoro.close(p.positionId, p.instrumentId, full ? null : round4(remaining));
    const u = full ? pu : remaining;
    pnl += u * (rate.bid - p.openRate) * k; closed += u; remaining -= u;
    await d.store.addTrade({
      day, symbol, instrument_id: instrumentId, side: "sell", amount_usd: round2(u * rate.bid * k), units: round4(u), price: rate.bid,
      position_id: p.positionId, origin: by, suggestion_id: null, note, pnl_usd: round2(u * (rate.bid - p.openRate) * k),
    });
  }
  return `${symbol}: chiuse ${num(closed, 4)} azioni a circa ${fmtPrice(symbol, rate.bid)} (P/L ${usd(pnl)}) — ${note}`;
}

// ------------------------------------------------------------------ monitoraggio soglie
export async function monitorPositions(d: Deps, snap: Snapshot): Promise<string[]> {
  const settings = await d.store.getSettings();
  const day = romeDay(d.now());
  const auto = settings.mode === "autopilot" && !settings.kill_switch;
  const done: string[] = [];
  const pending = await d.store.listSuggestions(["pending", "approved"], 100);
  for (const p of snap.positions) {
    if (p.bid === null || !isRegularFor(p.symbol, d.now())) continue;
    const why = exitDecision(p.openRate, p.bid, settings);
    if (!why) continue;
    const label = why === "stop_loss" ? `soglia di perdita -${settings.stop_loss_pct}%` : `soglia di guadagno +${settings.take_profit_pct}%`;
    if (auto) {
      if (!(await once(d, `exit:${p.positionId}:${why}`))) continue;
      try {
        const msg = await closeSymbol(d, p.instrumentId, null, "autopilot", label);
        done.push(msg);
        await d.store.logEvent("auto_exit", { msg });
        await notify(d, `🤖 Autopilot — ${why === "stop_loss" ? "🛑" : "🎯"} ${esc(msg)}`);
      } catch (e) {
        await d.store.logEvent("exit_error", { symbol: p.symbol, error: (e as Error).message });
        await notify(d, `⚠️ Autopilot: chiusura di ${esc(p.symbol)} non riuscita: ${esc((e as Error).message)}`);
      }
    } else {
      if (pending.some((x) => x.symbol === p.symbol && x.side === "sell")) continue;
      if (!(await once(d, `exitalert:${p.symbol}:${why}:${day}`))) continue;
      const created = await d.store.createSuggestion({
        symbol: p.symbol, instrument_id: p.instrumentId, side: "sell", units: round4(p.unitsEff ?? 0), amount_usd: round2(p.value ?? 0),
        price_ref: p.bid, target_price: null, stop_price: null, confidence: 90,
        rationale: `${p.symbol} ha raggiunto la ${label} (P/L ${pct(p.pnlPct)}).`, sources: [], origin: "monitor",
        expires_at: new Date(d.now().getTime() + 8 * 3600_000).toISOString(),
      });
      done.push(`idea vendita #${created.id} ${p.symbol}`);
      await notify(d, suggestionHtml(created, why === "stop_loss" ? "🛑 Soglia di perdita raggiunta" : "🎯 Soglia di guadagno raggiunta"), buttonsFor(created));
    }
  }
  return done;
}

// ------------------------------------------------------------------ situazioni favorevoli (regole, senza costi IA)
export async function favorableSweep(d: Deps, snap: Snapshot): Promise<string[]> {
  const out: string[] = [];
  const watch = (await d.store.listWatchlist()).filter((w) => w.active && isRegularFor(w.symbol, d.now()));
  if (!watch.length) return out;
  const rates = await d.etoro.rates(watch.map((w) => w.instrument_id));
  const c = await proposeCtx(d, snap, rates);
  for (const w of watch) {
    const r = rates[w.instrument_id];
    if (!r) continue;
    let tech = await d.store.kvGet<Tech>(`tech:${w.symbol}`);
    if (!tech || d.now().getTime() - new Date(tech.asOf).getTime() > TECH_TTL_MS) {
      try { tech = (await refreshTech(d, w.symbol, w.instrument_id, r.ask))?.tech ?? tech; }
      catch (e) { await d.store.logEvent("tech_refresh_error", { symbol: w.symbol, error: (e as Error).message }); }
    }
    const a = await d.store.kvGet<Analysis>(`analysis:${w.symbol}`);
    if (!a) continue;
    const holding = snap.positions.some((p) => p.instrumentId === w.instrument_id);
    if (!holding && tech?.signals.verdict !== "sell" && favorableBuy(a, r.ask) && (await once(d, `fav:${w.symbol}:${c.day}`))) {
      const idea: RawIdea = {
        symbol: w.symbol, side: "buy", confidence: 50, rule: true, target_price: r.ask * (1 + c.settings.take_profit_pct / 100), stop_price: null, source_urls: [],
        rationale: `Segnale tecnico: trend rialzista, ritracciamento vicino alla media a 20 giorni (RSI ${a.rsi14?.toFixed(0)}). Idea generata da regole, non da analisi di notizie.`,
      };
      const res = await proposeIdea(d, c, idea, [], "monitor");
      if (res.created) {
        out.push(`favorevole ${w.symbol}`);
        await notify(d, suggestionHtml(res.created, "⚡ Situazione favorevole rilevata"), buttonsFor(res.created));
      }
    } else if (holding && favorableSell(a, r.bid) && (await once(d, `weak:${w.symbol}:${c.day}`))) {
      const idea: RawIdea = {
        symbol: w.symbol, side: "sell", confidence: 50, rule: true, target_price: null, stop_price: null, source_urls: [],
        rationale: `Segnale tecnico di debolezza su ${w.symbol} (prezzo sotto la media a 20 giorni o RSI molto alto). Regola automatica.`,
      };
      const res = await proposeIdea(d, c, idea, [], "monitor");
      if (res.created) {
        out.push(`debolezza ${w.symbol}`);
        await notify(d, suggestionHtml(res.created, "⚠️ Segnale di debolezza"), buttonsFor(res.created));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ scansione completa
export interface ScanSummary { slot: string; summary: string; created: Suggestion[]; skipped: Array<{ symbol: string; reason: string }>; usedClaude: boolean }

export async function runScan(d: Deps, slot: string): Promise<ScanSummary> {
  const now = d.now();
  const settings = await d.store.getSettings();
  const scope: Group = scopeOfSlot(slot);
  const sess = scope === "EU" ? euSessionOf(now) : sessionOf(now);
  const watch = (await d.store.listWatchlist()).filter((w) => w.active && marketOf(w.symbol).group === scope);
  const snap = await snapshot(d);
  const ids = [...new Set([...watch.map((w) => w.instrument_id), ...snap.positions.map((p) => p.instrumentId)])];
  const rates = ids.length ? await d.etoro.rates(ids) : {};

  const rows: QuantRow[] = [];
  await mapLimit(watch, 3, async (w) => {
    try {
      const price0 = rates[w.instrument_id]?.ask ?? null;
      const got = await refreshTech(d, w.symbol, w.instrument_id, price0);
      if (!got) return;
      const { a, tech, mtf } = got;
      const price = price0 ?? a.last;
      rows.push({ symbol: w.symbol, price, lastClose: a.last, gapPct: (price / a.last - 1) * 100, trend: a.trend, rsi14: a.rsi14,
        sma20: a.sma20, sma50: a.sma50, mom20Pct: a.mom20Pct, score: a.score, tech: techRow(tech), ...mtfRow(mtf) });
    } catch (e) { await d.store.logEvent("scan_symbol_error", { symbol: w.symbol, error: (e as Error).message }); }
  });
  rows.sort((a, b) => b.score - a.score);

  const held: HeldRow[] = snap.positions.filter((p) => marketOf(p.symbol).group === scope).map((p) => ({ symbol: p.symbol, units: p.unitsEff, openRate: p.openRate, price: p.bid, pnlPct: p.pnlPct }));
  let ideas: RawIdea[] = [];
  let summary = "";
  let sources: SourceRef[] = [];
  let usedClaude = false;

  const paused = await d.store.kvGet<{ until: string }>("claude_pause");
  if (d.claude.enabled && !(paused && new Date(paused.until).getTime() > now.getTime())) {
    try {
      const res = await d.claude.analyze({
        nowIso: now.toISOString(), scope, session: sess.session, premarket: isPremarketSlot(slot), allowDiscovery: settings.allow_discovery,
        limits: { buyMarginPct: settings.buy_margin_pct, takeProfitPct: settings.take_profit_pct, stopLossPct: settings.stop_loss_pct, maxPositionUsd: settings.max_position_usd },
        cash: snap.cash, held, watchlist: rows,
      });
      ideas = res.ideas; summary = res.summary; sources = res.sources; usedClaude = true;
    } catch (e) {
      await onClaudeError(d, e, now);
    }
  }
  if (!usedClaude) {
    for (const r of rows.filter((x) => x.trend === "up" && x.rsi14 !== null && x.rsi14 < 60 && x.score >= 3 && x.tech?.votes.verdict !== "sell").slice(0, 3)) {
      ideas.push({ symbol: r.symbol, side: "buy", confidence: 50, rule: true, target_price: r.price * (1 + settings.take_profit_pct / 100), stop_price: null, source_urls: [],
        rationale: `Segnale tecnico (trend rialzista, RSI ${r.rsi14?.toFixed(0)}, momentum 20g ${pct(r.mom20Pct)}). Regola automatica.` });
    }
    for (const p of snap.positions.filter((x) => marketOf(x.symbol).group === scope)) {
      const a = await d.store.kvGet<Analysis>(`analysis:${p.symbol}`);
      if (a && p.bid && favorableSell(a, p.bid)) ideas.push({ symbol: p.symbol, side: "sell", confidence: 50, rule: true, target_price: null, stop_price: null, source_urls: [],
        rationale: "Segnale tecnico di debolezza. Regola automatica." });
    }
  }

  const c = await proposeCtx(d, snap, rates);
  const created: Suggestion[] = [];
  const skipped: ScanSummary["skipped"] = [];
  for (const idea of ideas) {
    try {
      const res = await proposeIdea(d, c, idea, sources, "scan");
      if (res.created) { created.push(res.created); c.pending.push(res.created); }
      else skipped.push({ symbol: idea.symbol, reason: res.skipped ?? "scartata" });
    } catch (e) { skipped.push({ symbol: idea.symbol, reason: (e as Error).message }); }
  }
  await d.store.kvSet("last_scan", { slot, ts: now.toISOString(), created: created.length, skipped, summary, usedClaude });
  await d.store.logEvent("scan", { slot, created: created.map((s) => `${s.side} ${s.symbol}`), skipped, usedClaude });

  if (created.length) {
    const head = `${isPremarketSlot(slot) ? (scope === "EU" ? "🌅 PRE-APERTURA EUROPA" : "🌅 PREMARKET USA") : scope === "EU" ? "📊 Scansione Europa" : "📊 Scansione USA"} ${scope === "EU" ? euLabel(now) : etLabel(now)}${summary ? `\n${esc(summary)}` : ""}\n${created.length} idee nuove${usedClaude ? "" : " (solo regole tecniche)"}.`;
    await notify(d, head);
    for (const s of created.slice(0, 6)) await notify(d, suggestionHtml(s), buttonsFor(s));
  }
  return { slot, summary, created, skipped, usedClaude };
}

/** Errore dell'analisi Claude: se e' di credito/chiave sospende le chiamate per 1 ora con un solo avviso, altrimenti avvisa. */
async function onClaudeError(d: Deps, e: unknown, now: Date) {
  const msg = (e as Error).message;
  await d.store.logEvent("claude_error", { error: msg });
  const billing = /credit balance|billing|invalid x-api-key|authentication/i.test(msg);
  if (billing) {
    await d.store.kvSet("claude_pause", { until: new Date(now.getTime() + 60 * 60_000).toISOString() });
    if (await once(d, `claude_billing:${romeDay(now)}:${Math.floor(now.getTime() / (6 * 3600_000))}`))
      await notify(d, "⚠️ Analisi Claude sospesa: credito Anthropic esaurito o chiave non valida. Ricarica su console.anthropic.com → Plans & Billing. Intanto l'app usa solo le regole tecniche e riprova ogni ora.");
  } else await notify(d, `⚠️ Analisi Claude non riuscita (${esc(msg.slice(0, 150))}): uso solo le regole tecniche.`);
}

// ------------------------------------------------------------------ filtri di trend intraday (Supertrend + EMA 9/50)
const ENTRY_FRAMES = [
  { frame: "10m", interval: "TenMinutes", sec: 600 }, { frame: "15m", interval: "FifteenMinutes", sec: 900 }, { frame: "30m", interval: "ThirtyMinutes", sec: 1800 },
];
const EXIT_FRAMES = [
  { frame: "1m", interval: "OneMinute", sec: 60 }, { frame: "5m", interval: "FiveMinutes", sec: 300 }, { frame: "10m", interval: "TenMinutes", sec: 600 },
];

async function trendStates(d: Deps, symbol: string, id: number, live: number, frames: typeof ENTRY_FRAMES): Promise<Array<{ frame: string; st: TrendState | null }>> {
  const now = d.now();
  return Promise.all(frames.map(async (f) => {
    try {
      const raw = await d.etoro.candles(id, f.interval, 150);
      return { frame: f.frame, st: trendState(dropIncomplete(raw, f.sec, now), live, now.toISOString()) };
    } catch (e) {
      await d.store.logEvent("trend_error", { symbol, frame: f.frame, error: (e as Error).message });
      return { frame: f.frame, st: null };
    }
  }));
}

const trendText = (r: Array<{ frame: string; st: TrendState | null }>) =>
  r.map((x) => `${x.frame} ${x.st ? `ST${x.st.supertrend === "up" ? "▲" : "▼"} EMA${x.st.emaTrend === "up" ? "▲" : "▼"}` : "n/d"}`).join(", ");

/** Prima di comprare: Supertrend ed EMA 9/50 devono essere rialzisti (e nessun giudizio di vendita) su 10, 15 e 30 minuti. Senza dati non si compra. */
export async function entryTrendCheck(d: Deps, symbol: string, id: number, live: number): Promise<{ ok: boolean; why: string }> {
  const r = await trendStates(d, symbol, id, live, ENTRY_FRAMES);
  return { ok: r.every((x) => x.st?.bullish === true), why: trendText(r) };
}

interface OvernightTag { instrumentId: number; symbol: string; day: string; amount: number }

// ------------------------------------------------------------------ guardia ogni minuto (solo autopilot)
/**
 * Controllo leggero delle posizioni aperte, chiamato ogni minuto da pg_cron:
 *  1) acquisti "overnight": alla prima sessione successiva, se la posizione e' in perdita si vende subito;
 *  2) soglie di perdita/guadagno (stop-loss);
 *  3) con profitto >= soglia ($) si chiude se il trend e' ribassista (Supertrend, EMA 9/50, indicatori) su 1, 5 e 10 minuti.
 */
export async function guardPositions(d: Deps): Promise<string[]> {
  const settings = await d.store.getSettings();
  if (settings.mode !== "autopilot" || settings.kill_switch) return [];
  const now = d.now();
  const lock = await d.store.kvGet<{ ts: string }>("guard_lock");
  if (lock && now.getTime() - new Date(lock.ts).getTime() < 50_000) return [];
  const out: string[] = [];
  await d.store.kvSet("guard_lock", { ts: now.toISOString() });
  try {
    let snap = await snapshot(d);
    if (!snap.positions.some((p) => p.bid !== null && isRegularFor(p.symbol, now))) return out;

    // 1) overnight: decisione alla prima sessione dopo l'acquisto
    const tags = (await d.store.kvGet<OvernightTag[]>("overnight")) ?? [];
    if (tags.length) {
      const keep: OvernightTag[] = [];
      for (const t of tags) {
        const p = snap.positions.find((x) => x.instrumentId === t.instrumentId);
        if (!p) continue; // posizione chiusa nel frattempo
        const sess = sessionFor(t.symbol, now);
        if (sess.session !== "regular" || sess.day <= t.day) { keep.push(t); continue; }
        if (p.pnl !== null && p.pnl < 0) {
          try {
            const msg = await closeSymbol(d, p.instrumentId, null, "autopilot", "apertura in perdita dopo l'acquisto overnight");
            out.push(msg); await d.store.logEvent("auto_exit", { msg });
            await notify(d, `🤖 Autopilot — 🌅 ${esc(msg)}`);
          } catch (e) { keep.push(t); await d.store.logEvent("exit_error", { symbol: t.symbol, error: (e as Error).message }); }
        } else await notify(d, `🌅 ${esc(t.symbol)}: apertura in guadagno dopo l'acquisto overnight (P/L ${usd(p.pnl)}). Da ora vale la gestione normale.`);
      }
      await d.store.kvSet("overnight", keep);
      if (out.length) snap = await snapshot(d);
    }

    // 2) soglie di perdita / guadagno
    const m = await monitorPositions(d, snap);
    if (m.length) { out.push(...m); snap = await snapshot(d); }

    // 2b) rotazione: vendita al +N%
    const rt = await rotationTakeProfit(d, snap);
    if (rt.length) { out.push(...rt); snap = await snapshot(d); }

    // 3) uscita su trend ribassista a 1/5/10 minuti, con profitto minimo
    const minProfit = settings.trend_exit_min_profit_usd;
    for (const p of snap.positions) {
      if (p.bid === null || p.pnl === null || !isRegularFor(p.symbol, now) || p.pnl < minProfit) continue;
      const r = await trendStates(d, p.symbol, p.instrumentId, p.bid, EXIT_FRAMES);
      if (!r.every((x) => x.st?.bearish === true)) continue;
      try {
        const msg = await closeSymbol(d, p.instrumentId, null, "autopilot", `trend ribassista (${trendText(r)}) con profitto ${usd(p.pnl)}`);
        out.push(msg); await d.store.logEvent("auto_exit", { msg });
        await notify(d, `🤖 Autopilot — 📉 ${esc(msg)}`);
      } catch (e) { await d.store.logEvent("exit_error", { symbol: p.symbol, error: (e as Error).message }); }
    }
  } finally {
    await d.store.kvSet("guard_lock", { ts: new Date(0).toISOString() });
  }
  return out;
}

// ------------------------------------------------------------------ rotazione: i migliori titoli "acquisto" dell'Analisi, venduti al +N%
interface RotationTag { instrumentId: number; symbol: string; day: string }

/** Titoli con giudizio "acquisto" nella scheda Analisi, in ordine di potenzialita' (lo stesso ordine della pagina). */
export async function rankedBuys(d: Deps, group?: Group): Promise<Array<{ symbol: string; instrument_id: number; score: number; tech: Tech }>> {
  const out: Array<{ symbol: string; instrument_id: number; score: number; tech: Tech }> = [];
  for (const w of (await d.store.listWatchlist()).filter((x) => x.active && (!group || marketOf(x.symbol).group === group))) {
    const [tech, mtf] = await Promise.all([d.store.kvGet<Tech>(`tech:${w.symbol}`), d.store.kvGet<Mtf>(`mtf:${w.symbol}`)]);
    if (tech && tech.signals.verdict === "buy") out.push({ symbol: w.symbol, instrument_id: w.instrument_id, score: potentialScore(tech, mtf), tech });
  }
  return out.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}

/**
 * Ciclo di rotazione (ogni `rotation_interval_min` minuti): tra i titoli con giudizio "acquisto" dell'Analisi sui mercati aperti
 * compra i primi N per potenzialita' (se non gia' in portafoglio e, se attivo, con trend 10/15/30m rialzista) e avvisa su Telegram.
 */
export async function runRotation(d: Deps): Promise<string[]> {
  const settings = await d.store.getSettings();
  if (!settings.rotation_enabled || settings.mode !== "autopilot" || settings.kill_switch) return [];
  const now = d.now();
  const open = (["US", "EU"] as const).filter((g) => (g === "US" ? sessionOf(now) : euSessionOf(now)).session === "regular");
  if (!open.length) return [];
  const bucket = Math.floor(now.getTime() / (settings.rotation_interval_min * 60_000));
  if (!(await once(d, `rotation:${bucket}`))) return [];

  const ranked = (await rankedBuys(d)).filter((r) => open.includes(marketOf(r.symbol).group));
  const top = settings.rotation_count > 0 ? ranked.slice(0, settings.rotation_count) : ranked; // 0 = tutti i titoli con giudizio acquisto
  if (!top.length) { await d.store.logEvent("rotation", { bought: [], note: "nessun titolo con giudizio acquisto" }); return []; }
  const snap = await snapshot(d);
  const rates = await d.etoro.rates(top.map((t) => t.instrument_id));
  const day = romeDay(now);
  const tags = (await d.store.kvGet<RotationTag[]>("rotation")) ?? [];
  const lines: string[] = [], skipped: string[] = [], bought: string[] = [];
  let investedToday = await d.store.investedToday(day, "autopilot");

  for (const r of top) {
    const skip = (why: string) => skipped.push(`${r.symbol}: ${why}`);
    if (now.getTime() - new Date(r.tech.asOf).getTime() > 45 * 60_000) { skip("dati tecnici non aggiornati"); continue; }
    if (snap.positions.some((p) => p.instrumentId === r.instrument_id)) { skip("gia' in portafoglio"); continue; }
    const rate = rates[r.instrument_id];
    if (!rate) { skip("prezzo non disponibile"); continue; }
    try {
      if (settings.rotation_trend_filter) {
        const gate = await entryTrendCheck(d, r.symbol, r.instrument_id, rate.ask);
        if (!gate.ok) { skip(`trend 10/15/30m non rialzista (${gate.why})`); continue; }
      }
      const k = await fxOf(d, r.symbol);
      const size = sizeBuy({ settings, price: rate.ask * k, cash: snap.cash, investedToday, openCount: snap.positions.length });
      if (size.reasons.length) { skip(size.reasons.join("; ")); continue; }
      const open_ = await d.etoro.openBuy(r.instrument_id, size.amount);
      const price = open_.price ?? rate.ask;
      await d.store.addTrade({
        day, symbol: r.symbol, instrument_id: r.instrument_id, side: "buy", amount_usd: size.amount, units: round4(size.amount / (price * k)), price,
        position_id: open_.positionId ?? null, origin: "autopilot", suggestion_id: null, note: `rotazione: acquisto, vendita al +${settings.rotation_target_pct}%`,
      });
      await rememberSymbol(d, r.instrument_id, r.symbol);
      tags.push({ instrumentId: r.instrument_id, symbol: r.symbol, day });
      snap.positions.push({ positionId: open_.positionId ?? "tmp", instrumentId: r.instrument_id, openRate: price, amount: size.amount, units: null, isBuy: true, symbol: r.symbol, bid: rate.bid, unitsEff: null, value: size.amount, pnl: 0, pnlPct: 0 });
      if (snap.cash !== null) snap.cash -= size.amount;
      investedToday += size.amount;
      bought.push(r.symbol);
      lines.push(`🟢 ${esc(r.symbol)} ${usd(size.amount)} a ${fmtPrice(r.symbol, price)}`);
    } catch (e) { skip((e as Error).message); await d.store.logEvent("rotation_error", { symbol: r.symbol, error: (e as Error).message }); }
  }
  await d.store.kvSet("rotation", tags);
  await d.store.logEvent("rotation", { bought, skipped });
  if (lines.length || skipped.length) {
    await notify(d, `🔁 <b>Rotazione ${settings.rotation_count > 0 ? `top ${settings.rotation_count}` : "tutti i titoli in acquisto"}</b> — vendita al +${settings.rotation_target_pct}%\n${lines.length ? `Acquisti:\n${lines.join("\n")}` : "Nessun acquisto."}${skipped.length ? `\nSaltati:\n${skipped.map(esc).join("\n")}` : ""}`);
  }
  return bought.map((s) => `rotazione: acquisto ${s}`);
}

/** Vende le posizioni della rotazione che hanno raggiunto il guadagno obiettivo; elimina i marcatori delle posizioni gia' chiuse. */
async function rotationTakeProfit(d: Deps, snap: Snapshot): Promise<string[]> {
  const settings = await d.store.getSettings();
  const tags = (await d.store.kvGet<RotationTag[]>("rotation")) ?? [];
  if (!tags.length) return [];
  const now = d.now();
  const out: string[] = [], keep: RotationTag[] = [];
  for (const t of tags) {
    const p = snap.positions.find((x) => x.instrumentId === t.instrumentId);
    if (!p) continue;
    if (p.pnlPct === null || p.pnlPct < settings.rotation_target_pct || !isRegularFor(p.symbol, now)) { keep.push(t); continue; }
    try {
      const msg = await closeSymbol(d, p.instrumentId, null, "autopilot", `rotazione: guadagno +${settings.rotation_target_pct}% raggiunto`);
      out.push(msg); await d.store.logEvent("auto_exit", { msg });
      await notify(d, `🔁 💰 <b>Venduto</b> ${esc(msg)}`);
    } catch (e) { keep.push(t); await d.store.logEvent("exit_error", { symbol: p.symbol, error: (e as Error).message }); }
  }
  await d.store.kvSet("rotation", keep);
  return out;
}

// ------------------------------------------------------------------ catalizzatori: acquisti prima della chiusura su notizie attese
/** Mercati in finestra per la scansione catalizzatori (circa 20-50 minuti prima della chiusura), solo se domani si negozia. */
export function catalystScopes(d: Deps, settings: Settings): Group[] {
  if (settings.max_overnight_usd <= 0 || !d.claude.enabled || !d.claude.catalysts) return [];
  const now = d.now();
  const out: Group[] = [];
  const us = sessionOf(now);
  if (us.session === "regular" && us.minutes >= 15 * 60 + 10 && us.minutes < 15 * 60 + 40 && nextDayTrades("US", now)) out.push("US");
  const eu = euSessionOf(now);
  if (eu.session === "regular" && eu.minutes >= 16 * 60 + 40 && eu.minutes < 17 * 60 + 10 && nextDayTrades("EU", now)) out.push("EU");
  return out;
}

export async function runCatalystScan(d: Deps, scope: Group): Promise<string> {
  const now = d.now();
  const settings = await d.store.getSettings();
  if (!d.claude.enabled || !d.claude.catalysts) return "Claude non attivo";
  const paused = await d.store.kvGet<{ until: string }>("claude_pause");
  if (paused && new Date(paused.until).getTime() > now.getTime()) return "Claude in pausa";
  const watch = (await d.store.listWatchlist()).filter((w) => w.active && marketOf(w.symbol).group === scope);
  const snap = await snapshot(d);
  const ids = [...new Set([...watch.map((w) => w.instrument_id), ...snap.positions.map((p) => p.instrumentId)])];
  const rates = ids.length ? await d.etoro.rates(ids) : {};
  const rows: QuantRow[] = [];
  for (const w of watch) {
    const [a, tech, mtf] = await Promise.all([d.store.kvGet<Analysis>(`analysis:${w.symbol}`), d.store.kvGet<Tech>(`tech:${w.symbol}`), d.store.kvGet<Mtf>(`mtf:${w.symbol}`)]);
    if (!a) continue;
    const price = rates[w.instrument_id]?.ask ?? a.last;
    rows.push({ symbol: w.symbol, price, lastClose: a.last, gapPct: (price / a.last - 1) * 100, trend: a.trend, rsi14: a.rsi14, sma20: a.sma20, sma50: a.sma50,
      mom20Pct: a.mom20Pct, score: a.score, tech: techRow(tech), ...mtfRow(mtf) });
  }
  const held: HeldRow[] = snap.positions.filter((p) => marketOf(p.symbol).group === scope).map((p) => ({ symbol: p.symbol, units: p.unitsEff, openRate: p.openRate, price: p.bid, pnlPct: p.pnlPct }));
  let res;
  try {
    res = await d.claude.catalysts!({
      nowIso: now.toISOString(), scope, session: "regular", premarket: false, allowDiscovery: false,
      limits: { buyMarginPct: settings.buy_margin_pct, takeProfitPct: settings.take_profit_pct, stopLossPct: settings.stop_loss_pct, maxPositionUsd: settings.max_position_usd },
      cash: snap.cash, held, watchlist: rows, nextSession: new Date(now.getTime() + 24 * 3600_000).toISOString().slice(0, 10),
    });
  } catch (e) { await onClaudeError(d, e, now); return "analisi non riuscita"; }

  const c = await proposeCtx(d, snap, rates);
  const created: Suggestion[] = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];
  for (const idea of res.ideas.filter((i) => i.side === "buy")) {
    try {
      const r = await proposeIdea(d, c, { ...idea, horizon: "overnight" }, res.sources, "scan");
      if (r.created) { created.push(r.created); c.pending.push(r.created); } else skipped.push({ symbol: idea.symbol, reason: r.skipped ?? "scartata" });
    } catch (e) { skipped.push({ symbol: idea.symbol, reason: (e as Error).message }); }
  }
  await d.store.logEvent("catalyst_scan", { scope, created: created.map((s) => s.symbol), skipped, summary: res.summary });
  if (created.length) {
    await notify(d, `🌙 Catalizzatori ${scope === "EU" ? "Europa" : "USA"}${res.summary ? `\n${esc(res.summary)}` : ""}\n${created.length} idee overnight (acquisto prima della chiusura).`);
    for (const s of created) await notify(d, suggestionHtml(s), buttonsFor(s));
  }
  return `${created.length} idee overnight`;
}

// ------------------------------------------------------------------ autopilot
export async function autopilotSweep(d: Deps): Promise<string[]> {
  const settings = await d.store.getSettings();
  const out: string[] = [];
  if (settings.mode !== "autopilot" || settings.kill_switch) return out;
  const now = d.now();
  const day = romeDay(now);
  const pending = (await d.store.listSuggestions(["pending"], 100)).filter((s) => isRegularFor(s.symbol, now)).sort((a, b) => b.confidence - a.confidence);
  if (!pending.length) return out;
  const snap = await snapshot(d);
  const rates = await d.etoro.rates([...new Set(pending.map((s) => s.instrument_id))]);

  for (const s of pending) {
    if (new Date(s.expires_at).getTime() < now.getTime()) { await d.store.updateSuggestion(s.id, { status: "expired" }); continue; }
    const r = rates[s.instrument_id];
    const skip = async (why: string) => {
      if (await once(d, `autoskip:${s.id}:${day}`)) await d.store.logEvent("auto_skip", { id: s.id, symbol: s.symbol, why });
    };
    if (!r) { await skip("prezzo non disponibile"); continue; }
    const meta = await d.store.kvGet<{ horizon?: string }>(`conf:${s.id}`);
    const overnight = meta?.horizon === "overnight";
    const shortTerm = overnight || meta?.horizon === "intraday";
    if (s.side === "buy") {
      const price = r.ask;
      const k = await fxOf(d, s.symbol);
      if (s.confidence < settings.min_confidence) { await skip(`fiducia ${s.confidence} < ${settings.min_confidence}`); continue; }
      if (Math.abs(price / s.price_ref - 1) > 0.03) { await skip("prezzo cambiato oltre il 3% dal suggerimento"); continue; }
      const up = upsidePct(s.target_price, price);
      const minUp = shortTerm ? Math.min(settings.buy_margin_pct, INTRADAY_MIN_UPSIDE_PCT) : settings.buy_margin_pct;
      if (up === null || up < minUp) { await skip(`upside ${up === null ? "n/d" : up.toFixed(1) + "%"} sotto il margine`); continue; }
      if (snap.positions.some((p) => p.instrumentId === s.instrument_id)) { await skip("gia' in portafoglio"); continue; }
      if (overnight) {
        // acquisto prima della chiusura su notizia attesa: mai prima di un fine settimana o di un festivo, con tetto di esposizione
        const m = marketOf(s.symbol);
        if (!nextDayTrades(m.group, now, m.currency === "CHF")) { await skip("overnight: la sessione successiva non e' domani (weekend/festivo)"); continue; }
        const tags = (await d.store.kvGet<OvernightTag[]>("overnight")) ?? [];
        const exposed = tags.reduce((a, t) => a + t.amount, 0);
        if (settings.max_overnight_usd <= 0 || exposed + Math.min(settings.max_position_usd, s.amount_usd) > settings.max_overnight_usd) { await skip("tetto di esposizione overnight raggiunto"); continue; }
      } else {
        const gate = await entryTrendCheck(d, s.symbol, s.instrument_id, price);
        if (!gate.ok) { await skip(`trend 10/15/30m non rialzista (${gate.why})`); continue; }
      }
      const size = sizeBuy({ settings, price: price * k, cash: snap.cash, investedToday: await d.store.investedToday(day, "autopilot"), openCount: snap.positions.length });
      if (size.reasons.length) { await skip(size.reasons.join("; ")); continue; }
      const amount = Math.min(size.amount, s.amount_usd);
      if (amount < MIN_ORDER_USD) { await skip("importo sotto il minimo"); continue; }
      const res = await executeSuggestion(d, s.id, { by: "autopilot", amountUsd: amount });
      out.push(`${s.symbol}: ${res.message}`);
      if (res.ok && overnight) {
        const tags = (await d.store.kvGet<OvernightTag[]>("overnight")) ?? [];
        tags.push({ instrumentId: s.instrument_id, symbol: s.symbol, day: sessionFor(s.symbol, now).day, amount });
        await d.store.kvSet("overnight", tags);
      }
      if (res.ok) snap.positions.push({ positionId: "tmp", instrumentId: s.instrument_id, openRate: price, amount, units: null, isBuy: true, symbol: s.symbol, bid: price, unitsEff: null, value: amount, pnl: 0, pnlPct: 0 });
    } else if (settings.auto_follow_sell_ideas || s.origin === "monitor") {
      if (s.confidence < settings.min_confidence) { await skip(`fiducia ${s.confidence} < ${settings.min_confidence}`); continue; }
      const res = await executeSuggestion(d, s.id, { by: "autopilot" });
      out.push(`${s.symbol}: ${res.message}`);
    }
  }
  return out;
}

export async function executeApprovedQueue(d: Deps): Promise<string[]> {
  const out: string[] = [];
  for (const s of (await d.store.listSuggestions(["approved"], 50)).filter((x) => isRegularFor(x.symbol, d.now()))) {
    const r = await executeSuggestion(d, s.id, { by: "manual" });
    out.push(`${s.symbol}: ${r.message}`);
  }
  return out;
}

async function expireSuggestions(d: Deps) {
  const now = d.now().getTime();
  for (const s of await d.store.listSuggestions(["pending"], 200)) {
    if (new Date(s.expires_at).getTime() < now) await d.store.updateSuggestion(s.id, { status: "expired" });
  }
}

// ------------------------------------------------------------------ riepilogo giornaliero
export async function dailySummary(d: Deps): Promise<void> {
  const day = romeDay(d.now());
  const snap = await snapshot(d);
  const trades = await d.store.tradesOfDay(day);
  const lines = [
    `📒 <b>Riepilogo ${day}</b>`,
    `Giacenza ${usd(snap.cash)} · Patrimonio ${usd(snap.equity)} · P/L aperto ${usd(snap.pnl)}`,
    `Posizioni: ${snap.positions.length ? snap.positions.map((p) => `${esc(p.symbol)} ${pct(p.pnlPct)}`).join(", ") : "nessuna"}`,
    `Operazioni di oggi: ${trades.length ? trades.map((t) => `${t.side === "buy" ? "▲" : "▼"} ${esc(t.symbol)} ${usd(t.amount_usd)} (${t.origin})`).join(", ") : "nessuna"}`,
  ];
  await notify(d, lines.join("\n"));
}


// ------------------------------------------------------------------ aggiornamento dati ogni 15 minuti
export const REFRESH_MIN = 15;

/** Aggiorna indicatori e fiducia delle idee in attesa per un mercato (USA o Europa), al massimo ogni REFRESH_MIN minuti. */
export async function refreshSweep(d: Deps, scope: Group): Promise<string[]> {
  const now = d.now();
  const sess = scope === "EU" ? euSessionOf(now) : sessionOf(now);
  if (sess.session !== "premarket" && sess.session !== "regular") return [];
  const last = await d.store.kvGet<{ ts: string }>(`refresh:${scope}`);
  if (last && now.getTime() - new Date(last.ts).getTime() < (REFRESH_MIN - 1) * 60_000) return [];
  await d.store.kvSet(`refresh:${scope}`, { ts: now.toISOString() });

  const settings = await d.store.getSettings();
  const watch = (await d.store.listWatchlist()).filter((w) => w.active && marketOf(w.symbol).group === scope);
  const pending = (await d.store.listSuggestions(["pending"], 100)).filter((x) => marketOf(x.symbol).group === scope);
  const targets = new Map<number, string>();
  for (const w of watch) targets.set(w.instrument_id, w.symbol);
  for (const x of pending) targets.set(x.instrument_id, x.symbol);
  if (!targets.size) return [];
  const rates = await d.etoro.rates([...targets.keys()]);

  let refreshed = 0;
  await mapLimit([...targets.entries()], 3, async ([id, symbol]) => {
    try { if (await refreshTech(d, symbol, id, rates[id]?.ask ?? null)) refreshed++; }
    catch (e) { await d.store.logEvent("tech_refresh_error", { symbol, error: (e as Error).message }); }
  });

  let rescored = 0;
  for (const x of pending.filter((y) => y.side === "buy")) { // le vendite dipendono dal P&L reale: le ricalcola il monitor
    const meta = await d.store.kvGet<{ claude: number | null; rule: boolean }>(`conf:${x.id}`);
    const r = rates[x.instrument_id];
    if (!meta || !r) continue;
    const price = x.side === "buy" ? r.ask : r.bid;
    const [analysis, tech, mtf] = await Promise.all([d.store.kvGet<Analysis>(`analysis:${x.symbol}`), d.store.kvGet<Tech>(`tech:${x.symbol}`), d.store.kvGet<Mtf>(`mtf:${x.symbol}`)]);
    const q = quantConfidence({ side: x.side, price, target: x.target_price, stop: x.stop_price, analysis, tech, mtf, pnlPct: null, takeProfitPct: settings.take_profit_pct, stopLossPct: settings.stop_loss_pct });
    const bl = blendConfidence(meta.rule ? null : meta.claude, q, meta.rule);
    if (bl.confidence !== x.confidence) { await d.store.updateSuggestion(x.id, { confidence: bl.confidence }); rescored++; }
  }
  const intra = sess.session === "regular" ? await intradaySignals(d, watch, rates) : 0;
  await d.store.kvSet(`refresh:${scope}`, { ts: now.toISOString(), refreshed, rescored, intra });
  return [`${scope}: ${refreshed} titoli aggiornati, ${rescored} fiducie ricalcolate${intra ? `, ${intra} idee intraday` : ""}`];
}


/** Idee intraday da regole: tutti i timeframe 30m/1h/4h allineati (e trend giornaliero non contrario). Solo manuali, una per titolo e direzione al giorno. */
async function intradaySignals(d: Deps, watch: Array<{ symbol: string; instrument_id: number }>, rates: Record<number, Rate>): Promise<number> {
  const cands: Array<{ symbol: string; id: number; side: "buy" | "sell"; m: Mtf; a: Analysis | null }> = [];
  for (const w of watch) {
    const m = await d.store.kvGet<Mtf>(`mtf:${w.symbol}`);
    if (!m) continue;
    const { verdicts, alignment } = mtfSummary(m);
    const a = await d.store.kvGet<Analysis>(`analysis:${w.symbol}`);
    if (alignment !== null && alignment >= 0.7 && verdicts["30m"] === "buy" && verdicts["1h"] === "buy" && a?.trend !== "down") cands.push({ symbol: w.symbol, id: w.instrument_id, side: "buy", m, a });
    else if (alignment !== null && alignment <= -0.7 && verdicts["30m"] === "sell" && verdicts["1h"] === "sell") cands.push({ symbol: w.symbol, id: w.instrument_id, side: "sell", m, a });
  }
  if (!cands.length) return 0;
  const snap = await snapshot(d);
  const c = await proposeCtx(d, snap, rates);
  let n = 0;
  for (const x of cands) {
    if (x.side === "sell" && !snap.positions.some((p) => p.instrumentId === x.id)) continue;
    if (x.side === "buy" && snap.positions.some((p) => p.instrumentId === x.id)) continue;
    if (!(await once(d, `intra:${x.symbol}:${x.side}:${c.day}`))) continue;
    const r = rates[x.id];
    if (!r) continue;
    const h1 = x.m.frames["1h"] ?? x.m.frames["30m"];
    const atr = h1?.atrPct ?? 1;
    const px = x.side === "buy" ? r.ask : r.bid;
    const tgtPct = Math.min(4, Math.max(INTRADAY_MIN_UPSIDE_PCT, atr * 1.5));
    const stopPct = Math.min(2, Math.max(0.7, atr));
    const v = mtfSummary(x.m).verdicts;
    const idea: RawIdea = x.side === "buy"
      ? { symbol: x.symbol, side: "buy", confidence: 50, rule: true, horizon: "intraday", target_price: px * (1 + tgtPct / 100), stop_price: px * (1 - stopPct / 100), source_urls: [],
          rationale: `Timeframe allineati al rialzo (30m ${v["30m"]}, 1h ${v["1h"]}, 4h ${v["4h"]}); target ${tgtPct.toFixed(1)}%, stop ${stopPct.toFixed(1)}% su ATR 1h ${atr.toFixed(1)}%. Idea da regole, senza notizie.` }
      : { symbol: x.symbol, side: "sell", confidence: 50, rule: true, horizon: "intraday", target_price: null, stop_price: null, source_urls: [],
          rationale: `Timeframe allineati al ribasso (30m ${v["30m"]}, 1h ${v["1h"]}, 4h ${v["4h"]}): valuta l'uscita in giornata. Idea da regole, senza notizie.` };
    const res = await proposeIdea(d, c, idea, [], "monitor");
    if (res.created) { n++; await notify(d, suggestionHtml(res.created, "⏱ Opportunità intraday"), buttonsFor(res.created)); }
  }
  return n;
}

// ------------------------------------------------------------------ tick (chiamato ogni 5 minuti)
/** Patrimonio a inizio giornata (ora italiana): base per il profitto giornaliero. Registrato al primo controllo del giorno. */
export async function equityOfDay(d: Deps, currentEquity: number | null): Promise<number | null> {
  const day = romeDay(d.now());
  const saved = await d.store.kvGet<{ day: string; equity: number }>("equity_open");
  if (saved && saved.day === day) return saved.equity;
  if (currentEquity === null) return null;
  await d.store.kvSet("equity_open", { day, equity: currentEquity });
  return currentEquity;
}

export interface TickResult { session: string; did: string[]; skipped?: string }

export async function tick(d: Deps): Promise<TickResult> {
  const now = d.now();
  const sess = sessionOf(now);
  const eu = euSessionOf(now);
  const settings = await d.store.getSettings();
  const did: string[] = [];

  const lock = await d.store.kvGet<{ ts: string }>("tick_lock");
  if (lock && now.getTime() - new Date(lock.ts).getTime() < 90_000) return { session: sess.session, did, skipped: "tick precedente ancora in corso" };
  await d.store.kvSet("tick_lock", { ts: now.toISOString() });
  await d.store.kvSet("last_tick", { ts: now.toISOString(), session: sess.session });

  try {
    if (sess.calendarStale && (await once(d, `calstale:${sess.day.slice(0, 4)}`)))
      await notify(d, "⚠️ Il calendario delle festivita' di borsa dell'app e' scaduto: aggiornalo in src/lib/time.ts.");
    await expireSuggestions(d);
    try { const s = await d.store.kvGet<{ day: string }>("equity_open"); if (!s || s.day !== romeDay(now)) await equityOfDay(d, (await snapshot(d)).equity); }
    catch (e) { await d.store.logEvent("tick_error", { step: "equity_open", error: (e as Error).message }); }

    for (const scope of ["US", "EU"] as const) {
      try { const r = await refreshSweep(d, scope); if (r.length) did.push(`aggiornamento ${r[0]}`); }
      catch (e) { await d.store.logEvent("tick_error", { step: `refresh ${scope}`, error: (e as Error).message }); }
    }

    if (sess.session === "regular" || eu.session === "regular") {
      const guard = async (name: string, fn: () => Promise<unknown>) => {
        try { const r = await fn(); if (Array.isArray(r) && r.length) did.push(`${name}: ${r.join("; ")}`); }
        catch (e) { await d.store.logEvent("tick_error", { step: name, error: (e as Error).message }); }
      };
      let snap: Snapshot | null = null;
      await guard("snapshot", async () => { snap = await snapshot(d); });
      if (snap) {
        const s = snap;
        await guard("monitor", () => monitorPositions(d, s));
        await guard("favorevoli", () => favorableSweep(d, s));
        await guard("guardia", () => guardPositions(d));
        await guard("rotazione", () => runRotation(d));
      }
      await guard("coda", () => executeApprovedQueue(d));
      await guard("autopilot", () => autopilotSweep(d));
    }

    // scansione con Claude: ogni N minuti (default 15) oppure agli orari fissi. Una sola scansione per tick (la prossima al giro successivo).
    // scansione catalizzatori prima della chiusura (sostituisce la scansione normale in questo giro: una sola chiamata IA per tick)
    let catalystRan = false;
    for (const scope of catalystScopes(d, settings)) {
      const key = `once:catalyst_try:${scope}:${scope === "EU" ? eu.day : sess.day}`;
      const tries = (await d.store.kvGet<number>(key)) ?? 0;
      if (tries >= 2) continue;
      await d.store.kvSet(key, tries + 1);
      try { const r = await runCatalystScan(d, scope); did.push(`catalizzatori ${scope}: ${r}`); }
      catch (e) { await d.store.logEvent("catalyst_error", { scope, error: (e as Error).message }); }
      catalystRan = true; break;
    }
    const slots = catalystRan ? [] : settings.scan_interval_min > 0
      ? autoScanSlots(settings.scan_interval_min, now)
      : [...dueScanSlots(settings.scan_times, now), ...dueScanSlotsEu(settings.scan_times_eu, now)];
    for (const slot of slots) {
      if (!(await once(d, `scan:${slot}`))) continue;
      try { const r = await runScan(d, slot); did.push(`scan ${slot}: ${r.created.length} idee`); }
      catch (e) {
        await d.store.logEvent("scan_error", { slot, error: (e as Error).message });
        await notify(d, `⚠️ Scansione ${esc(slot)} non riuscita: ${esc((e as Error).message.slice(0, 200))}`);
      }
      break;
    }

    if (sess.tradingDay && sess.minutes >= 16 * 60 + 15 && sess.minutes < 20 * 60 && (await once(d, `summary:${sess.day}`))) {
      try { await dailySummary(d); did.push("riepilogo"); } catch (e) { await d.store.logEvent("summary_error", { error: (e as Error).message }); }
    }
  } finally {
    await d.store.kvSet("tick_lock", { ts: new Date(0).toISOString() });
  }
  return { session: sess.session, did };
}

// ------------------------------------------------------------------ Telegram
export async function handleTelegram(d: Deps, update: unknown, allowedChatIds: string): Promise<void> {
  const allowed = new Set(parseChatIds(allowedChatIds));
  const u = update as {
    callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number }; text?: string } };
    message?: { text?: string; chat: { id: number } };
  };
  const cb = u.callback_query;
  if (cb) {
    if (!allowed.has(String(cb.message?.chat.id))) return;
    const m = /^([ar]):(\d+)$/.exec(cb.data ?? "");
    if (!m) { await d.tg.answer(cb.id, "Comando non valido"); return; }
    const id = Number(m[2]);
    const res = m[1] === "a" ? await executeSuggestion(d, id, { by: "manual" }) : await rejectSuggestion(d, id);
    await d.tg.answer(cb.id, res.message);
    if (cb.message) {
      try { await d.tg.edit(cb.message.chat.id, cb.message.message_id, `${esc(cb.message.text ?? "")}\n\n<b>${res.ok ? "✔" : "✖"} ${esc(res.message)}</b>`); } catch { /* messaggio non modificabile */ }
    }
    return;
  }
  const msg = u.message;
  if (!msg?.text || !allowed.has(String(msg.chat.id))) return;
  const cmd = msg.text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
  if (cmd === "/stato") {
    const s = await snapshot(d);
    const set = await d.store.getSettings();
    await d.tg.send([
      `💼 <b>Stato</b> (${set.mode === "autopilot" ? "autopilot" : "consulente"}${set.kill_switch ? ", ⛔ kill-switch ATTIVO" : ""})`,
      `Giacenza ${usd(s.cash)} · Patrimonio ${usd(s.equity)} · P/L ${usd(s.pnl)}`,
      s.positions.length ? s.positions.map((p) => `• ${esc(p.symbol)}: ${num(p.unitsEff, 4)} az. ${pct(p.pnlPct)}`).join("\n") : "Nessuna posizione aperta.",
    ].join("\n"));
  } else if (cmd === "/idee") {
    const list = await d.store.listSuggestions(["pending"], 10);
    if (!list.length) await d.tg.send("Nessuna idea in attesa.");
    for (const s of list) await d.tg.send(suggestionHtml(s), buttonsFor(s));
  } else if (cmd === "/stop") {
    await d.store.saveSettings({ kill_switch: true });
    await d.tg.send("⛔ Kill-switch attivato: l'autopilot e' fermo. Gli alert continuano. Usa /riprendi per riattivare.");
  } else if (cmd === "/riprendi") {
    await d.store.saveSettings({ kill_switch: false });
    await d.tg.send("✅ Kill-switch disattivato.");
  } else {
    await d.tg.send("Comandi: /stato · /idee · /stop (ferma l'autopilot) · /riprendi");
  }
}
