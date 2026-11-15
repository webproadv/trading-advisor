# Trading Advisor — consulente per il conto DEMO eToro

Web app (Next.js su Vercel + Supabase) che ti fa da consulente: mostra giacenza e portafoglio demo, cerca opportunità (regole tecniche + Claude con ricerca web), ti propone acquisti/vendite con numero di azioni **che decidi tu**, oppure opera da sola in modalità **Autopilot** entro i tuoi limiti. Monitora il mercato ogni 5 minuti e ti avvisa su Telegram (anche nel premarket).

> Solo conto **DEMO** (denaro virtuale). Non è consulenza finanziaria. Gli endpoint usati sono esclusivamente quelli `demo`.

## Come funziona
- **Controllo ogni 5 min** (Supabase pg_cron → `/api/cron/tick`): stop-loss / take-profit sulle posizioni, segnali tecnici favorevoli, esecuzione delle approvazioni in coda, autopilot.
- **Scansioni con Claude** agli orari impostati (default 08:00 premarket, 10:00, 14:00 ora di New York): ricerca web su notizie, risultati, premarket; propone idee con target e stop.
- **Consulente**: le idee compaiono in app e su Telegram (bottoni Approva/Rifiuta); in app scegli tu il numero di azioni.
- **Autopilot**: compra solo se rispetta *tutti* i limiti; vende sulle soglie di guadagno/perdita. Solo nella sessione regolare USA.
- **Margine per comprare** = upside minimo (%) tra prezzo attuale e prezzo obiettivo stimato.
- Sicurezza: password unica, cookie firmato, kill switch, Claude propone soltanto (importi e limiti li decide il codice), nessun segreto nel browser.

## Installazione (circa 30 minuti)
1. **Supabase**: crea un progetto, apri SQL Editor ed esegui `supabase/schema.sql`.
2. **Telegram**: con @BotFather crea un bot → token. Scrivi un messaggio al bot e ricava il tuo chat id (es. con @userinfobot).
3. **eToro**: chiavi API *Demo* (API Key + User Key) dalle impostazioni.
4. **Vercel**: importa il progetto e imposta le variabili di `.env.example` (APP_PASSWORD, SESSION_SECRET ≥32 caratteri casuali, CRON_SECRET, APP_URL, chiavi Supabase/eToro/Anthropic/Telegram, TELEGRAM_WEBHOOK_SECRET). **Inserisci i segreti tu, mai in chat.**
5. Deploy, poi in Supabase esegui `supabase/cron.sql` sostituendo `APP_URL` e `CRON_SECRET`.
6. Apri l'app → accedi → *Impostazioni* → *Collega / verifica Telegram*.
7. Apri `/api/debug` (da loggato): mostra la risposta grezza di eToro e come l'app la interpreta. **Controllalo prima di fidarti dei numeri**: i formati di risposta eToro non sono tutti documentati e il parser è tollerante ma non testato dal vivo.
8. Aggiungi titoli alla watchlist, lascia la modalità *Consulente* per qualche giorno e verifica le idee prima di attivare l'Autopilot.

## Limiti da conoscere
- Mai provata su servizi reali (eToro, Supabase, Telegram, Anthropic): i 32 test usano simulazioni.
- Funzioni Vercel Hobby: massimo 60 s; la scansione Claude usa un timeout di 52 s.
- Costi: ogni scansione con Claude consuma API Anthropic (3 al giorno di default).
- Festività NYSE codificate fino al 2027 (`src/lib/time.ts`); l'app ti avvisa quando il calendario scade.
- Ordini solo a mercato, leva 1, solo acquisti long.

## Sviluppo
`npm install` · `npm test` · `npm run typecheck` · `npm run build`
