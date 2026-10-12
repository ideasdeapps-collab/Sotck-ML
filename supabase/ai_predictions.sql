-- =====================================================================
-- Predicciones de sesión hechas por IA (DeepSeek) — app/api/ai-prediction
-- Ejecuta en: Supabase → SQL Editor → New query
-- =====================================================================
create table if not exists ai_predictions (
    id           uuid        primary key default gen_random_uuid(),
    ticker       text        not null,
    created_at   timestamptz not null default now(),
    as_of        timestamptz not null,       -- cierre de la última barra de Polygon usada
    anchor       numeric     not null,       -- precio de esa barra
    session_date date        not null,       -- fecha ET de la sesión predicha
    model        text        not null,
    bias         text        not null,       -- alcista | bajista | lateral
    confidence   int         not null,
    reasoning    text        not null default '',
    key_levels   jsonb       not null default '[]',
    points       jsonb       not null,       -- [{ t: epoch ms, p: precio }]
    score        jsonb,                      -- resultado frente a lo real, cuando la sesión termina
    sources      jsonb       not null default '[]',
    failures     jsonb       not null default '[]',
    brief        jsonb                       -- el contexto exacto que recibió la IA, para auditar
);

create index if not exists idx_ai_predictions_ticker_created on ai_predictions (ticker, created_at desc);
create index if not exists idx_ai_predictions_created on ai_predictions (created_at desc);

-- Solo el servidor (service key) escribe y lee.
alter table ai_predictions enable row level security;
