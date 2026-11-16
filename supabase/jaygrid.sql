create table if not exists public.jaygrid_plans (
  user_id uuid not null references auth.users (id) on delete cascade,
  term text not null,
  entries jsonb not null default '[]'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, term),
  constraint jaygrid_entries_array check (jsonb_typeof(entries) = 'array'),
  constraint jaygrid_version_positive check (version > 0)
);

alter table public.jaygrid_plans enable row level security;
revoke all on public.jaygrid_plans from anon, authenticated;
grant select, insert, update on public.jaygrid_plans to authenticated;

create policy "Read own JayGrid plans"
on public.jaygrid_plans for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Create own JayGrid plans"
on public.jaygrid_plans for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Update own JayGrid plans"
on public.jaygrid_plans for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
