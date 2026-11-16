import { requireAuth } from "@/lib/auth";
import { makeStore } from "@/lib/deps";
import { SettingsForm, TelegramSetup, WatchlistEditor } from "../components/Controls";

export const dynamic = "force-dynamic";

export default async function Impostazioni() {
  await requireAuth();
  const store = makeStore();
  const [settings, watch] = await Promise.all([store.getSettings(), store.listWatchlist()]);
  return (
    <>
      <h1>Impostazioni</h1>
      <p className="muted" style={{ margin: "0 0 16px" }}>Limiti di rischio, orari delle scansioni, watchlist e notifiche.</p>
      <div className="card"><SettingsForm initial={settings} /></div>
      <h2>Watchlist</h2>
      <WatchlistEditor items={watch} />
      <h2>Telegram</h2>
      <div className="card"><TelegramSetup /></div>
    </>
  );
}
