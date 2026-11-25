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

## Aggiornamento ogni 15 minuti

Ogni 15 minuti, durante premarket e sessione regolare (USA e Europa, separatamente), il tick aggiorna gli indicatori di tutta la watchlist e dei titoli con idee in attesa, usando il prezzo live, e ricalcola la fiducia delle idee di acquisto in attesa (la parte di Claude resta quella originale, quella tecnica è aggiornata). L'autopilot, che gira subito dopo nello stesso tick, decide quindi su dati con al massimo 15 minuti. Non usa Claude né ricerca web: le analisi con notizie restano agli orari "scansione" delle Impostazioni.

## Più chat Telegram

`TELEGRAM_CHAT_ID` accetta più ID separati da virgola (es. `123456789,987654321`): ogni avviso viene inviato a tutte le chat e tutte possono usare i pulsanti e i comandi (/stato, /idee, /stop, /riprendi). Per un gruppo usa l'ID del gruppo (negativo) dopo aver aggiunto il bot.

## Secondo bot Telegram

Opzionale: `TELEGRAM_BOT_TOKEN_2` + `TELEGRAM_CHAT_ID_2` (anche più ID separati da virgola). Gli avvisi vanno a entrambi i bot; i pulsanti e i comandi del secondo bot arrivano su `/api/telegram/webhook?bot=2`, registrato dal pulsante "Collega / verifica Telegram" nelle Impostazioni (usa lo stesso `TELEGRAM_WEBHOOK_SECRET`).

## Timeframe intraday (30 minuti, 1 ora, 4 ore)

Ad ogni aggiornamento (ogni 15 minuti in orario di mercato) l'app calcola il pannello di 9 indicatori anche su candele a 30 minuti, 1 ora e 4 ore. Il risultato:
- entra nella fiducia (componente "timeframe 30m/1h/4h", fino a 10 punti: più timeframe concordi con l'idea, più fiducia);
- viene passato a Claude, che valuta tutti gli orizzonti e può proporre idee `intraday` (target 1,5–4%, stop 0,7–2%, calibrati sull'ATR a 1 ora);
- genera, senza costi IA, idee intraday da regole quando 30m e 1h sono entrambi concordi e l'allineamento pesato è ≥ 70% (acquisto, con trend giornaliero non ribassista) o ≤ −70% (vendita di titoli in portafoglio): al massimo una per titolo e direzione al giorno;
- le idee intraday scadono dopo 6 ore, accettano un margine minimo di 1,5% (invece di quello impostato per lo swing) e **non vengono mai eseguite dall'autopilot**: solo approvazione manuale.

## Acquisto manuale dalla pagina Analisi

Ogni titolo della watchlist ha un campo "azioni" e il pulsante **Compra** (desktop: seconda colonna; mobile: dentro la scheda). L'acquisto è a mercato, sul conto demo, solo a mercato aperto del titolo, entro la giacenza e con un minimo di $10; chiede conferma e viene registrato come operazione manuale. Non è soggetto ai limiti giornalieri dell'autopilot.

## Ricerca opportunità automatica ogni 15 minuti

Impostazione "Cerca opportunità ogni (minuti)" (default 15, 0 = solo orari fissi): ogni N minuti il tick lancia la stessa ricerca del pulsante "Cerca opportunità" (Claude + ricerca web + indicatori su 4 timeframe) per **USA** (da premarket 08:00 ET alla chiusura) ed **Europa** (da pre-apertura 08:00 alla chiusura), nei giorni di borsa. Il tick gira ogni 5 minuti e fa al massimo una scansione per volta: se USA ed Europa sono dovute insieme, la seconda parte 5 minuti dopo. Ogni scansione usa l'IA (circa 70 al giorno con 15 minuti): aumenta l'intervallo per spendere meno.

## Credito Anthropic esaurito

Se l'API Anthropic risponde con errore di credito/chiave (`credit balance is too low`, `invalid x-api-key`), l'analisi Claude viene sospesa per 1 ora (`claude_pause` in kv) e viene inviato un solo avviso Telegram ogni 6 ore. Nel frattempo l'app usa solo le regole tecniche (confidenza massima 65, quindi l'autopilot non acquista). Ricarica il credito su console.anthropic.com → Plans & Billing. Per ridurre i costi aumenta `scan_interval_min` (30/60) nelle Impostazioni.

## Autopilot: trend intraday e acquisti su notizie

- **Ingresso**: prima di ogni acquisto l'autopilot controlla che Supertrend (ATR 10, x3), EMA 9 sopra EMA 50 e il giudizio degli indicatori (nessun "vendi") siano rialzisti su **10, 15 e 30 minuti**. Se manca anche un solo dato, non compra. Le idee intraday ora possono essere eseguite dall'autopilot (con questo filtro).
- **Uscita**: oltre allo stop-loss (default 2%), con profitto di almeno `trend_exit_min_profit_usd` (default 1$) l'autopilot chiude se il trend e' ribassista (Supertrend giu', EMA 9 sotto EMA 50, nessun "compra") su **1, 5 e 10 minuti insieme**. Sotto quella soglia di profitto vale solo lo stop-loss.
- **Guardia ogni minuto**: `/api/cron/guard`, chiamata da pg_cron ogni minuto nelle ore di borsa (job `trading-advisor-guard`); fa solo stop-loss, uscita su trend e controllo overnight, senza IA. Se il job manca, gli stessi controlli girano comunque ogni 5 minuti nel tick.
- **Overnight (notizie attese)**: circa 20-50 minuti prima della chiusura di USA ed Europa una scansione Claude (fino a 4 ricerche web) cerca nel calendario dei risultati e delle notizie i titoli con catalizzatore positivo molto probabile per la sessione successiva. L'autopilot li compra anche se il titolo sta scendendo (senza filtro di trend), entro `max_overnight_usd` e **mai prima di weekend o festivi**. Alla prima sessione successiva, se la posizione e' in perdita viene venduta subito; se e' in guadagno resta con la gestione normale.

## Rotazione: i migliori titoli "acquisto" dell'Analisi

Solo in modalita' autopilot (impostazioni `rotation_*`). Ogni 60 minuti, a mercato aperto, l'autopilot prende i titoli con giudizio ACQUISTO della pagina Analisi (stesso ordine per potenzialita'), sui mercati aperti, e compra i primi 5 che non ha gia' in portafoglio (importo e limiti come per le altre operazioni; di default richiede anche Supertrend/EMA rialzisti su 10/15/30 minuti). Le posizioni della rotazione vengono vendute appena raggiungono +1% (controllo ogni minuto). Telegram avvisa a ogni ciclo (acquisti e titoli saltati con il motivo) e a ogni vendita. Restano attivi stop-loss e uscita su trend ribassista.

## Revisione pre-acquisto (stile desk di trading)
Prima di ogni acquisto dell'autopilot (idee e rotazione) Claude esegue, in una sola chiamata senza ricerca web, tre ruoli: rialzista, ribassista e responsabile del rischio, che approva o respinge. Esito in cache 30 minuti per titolo, registrato negli eventi `entry_review` e riportato tra i "Saltati" di Telegram. Se la revisione e' attiva ma Claude non e' disponibile (errore o pausa crediti) non si compra. Disattivabile dalle impostazioni (`entry_review`).

## Tauric (notizie e sintesi AI, solo titoli USA)
Con la variabile `TAURIC_API_KEY` (chiave da tauric.ai/settings/api-keys, solo lato server) la revisione pre-acquisto riceve, per i titoli USA, il digest AI e gli ultimi 5 articoli del titolo (API `GET /v1/securities/{symbol}/digest` e `GET /v1/news`). Cache 30 minuti, circa 2 richieste dati per titolo; piano standard: 3000 crediti dati al giorno. Senza chiave, o per titoli non USA/non coperti, la revisione prosegue senza questi dati; gli errori sono registrati come `tauric_error`.
