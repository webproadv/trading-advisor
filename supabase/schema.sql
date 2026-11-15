-- Schema per Trading Advisor (eseguire una volta nello SQL Editor di Supabase)
-- Tutte le tabelle hanno RLS attiva e NESSUNA policy: l'accesso avviene solo dal server con la service role key.

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists watchlist (
  symbol text primary key,
  instrument_id int not null,
  name text,
  active boolean not null default true,
  added_at timestamptz not null default now()
);

create table if not exists suggestions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  symbol text not null,
  instrument_id int not null,
  side text not null check (side in ('buy','sell')),
  units numeric not null,
  amount_usd numeric not null,
  price_ref numeric not null,
  target_price numeric,
  stop_price numeric,
  confidence int not null default 50,
  rationale text not null default '',
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','executed','expired','failed')),
  origin text not null default 'scan',
  expires_at timestamptz not null,
  executed_at timestamptz,
  result jsonb
);
create index if not exists suggestions_status_idx on suggestions (status, created_at desc);

create table if not exists trades (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  day text not null,
  symbol text,
  instrument_id int,
  side text,
  amount_usd numeric,
  units numeric,
  price numeric,
  position_id text,
  origin text,
  suggestion_id bigint,
  note text,
  pnl_usd numeric
);
create index if not exists trades_day_idx on trades (day, origin, side);

create table if not exists events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  type text not null,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists events_ts_idx on events (ts desc);

create table if not exists kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;
alter table watchlist enable row level security;
alter table suggestions enable row level security;
alter table trades enable row level security;
alter table events enable row level security;
alter table kv enable row level security;

revoke all on settings, watchlist, suggestions, trades, events, kv from anon, authenticated;

insert into settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
