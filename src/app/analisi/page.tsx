import { requireAuth } from "@/lib/auth";
import { makeStore } from "@/lib/deps";
import { mtfSummary, type Mtf, type Tech } from "@/lib/indicators";
import { fmtPrice } from "@/lib/format";
import { marketOf } from "@/lib/time";
import { BuyBox } from "../components/Controls";

export const dynamic = "force-dynamic";

const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "n/d" : v.toFixed(d));
const VERDICT = { buy: "ACQUISTO", sell: "VENDITA", neutral: "NEUTRO" } as const;
const color = (v: string) => (v === "buy" ? "pos" : v === "sell" ? "neg" : "muted");

const RANK = { buy: 0, neutral: 1, sell: 2 } as const;
/** Potenzialità di acquisto: giudizio giornaliero (segnali buy-sell su 9) e allineamento 30m/1h/4h, da -100 a +100. */
function potential(t: Tech | null, m: Mtf | null): number {
  if (!t) return -Infinity;
  const al = mtfSummary(m).alignment ?? 0;
  return ((t.signals.buy - t.signals.sell) / 9) * 60 + al * 40;
}

export default async function Analisi({ searchParams }: { searchParams: Promise<{ ord?: string }> }) {
  const { ord } = await searchParams;
  const byName = ord === "titolo";
  await requireAuth();
  const store = makeStore();
  const settings = await store.getSettings();
  const watch = (await store.listWatchlist()).filter((w) => w.active);
  const units0 = (price: number) => Math.max(0.01, Math.floor((settings.max_position_usd / price) * 100) / 100);
  const rows = await Promise.all(watch.map(async (w) => ({ w, t: await store.kvGet<Tech>(`tech:${w.symbol}`), m: await store.kvGet<Mtf>(`mtf:${w.symbol}`) })));
  rows.sort((a, b) => {
    if (byName) return a.w.symbol.localeCompare(b.w.symbol);
    const ra = a.t ? RANK[a.t.signals.verdict] : 3, rb = b.t ? RANK[b.t.signals.verdict] : 3;
    return ra - rb || potential(b.t, b.m) - potential(a.t, a.m) || a.w.symbol.localeCompare(b.w.symbol);
  });
  return (
    <>
      <h1>Analisi tecnica</h1>
      <p className="muted">Indicatori su candele giornaliere con il prezzo live; le colonne 30m, 1h e 4h sono il giudizio sugli stessi indicatori calcolati su quei timeframe. Si aggiorna ogni 15 minuti in orario di mercato. Puoi comprare direttamente da qui (conto demo, a mercato aperto). Il giudizio conta i segnali di 9 indicatori (RSI, Stocastico, StochRSI, MACD, ADX, Williams %R, CCI, Momentum, Pivot).</p>
      <div className="row" style={{ gap: 8, margin: "10px 0" }}>
        <span className="muted">Ordina per:</span>
        <a className={`chip ${byName ? "muted" : "pos"}`} href="/analisi">Potenzialità (acquisto in cima)</a>
        <a className={`chip ${byName ? "pos" : "muted"}`} href="/analisi?ord=titolo">Titolo (A–Z)</a>
      </div>
      <div className="scroll only-desk"><table>
        <thead><tr><th>Titolo</th><th>Acquista</th><th>Giudizio</th><th>30m</th><th>1h</th><th>4h</th><th>Prezzo</th><th>RSI</th><th>Stoch K/D</th><th>StochRSI</th><th>MACD ist.</th><th>ADX (+DI/-DI)</th><th>Williams</th><th>CCI</th><th>Mom. 10g</th><th>ATR%</th><th>Pivot S1 / P / R1</th><th>Aggiornato</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={18} className="empty">Watchlist vuota.</td></tr>}
          {rows.map(({ w, t, m }) => t ? (
            <tr key={w.symbol}>
              <td className="title" data-label="Titolo"><b>{w.symbol}</b></td>
              <td><BuyBox symbol={w.symbol} price={t.price} currency={marketOf(w.symbol).currency} defaultUnits={units0(t.price)} /></td>
              <td data-label="Giudizio" className={`wide ${color(t.signals.verdict)}`}><b>{VERDICT[t.signals.verdict]}</b> <small>({t.signals.buy}▲ {t.signals.sell}▼ {t.signals.neutral}•)</small></td>
              {(["30m", "1h", "4h"] as const).map((f) => { const v = mtfSummary(m).verdicts[f]; return <td key={f} data-label={f} className={v ? color(v) : "muted"}>{v ? VERDICT[v] : "n/d"}</td>; })}
              <td data-label="Prezzo">{fmtPrice(w.symbol, t.price)}</td>
              <td data-label="RSI" className={color(t.signals.detail.RSI)}>{n(t.rsi14)}</td>
              <td data-label="Stoch K/D" className={color(t.signals.detail.Stoch)}>{n(t.stochK)} / {n(t.stochD)}</td>
              <td data-label="StochRSI" className={color(t.signals.detail.StochRSI)}>{n(t.stochRsiK)}</td>
              <td data-label="MACD" className={color(t.signals.detail.MACD)}>{n(t.macdHist, 3)}</td>
              <td data-label="ADX (+DI/-DI)" className={color(t.signals.detail.ADX)}>{n(t.adx)} ({n(t.plusDI, 0)}/{n(t.minusDI, 0)})</td>
              <td data-label="Williams" className={color(t.signals.detail["Williams%R"])}>{n(t.willR)}</td>
              <td data-label="CCI" className={color(t.signals.detail.CCI)}>{n(t.cci20, 0)}</td>
              <td data-label="Mom. 10g" className={color(t.signals.detail.Momentum)}>{n(t.mom10Pct)}%</td>
              <td data-label="ATR%">{n(t.atrPct)}%</td>
              <td data-label="Pivot S1 / P / R1" className={`wide ${color(t.signals.detail.Pivot)}`}>{t.pivots ? `${n(t.pivots.s1, 2)} / ${n(t.pivots.p, 2)} / ${n(t.pivots.r1, 2)}` : "n/d"}</td>
              <td data-label="Aggiornato" className="wide muted">{new Date(t.asOf).toLocaleString("it-IT")}</td>
            </tr>
          ) : <tr key={w.symbol}><td className="title" data-label="Titolo"><b>{w.symbol}</b></td><td colSpan={17} className="empty">Nessun dato ancora: avvia una scansione.</td></tr>)}
        </tbody>
      </table></div>
      <div className="only-mob">
        {rows.length === 0 && <div className="card muted">Watchlist vuota.</div>}
        {rows.map(({ w, t, m }) => {
          const v = mtfSummary(m).verdicts;
          return (
            <div className="card acard" key={w.symbol}>
              <div className="h"><b>{w.symbol}</b>{t ? <span className={`chip ${color(t.signals.verdict)}`}>{VERDICT[t.signals.verdict]} · {t.signals.buy}▲ {t.signals.sell}▼</span> : <span className="muted">nessun dato</span>}</div>
              {t && (
                <>
                  <div className="tf">{(["30m", "1h", "4h"] as const).map((f) => <span key={f} className={`chip ${v[f] ? color(v[f]!) : "muted"}`}>{f} {v[f] ? VERDICT[v[f]!] : "n/d"}</span>)}</div>
                  <BuyBox symbol={w.symbol} price={t.price} currency={marketOf(w.symbol).currency} defaultUnits={units0(t.price)} />
                  <div className="px">{fmtPrice(w.symbol, t.price)} · RSI {n(t.rsi14)} · ATR {n(t.atrPct)}% · {new Date(t.asOf).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</div>
                  <details>
                    <summary>Tutti gli indicatori</summary>
                    <div className="ind">
                      <div className={color(t.signals.detail.Stoch)}><span>Stoch K/D</span>{n(t.stochK, 0)} / {n(t.stochD, 0)}</div>
                      <div className={color(t.signals.detail.StochRSI)}><span>StochRSI</span>{n(t.stochRsiK, 0)}</div>
                      <div className={color(t.signals.detail.MACD)}><span>MACD ist.</span>{n(t.macdHist, 3)}</div>
                      <div className={color(t.signals.detail.ADX)}><span>ADX +DI/-DI</span>{n(t.adx, 0)} ({n(t.plusDI, 0)}/{n(t.minusDI, 0)})</div>
                      <div className={color(t.signals.detail["Williams%R"])}><span>Williams</span>{n(t.willR, 0)}</div>
                      <div className={color(t.signals.detail.CCI)}><span>CCI</span>{n(t.cci20, 0)}</div>
                      <div className={color(t.signals.detail.Momentum)}><span>Mom. 10g</span>{n(t.mom10Pct)}%</div>
                      <div className={color(t.signals.detail.Pivot)}><span>Pivot S1/P/R1</span>{t.pivots ? `${n(t.pivots.s1, 2)}/${n(t.pivots.p, 2)}/${n(t.pivots.r1, 2)}` : "n/d"}</div>
                    </div>
                  </details>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted">Strumento educativo su conto demo, non consulenza finanziaria.</p>
    </>
  );
}
