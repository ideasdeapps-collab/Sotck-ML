-- Trading Simulator v1

create table if not exists simulations (
    id uuid primary key default gen_random_uuid(),
    ticker text not null,
    initial_capital numeric not null default 10000,
    strategy text default 'AI Hybrid v1',
    status text default 'completed',
    final_equity numeric,
    return_pct numeric,
    created_at timestamptz default now()
);

create table if not exists simulated_trades (
    id bigint generated always as identity primary key,
    simulation_id uuid references simulations(id) on delete cascade,
    ticker text not null,
    action text not null,
    price numeric not null,
    shares numeric,
    pnl numeric default 0,
    confidence numeric,
    reason text,
    timestamp timestamptz default now()
);

create index if not exists idx_sim_trades_simulation
on simulated_trades(simulation_id);

create table if not exists simulation_metrics (
    id bigint generated always as identity primary key,
    simulation_id uuid references simulations(id) on delete cascade,
    total_trades int,
    win_rate numeric,
    max_drawdown numeric,
    sharpe numeric,
    created_at timestamptz default now()
);
