-- ============================================================
-- VuxPet — Schema do Supabase
-- Cole no SQL Editor do Supabase e clique em "Run".
-- ============================================================

-- ---------- 1. PROFILES ----------
create table if not exists public.profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    full_name   text not null,
    created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Dados públicos do usuário (espelha auth.users).';

-- ---------- 1B. PROFESSIONALS (ÁREA DO PROFISSIONAL) ----------
create table if not exists public.professionals (
    id          uuid primary key references auth.users (id) on delete cascade,
    full_name   text not null,
    crmv        text,
    clinic      text not null default 'PetCare Clinic',
    created_at  timestamptz not null default now()
);

comment on table public.professionals is 'Veterinários/equipe: dá acesso à agenda da própria clínica.';

-- Cria o profile (e o profissional, quando o cadastro traz role=professional)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, full_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
    )
    on conflict (id) do nothing;

    if coalesce(new.raw_user_meta_data ->> 'role', '') = 'professional' then
        insert into public.professionals (id, full_name, crmv, clinic)
        values (
            new.id,
            coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
            nullif(coalesce(new.raw_user_meta_data ->> 'crmv', ''), ''),
            coalesce(nullif(new.raw_user_meta_data ->> 'clinic', ''), 'PetCare Clinic')
        )
        on conflict (id) do nothing;
    end if;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------- 2. PETS ----------
create table if not exists public.pets (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
    name        text not null check (char_length(trim(name)) between 2 and 60),
    species     text not null check (species in ('Cachorro', 'Gato', 'Outro')),
    breed       text,
    age         text,
    created_at  timestamptz not null default now()
);

create index if not exists pets_owner_id_idx on public.pets (owner_id);

-- ---------- 3. APPOINTMENTS ----------
create table if not exists public.appointments (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
    pet_id      uuid references public.pets (id) on delete cascade,
    pet_name    text not null,
    vaccine     text not null,
    date        date not null,
    time        text not null,
    clinic      text not null,
    notes       text,
    status      text not null default 'Agendada'
                check (status in ('Agendada', 'Confirmada', 'Concluída', 'Cancelada')),
    created_at  timestamptz not null default now()
);

-- Colunas exibidas na área do profissional (seguras de re-executar)
alter table public.appointments add column if not exists pet_species text;
alter table public.appointments add column if not exists tutor_name   text;

-- Recria a checagem de status caso a tabela já exista com a versão antiga
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments
    add constraint appointments_status_check
    check (status in ('Agendada', 'Confirmada', 'Concluída', 'Cancelada'));

create index if not exists appointments_owner_id_idx on public.appointments (owner_id);
create index if not exists appointments_date_idx on public.appointments (date);
create index if not exists appointments_clinic_idx on public.appointments (clinic);

-- ---------- 4. ROW LEVEL SECURITY ----------
alter table public.profiles      enable row level security;
alter table public.professionals enable row level security;
alter table public.pets          enable row level security;
alter table public.appointments  enable row level security;

-- Clínica do usuário logado (null para clientes)
create or replace function public.my_clinic()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select clinic from public.professionals where id = auth.uid();
$$;

-- professionals: cada profissional lê o próprio registro
drop policy if exists "professionals_select_own" on public.professionals;
create policy "professionals_select_own"
    on public.professionals for select
    using (id = (select auth.uid()));

-- profiles: o próprio usuário lê/atualiza o seu
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select
    using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

-- pets: CRUD restrito ao dono
drop policy if exists "pets_select_own" on public.pets;
create policy "pets_select_own"
    on public.pets for select
    using (owner_id = (select auth.uid()));

drop policy if exists "pets_insert_own" on public.pets;
create policy "pets_insert_own"
    on public.pets for insert
    with check (owner_id = (select auth.uid()));

drop policy if exists "pets_update_own" on public.pets;
create policy "pets_update_own"
    on public.pets for update
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

drop policy if exists "pets_delete_own" on public.pets;
create policy "pets_delete_own"
    on public.pets for delete
    using (owner_id = (select auth.uid()));

-- appointments: CRUD restrito ao dono
drop policy if exists "appointments_select_own" on public.appointments;
create policy "appointments_select_own"
    on public.appointments for select
    using (owner_id = (select auth.uid()));

drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own"
    on public.appointments for insert
    with check (owner_id = (select auth.uid()));

drop policy if exists "appointments_update_own" on public.appointments;
create policy "appointments_update_own"
    on public.appointments for update
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

drop policy if exists "appointments_delete_own" on public.appointments;
create policy "appointments_delete_own"
    on public.appointments for delete
    using (owner_id = (select auth.uid()));

-- appointments: o profissional vê e atualiza os da própria clínica
drop policy if exists "appointments_select_clinic" on public.appointments;
create policy "appointments_select_clinic"
    on public.appointments for select
    using (clinic = public.my_clinic());

drop policy if exists "appointments_update_clinic" on public.appointments;
create policy "appointments_update_clinic"
    on public.appointments for update
    using (clinic = public.my_clinic())
    with check (clinic = public.my_clinic());
