create table public.user_goals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  metric text not null check (metric in ('sessions', 'grams')),
  period text not null check (period in ('week', 'month')),
  target_value numeric not null check (target_value > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- al massimo un obiettivo attivo per utente alla volta
create unique index user_goals_one_active_idx on public.user_goals(user_id) where (is_active);

alter table public.user_goals enable row level security;

create policy "Users can manage their own goals"
  on public.user_goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
