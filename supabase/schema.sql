-- =====================================================================
-- Esquema Supabase para histórico de forecasts + backtesting
-- Ejecuta este SQL en: Supabase → SQL Editor → New query
-- =====================================================================

-- 1) Tabla de "corridas" de forecast (una fila por cada vez que se proyecta)
create table if not exists forecast_runs (
    id            uuid primary key default gen_random_uuid(),
    ticker        text        not null,
    run_date      date        not null default current_date,  -- día en que se corrió
    last_close    numeric     not null,                        -- precio base (S0)
    horizon       int         not null,
    model_version text,                                        -- ej. fecha de entrenamiento
    mu_daily      numeric,
    sigma_daily   numeric,
    directional_accuracy numeric,
    created_at    timestamptz not null default now()
);

create index if not exists idx_runs_ticker_date
    on forecast_runs (ticker, run_date desc);

-- 2) Tabla de puntos del forecast (una fila por día proyectado, por corrida)
create table if not exists forecast_points (
    id            bigint generated always as identity primary key,
    run_id        uuid  not null references forecast_runs(id) on delete cascade,
    ticker        text  not null,
    target_date   date  not null,          -- día que se está prediciendo
    predicted     numeric,                 -- curva XGBoost
    mc_median     numeric,                 -- mediana Monte Carlo
    mc_p5         numeric,
    mc_p25        numeric,
    mc_p75        numeric,
    mc_p95        numeric,
    actual_close  numeric,                 -- se rellena a posteriori (backfill)
    created_at    timestamptz not null default now()
);

create index if not exists idx_points_ticker_target
    on forecast_points (ticker, target_date);
create unique index if not exists uq_points_run_target
    on forecast_points (run_id, target_date);

-- 3) Vista de precisión: compara predicción vs. real (cuando ya hay actual_close)
create or replace view forecast_accuracy as
select
    ticker,
    target_date,
    predicted,
    actual_close,
    (predicted - actual_close)                          as error_abs,
    case when actual_close <> 0
         then abs(predicted - actual_close) / actual_close
         else null end                                  as ape,     -- abs pct error
    case when actual_close between mc_p5 and mc_p95
         then true else false end                       as within_p5_p95
from forecast_points
where actual_close is not null;

-- =====================================================================
-- (Opcional) Row Level Security. Si tu API usa la SERVICE KEY, puedes
-- dejar RLS desactivado. Si expones estas tablas al cliente, activa RLS:
-- =====================================================================
-- alter table forecast_runs   enable row level security;
-- alter table forecast_points enable row level security;
-- create policy "read_all_runs"   on forecast_runs   for select using (true);
-- create policy "read_all_points" on forecast_points for select using (true);
