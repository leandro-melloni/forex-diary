create table public.encrypted_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  envelope jsonb not null check (octet_length(envelope::text) <= 3000000),
  updated_at timestamptz not null default now()
);
alter table public.encrypted_vaults enable row level security;
alter table public.encrypted_vaults force row level security;
revoke all on public.encrypted_vaults from anon, authenticated;
grant select on public.encrypted_vaults to authenticated;
create policy own_mfa_vault on public.encrypted_vaults for select to authenticated
using ((select auth.uid()) = user_id and (select auth.jwt()->>'aal') = 'aal2');

create function public.write_encrypted_vault(p_expected_revision bigint, p_envelope jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); new_revision bigint;
begin
  if actor is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_envelope is null
    or octet_length(p_envelope::text) > 3000000
    or p_envelope->>'v' is distinct from '1'
    or jsonb_typeof(p_envelope) is distinct from 'object'
    or p_envelope - array['v','kdf','wrappedKey','payload'] <> '{}'::jsonb
    or jsonb_typeof(p_envelope->'kdf') is distinct from 'object'
    or (p_envelope->'kdf') - array['name','iterations','salt'] <> '{}'::jsonb
    or jsonb_typeof(p_envelope->'wrappedKey') is distinct from 'object'
    or (p_envelope->'wrappedKey') - array['iv','data'] <> '{}'::jsonb
    or jsonb_typeof(p_envelope->'payload') is distinct from 'object'
    or (p_envelope->'payload') - array['iv','data'] <> '{}'::jsonb
    or p_envelope#>>'{kdf,name}' is distinct from 'PBKDF2-SHA256'
    or p_envelope#>>'{kdf,iterations}' is distinct from '600000'
    or coalesce(p_envelope#>>'{kdf,salt}','') !~ '^[A-Za-z0-9+/]{22}==$'
    or coalesce(p_envelope#>>'{wrappedKey,iv}','') !~ '^[A-Za-z0-9+/]{16}$'
    or coalesce(p_envelope#>>'{wrappedKey,data}','') !~ '^[A-Za-z0-9+/]{64}$'
    or coalesce(p_envelope#>>'{payload,iv}','') !~ '^[A-Za-z0-9+/]{16}$'
    or coalesce(p_envelope#>>'{payload,data}','') !~ '^[A-Za-z0-9+/]+={0,2}$'
  then raise exception 'Invalid encrypted envelope' using errcode = '22023'; end if;
  if p_expected_revision = 0 then
    insert into public.encrypted_vaults(user_id,envelope) values(actor,p_envelope)
    on conflict do nothing returning revision into new_revision;
  else
    update public.encrypted_vaults set envelope=p_envelope, revision=revision+1, updated_at=now()
    where user_id=actor and revision=p_expected_revision returning revision into new_revision;
  end if;
  if new_revision is null then raise exception 'Concurrent modification' using errcode='40001'; end if;
  return new_revision;
end $$;
revoke all on function public.write_encrypted_vault(bigint,jsonb) from public, anon;
grant execute on function public.write_encrypted_vault(bigint,jsonb) to authenticated;

create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  hour_start timestamptz not null,
  requests integer not null check(requests between 1 and 3),
  primary key(user_id,hour_start)
);
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
revoke all on public.ai_usage from anon,authenticated;

create function public.reserve_ai_request() returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); bucket timestamptz := date_trunc('hour',now()); consumed integer;
begin
  if actor is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'MFA required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if (select coalesce(sum(requests),0) from public.ai_usage where user_id=actor and hour_start>=date_trunc('day',now())) >= 10 then
    raise exception 'Daily AI limit' using errcode='P0001';
  end if;
  insert into public.ai_usage(user_id,hour_start,requests) values(actor,bucket,1)
  on conflict(user_id,hour_start) do update set requests=public.ai_usage.requests+1
  where public.ai_usage.requests<3 returning requests into consumed;
  if consumed is null then raise exception 'Hourly AI limit' using errcode='P0001'; end if;
end $$;
revoke all on function public.reserve_ai_request() from public,anon;
grant execute on function public.reserve_ai_request() to authenticated;
