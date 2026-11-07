-- Requires the two existing admin migrations and their baseline UUID schema.
begin;

create table public.prompt_chain_runs (
  id uuid primary key default gen_random_uuid(),
  prompt_chain_id uuid not null references public.prompt_chains(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  input text not null,
  image_url text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  outputs jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now()
);
create index on public.prompt_chain_runs(prompt_chain_id, created_at desc);
alter table public.prompt_chain_runs enable row level security;
grant select, insert, update on public.prompt_chain_runs to authenticated;
create policy "Superadmin runs" on public.prompt_chain_runs for all to authenticated
  using ((select public.is_superadmin()))
  with check ((select public.is_superadmin()) and user_id = (select auth.uid()));

-- All editor writes share a chain-row lock. Reordering is one transaction,
-- including an intermediate unused position to respect the unique constraint.
create function public.edit_prompt_chain(operation text, chain_id uuid, payload jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid; step_id uuid; target_id uuid; old_order integer; target_order integer; spare integer;
begin
  if not coalesce(public.is_superadmin(), false) then
    raise exception 'Superadmin access required' using errcode = '42501';
  end if;
  if operation = 'create_chain' then
    if length(trim(coalesce(payload->>'name', ''))) not between 1 and 200 then raise exception 'Name must contain 1–200 characters'; end if;
    insert into public.prompt_chains(name, description)
      values (trim(payload->>'name'), left(payload->>'description', 4000)) returning id into result_id;
    return result_id;
  end if;
  perform 1 from public.prompt_chains where id = chain_id for update;
  if not found then raise exception 'Chain no longer exists'; end if;
  if operation = 'update_chain' then
    if length(trim(coalesce(payload->>'name', ''))) not between 1 and 200 then raise exception 'Name must contain 1–200 characters'; end if;
    update public.prompt_chains set name = trim(payload->>'name'), description = left(payload->>'description', 4000) where id = chain_id;
  elsif operation = 'delete_chain' then
    -- Preserve existing generation requests and their response history.
    update public.generation_requests set prompt_chain_id = null where prompt_chain_id = chain_id;
    delete from public.prompt_chain_mix where prompt_chain_id = chain_id;
    delete from public.prompt_chain_steps where prompt_chain_id = chain_id;
    delete from public.prompt_chains where id = chain_id;
  elsif operation in ('create_step', 'update_step') then
    if length(trim(coalesce(payload->>'user_prompt', ''))) not between 1 and 16000 then raise exception 'User prompt must contain 1–16000 characters'; end if;
    if operation = 'create_step' then
      if (select count(*) from public.prompt_chain_steps where prompt_chain_id = chain_id) >= 8 then raise exception 'A chain supports up to eight steps'; end if;
      insert into public.prompt_chain_steps(prompt_chain_id, step_order, system_prompt, user_prompt, llm_model_id)
        select chain_id, coalesce(max(step_order), -1) + 1, left(payload->>'system_prompt', 16000), payload->>'user_prompt', nullif(payload->>'llm_model_id', '')::uuid
        from public.prompt_chain_steps where prompt_chain_id = chain_id returning id into result_id;
      return result_id;
    else
      update public.prompt_chain_steps set system_prompt = left(payload->>'system_prompt', 16000), user_prompt = payload->>'user_prompt',
        llm_model_id = nullif(payload->>'llm_model_id', '')::uuid
        where id = (payload->>'id')::uuid and prompt_chain_id = chain_id;
      if not found then raise exception 'Step no longer exists'; end if;
    end if;
  elsif operation = 'delete_step' then
    delete from public.prompt_chain_steps where id = (payload->>'id')::uuid and prompt_chain_id = chain_id;
    if not found then raise exception 'Step no longer exists'; end if;
  elsif operation = 'move_step' then
    if coalesce(payload->>'direction', '') not in ('up', 'down') then raise exception 'Invalid direction'; end if;
    step_id := (payload->>'id')::uuid;
    select step_order into old_order from public.prompt_chain_steps where id = step_id and prompt_chain_id = chain_id;
    if not found then raise exception 'Step no longer exists'; end if;
    if payload->>'direction' = 'up' then
      select id, step_order into target_id, target_order from public.prompt_chain_steps
        where prompt_chain_id = chain_id and step_order < old_order order by step_order desc limit 1;
    else
      select id, step_order into target_id, target_order from public.prompt_chain_steps
        where prompt_chain_id = chain_id and step_order > old_order order by step_order limit 1;
    end if;
    if target_id is not null then
      select max(step_order) + 1 into spare from public.prompt_chain_steps where prompt_chain_id = chain_id;
      update public.prompt_chain_steps set step_order = spare where id = step_id;
      update public.prompt_chain_steps set step_order = old_order where id = target_id;
      update public.prompt_chain_steps set step_order = target_order where id = step_id;
    end if;
  else raise exception 'Unsupported operation';
  end if;
  return chain_id;
end;
$$;
revoke all on function public.edit_prompt_chain(text, uuid, jsonb) from public, anon;
grant execute on function public.edit_prompt_chain(text, uuid, jsonb) to authenticated;
commit;
