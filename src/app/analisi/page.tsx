import { requireAuth } from "@/lib/auth";
import { makeStore } from "@/lib/deps";
import { mtfSummary, type Mtf, type Tech } from "@/lib/indicators";
import { fmtPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "n/d" : v.toFixed(d));
const VERDICT = { buy: "ACQUISTO", sell: "VENDITA", neutral: "NEUTRO" } as const;
const color = (v: string) => (v === "buy" ? "pos" : v === "sell" ? "neg" : "muted");

export default async function Analisi() {
  await requireAuth();
  const store = makeStore();
  const watch = (await store.listWatchlist()).filter((w) => w.active);
  const rows = await Promise.all(watch.map(async (w) => ({ w, t: await store.kvGet<Tech>(`tech:${w.symbol}`), m: await store.kvGet<Mtf>(`mtf:${w.symbol}`) })));
  return (
    <>
      <h1>Analisi tecnica</h1>
      <p className="muted">Indicatori su candele giornaliere con il prezzo live; le colonne 30m, 1h e 4h sono il giudizio sugli stessi indicatori calcolati su quei timeframe. Si aggiorna ogni 15 minuti in orario di mercato. Il giudizio conta i segnali di 9 indicatori (RSI, Stocastico, StochRSI, MACD, ADX, Williams %R, CCI, Momentum, Pivot).</p>
      <div className="scroll"><table>
        <thead><tr><th>Titolo</th><th>Giudizio</th><th>30m</th><th>1h</th><th>4h</th><th>Prezzo</th><th>RSI</th><th>Stoch K/D</th><th>StochRSI</th><th>MACD ist.</th><th>ADX (+DI/-DI)</th><th>Williams</th><th>CCI</th><th>Mom. 10g</th><th>ATR%</th><th>Pivot S1 / P / R1</th><th>Aggiornato</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={17} className="muted">Watchlist vuota.</td></tr>}
          {rows.map(({ w, t, m }) => t ? (
            <tr key={w.symbol}>
              <td><b>{w.symbol}</b></td>
              <td className={color(t.signals.verdict)}><b>{VERDICT[t.signals.verdict]}</b> <small>({t.signals.buy}▲ {t.signals.sell}▼ {t.signals.neutral}•)</small></td>
              {(["30m", "1h", "4h"] as const).map((f) => { const v = mtfSummary(m).verdicts[f]; return <td key={f} className={v ? color(v) : "muted"}>{v ? VERDICT[v] : "n/d"}</td>; })}
              <td>{fmtPrice(w.symbol, t.price)}</td>
              <td className={color(t.signals.detail.RSI)}>{n(t.rsi14)}</td>
              <td className={color(t.signals.detail.Stoch)}>{n(t.stochK)} / {n(t.stochD)}</td>
              <td className={color(t.signals.detail.StochRSI)}>{n(t.stochRsiK)}</td>
              <td className={color(t.signals.detail.MACD)}>{n(t.macdHist, 3)}</td>
              <td className={color(t.signals.detail.ADX)}>{n(t.adx)} ({n(t.plusDI, 0)}/{n(t.minusDI, 0)})</td>
              <td className={color(t.signals.detail["Williams%R"])}>{n(t.willR)}</td>
              <td className={color(t.signals.detail.CCI)}>{n(t.cci20, 0)}</td>
              <td className={color(t.signals.detail.Momentum)}>{n(t.mom10Pct)}%</td>
              <td>{n(t.atrPct)}%</td>
              <td className={color(t.signals.detail.Pivot)}>{t.pivots ? `${n(t.pivots.s1, 2)} / ${n(t.pivots.p, 2)} / ${n(t.pivots.r1, 2)}` : "n/d"}</td>
              <td className="muted">{new Date(t.asOf).toLocaleString("it-IT")}</td>
            </tr>
          ) : <tr key={w.symbol}><td><b>{w.symbol}</b></td><td colSpan={16} className="muted">Nessun dato ancora: avvia una scansione.</td></tr>)}
        </tbody>
      </table></div>
      <p className="muted">Strumento educativo su conto demo, non consulenza finanziaria.</p>
    </>
  );
}
