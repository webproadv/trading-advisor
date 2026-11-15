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
      <div className="card"><SettingsForm initial={settings} /></div>
      <h2>Watchlist</h2>
      <WatchlistEditor items={watch} />
      <h2>Telegram</h2>
      <div className="card"><TelegramSetup /></div>
    </>
  );
}
