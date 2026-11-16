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

## Borse supportate
- **USA** (NYSE/Nasdaq): titoli senza suffisso (AAPL, NVDA). Sessione 09:30–16:00 ora di New York, con premarket.
- **Europa**: Milano (.MI), Madrid (.MC), Francoforte (.DE), Parigi (.PA), Amsterdam (.AS), Bruxelles (.BR), Lisbona (.LS), Vienna (.VI), Helsinki (.HE), Zurigo (.SW). Sessione 09:00–17:30 ora italiana, pre-apertura dalle 08:00. Simboli eToro con suffisso: ENI.MI, SAN.MC, BMW.DE.
- Ogni mercato ha orari, festività e scansioni propri. Prezzi in EUR/CHF vengono convertiti in USD (cambio BCE via frankfurter.dev) per importi e limiti, che restano in USD.
- Non ancora supportati: Londra (prezzi in pence) e borse nordiche. Il calendario europeo è semplificato: l'app non opera nei giorni in cui chiude almeno una delle borse supportate.
- Da verificare con il conto demo: che i titoli europei siano acquistabili e che il simbolo con suffisso venga trovato dalla ricerca eToro.

## Analisi tecnica
Per ogni titolo in watchlist l'app calcola, su candele giornaliere con il prezzo live: momentum (10 giorni), pivot classici, RSI(14), Stocastico(14,3,3), StochRSI(14), MACD(12,26,9), ADX/DI(14), Williams %R(14), CCI(20) e ATR(14). Il giudizio finale conta i segnali di 9 indicatori; in un trend forte (ADX > 25) i segnali di ipercomprato/ipervenduto contro il trend vengono ignorati. I dati sono nella pagina **Analisi**, entrano nel prompt di Claude e fanno da filtro: un titolo con giudizio "vendita" non viene proposto dalle regole automatiche. Si aggiornano a ogni scansione e circa ogni 30 minuti per i titoli con mercato aperto.

## Limiti da conoscere
- Mai provata su servizi reali (eToro, Supabase, Telegram, Anthropic): i 32 test usano simulazioni.
- Funzioni Vercel Hobby: massimo 60 s; la scansione Claude usa un timeout di 52 s.
- Costi: ogni scansione con Claude consuma API Anthropic (3 al giorno di default).
- Festività NYSE codificate fino al 2027 (`src/lib/time.ts`); l'app ti avvisa quando il calendario scade.
- Ordini solo a mercato, leva 1, solo acquisti long.

## Sviluppo
`npm install` · `npm test` · `npm run typecheck` · `npm run build`

## Tasso di fiducia

La fiducia di ogni idea non è più un valore fisso (50): viene calcolata da `src/lib/confidence.ts` con tutti i dati disponibili — trend (SMA20/50), momentum, RSI, MACD, ADX/DI, Stoch/StochRSI, Williams, CCI, pivot, rapporto rischio/rendimento (target/stop), volatilità ATR e, in vendita, il rendimento già maturato.

- **Con analisi di Claude**: fiducia finale = media 50/50 tra la fiducia di Claude e quella quantitativa. Se divergono di oltre 35 punti compare un avviso.
- **Solo regole (senza notizie)**: fiducia quantitativa con tetto 65, quindi sotto la soglia autopilot predefinita (70): per operare in automatico serve anche la lettura delle notizie.
- Il dettaglio (punteggio per componente) è scritto nella motivazione dell'idea.
