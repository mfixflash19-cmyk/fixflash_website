-- FixFlasH production starter schema for Supabase/Postgres
-- Run this whole file in Supabase Dashboard > SQL Editor > New query.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Customer',
  role text not null default 'customer' check (role in ('customer','admin')),
  balance_mmk numeric(14,2) not null default 0 check (balance_mmk >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  service_id text not null,
  service_name text not null,
  details text not null check (char_length(details) between 1 and 3000),
  price_mmk numeric(14,2) not null check (price_mmk >= 0),
  status text not null default 'pending' check (status in ('pending','in_progress','completed','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  network text not null check (network in ('USDT TRC20','USDT ERC20')),
  amount_usdt numeric(18,6) not null check (amount_usdt > 0),
  txid text not null check (char_length(txid) between 8 and 200),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  credited_mmk numeric(14,2),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(network, txid)
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  deposit_id uuid unique references public.deposit_requests(id) on delete restrict,
  amount_mmk numeric(14,2) not null check (amount_mmk <> 0),
  kind text not null check (kind in ('deposit_credit','admin_adjustment','order_charge','refund')),
  note text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''), split_part(new.email,'@',1), 'Customer'))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.wallet_transactions enable row level security;

-- Helper checks role without recursive RLS policy evaluation.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

 drop policy if exists "profile read own or admin" on public.profiles;
create policy "profile read own or admin" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());
drop policy if exists "profile update own basic fields" on public.profiles;
create policy "profile update own basic fields" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
-- Do not allow customers to edit role or balance through the client; column grants enforce this.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "customer create own order" on public.orders;
create policy "customer create own order" on public.orders for insert to authenticated
with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "read own orders or admin" on public.orders;
create policy "read own orders or admin" on public.orders for select to authenticated
using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admin update orders" on public.orders;
create policy "admin update orders" on public.orders for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customer create own deposit request" on public.deposit_requests;
create policy "customer create own deposit request" on public.deposit_requests for insert to authenticated
with check (user_id = auth.uid() and status = 'pending' and credited_mmk is null and reviewed_by is null);
drop policy if exists "read own deposits or admin" on public.deposit_requests;
create policy "read own deposits or admin" on public.deposit_requests for select to authenticated
using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admin review deposits" on public.deposit_requests;
create policy "admin review deposits" on public.deposit_requests for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own wallet ledger or admin" on public.wallet_transactions;
create policy "read own wallet ledger or admin" on public.wallet_transactions for select to authenticated
using (user_id = auth.uid() or public.is_admin());
-- No client insert/update/delete policies for wallet ledger. Changes happen only through trusted SQL functions.

create or replace function public.admin_approve_deposit(p_deposit_id uuid, p_credit_mmk numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deposit_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_credit_mmk is null or p_credit_mmk <= 0 then raise exception 'Credit amount must be positive'; end if;
  select * into d from public.deposit_requests where id = p_deposit_id for update;
  if not found then raise exception 'Deposit request not found'; end if;
  if d.status <> 'pending' then raise exception 'Deposit request has already been reviewed'; end if;
  update public.deposit_requests set status='approved', credited_mmk=p_credit_mmk,
    reviewed_by=auth.uid(), reviewed_at=now() where id=d.id;
  update public.profiles set balance_mmk=balance_mmk+p_credit_mmk where id=d.user_id;
  insert into public.wallet_transactions(user_id,deposit_id,amount_mmk,kind,note)
  values(d.user_id,d.id,p_credit_mmk,'deposit_credit','Admin-approved USDT deposit: '||d.network);
end;
$$;
revoke all on function public.admin_approve_deposit(uuid,numeric) from public;
grant execute on function public.admin_approve_deposit(uuid,numeric) to authenticated;

create or replace function public.admin_reject_deposit(p_deposit_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deposit_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into d from public.deposit_requests where id=p_deposit_id for update;
  if not found then raise exception 'Deposit request not found'; end if;
  if d.status <> 'pending' then raise exception 'Deposit request has already been reviewed'; end if;
  update public.deposit_requests set status='rejected', reviewed_by=auth.uid(), reviewed_at=now() where id=d.id;
end;
$$;
revoke all on function public.admin_reject_deposit(uuid) from public;
grant execute on function public.admin_reject_deposit(uuid) to authenticated;
