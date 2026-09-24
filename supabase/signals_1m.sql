-- =====================================================================
-- Señales del modelo de dirección de 1 min (api/signal_1m_store.py)
-- Ejecuta en: Supabase → SQL Editor → New query
-- =====================================================================
create table if not exists signals_1m (
    id           bigint generated always as identity primary key,
    ticker       text        not null,
    as_of        timestamptz not null,       -- inicio de la última barra real
    h            int         not null,       -- horizonte en minutos
    p_up         numeric     not null,
    confident    boolean     not null,
    has_edge     boolean     not null,
    anchor_close numeric     not null,
    dead_band    numeric     not null,       -- |r| por debajo = "plano"
    momentum_up  boolean,                    -- baseline de momentum en ese instante
    created_at   timestamptz not null default now(),
    unique (ticker, as_of, h)
);

create index if not exists idx_signals_1m_ticker_asof on signals_1m (ticker, as_of desc);

-- Solo el backend (service key) escribe y lee.
alter table signals_1m enable row level security;
