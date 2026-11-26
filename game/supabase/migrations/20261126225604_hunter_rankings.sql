begin;

-- Existing runs and scores are the greatsword board, including records from older clients.
create table hunt_rankings.flare_runs (like hunt_rankings.runs including all);
create table hunt_rankings.flare_scores (like hunt_rankings.scores including all);
alter table hunt_rankings.flare_runs enable row level security;
alter table hunt_rankings.flare_scores enable row level security;
revoke all on hunt_rankings.flare_runs, hunt_rankings.flare_scores from public, anon, authenticated;

create function hunt_rankings.flare_begin_run(p_player uuid, p_boss text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_ticket uuid := gen_random_uuid();
begin
  if p_player is null then raise exception 'Invalid player'; end if;
  insert into hunt_rankings.flare_runs (player_hash, boss, ticket, started_at)
  values (sha256(convert_to(p_player::text, 'UTF8')), p_boss, new_ticket, statement_timestamp())
  on conflict (player_hash, boss) do update
    set ticket = excluded.ticket, started_at = excluded.started_at, finished_ms = null;
  return new_ticket;
end;
$$;

create function hunt_rankings.flare_finish_run(p_player uuid, p_boss text, p_ticket uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  result integer;
begin
  update hunt_rankings.flare_runs
  set finished_ms = coalesce(finished_ms, floor(extract(epoch from statement_timestamp()-started_at)*1000)::integer)
  where player_hash = sha256(convert_to(p_player::text, 'UTF8')) and boss = p_boss and ticket = p_ticket
    and statement_timestamp()-started_at between interval '3 seconds' and interval '1 hour'
  returning finished_ms into result;
  if result is null then raise exception 'Invalid or expired hunt'; end if;
  return result;
end;
$$;

create function hunt_rankings.flare_save_score(p_player uuid, p_boss text, p_ticket uuid, p_nickname text)
returns table (time_ms integer, personal_best boolean)
language plpgsql security definer set search_path = '' as $$
declare
  player bytea := sha256(convert_to(p_player::text, 'UTF8'));
  elapsed integer;
  clean_name text := btrim(p_nickname);
  changed boolean;
begin
  if clean_name is null or char_length(clean_name) not between 1 and 16 or clean_name ~ '[[:cntrl:]<>]' then
    raise exception 'Invalid nickname';
  end if;
  select r.finished_ms into elapsed from hunt_rankings.flare_runs r
  where r.player_hash = player and r.boss = p_boss and r.ticket = p_ticket
    and statement_timestamp()-r.started_at <= interval '1 hour'
  for update;
  if elapsed is null then raise exception 'No completed hunt'; end if;

  insert into hunt_rankings.flare_scores as s (player_hash, boss, nickname, time_ms)
  values (player, p_boss, clean_name, elapsed)
  on conflict (player_hash, boss) do update set
    nickname = excluded.nickname, time_ms = excluded.time_ms, achieved_at = excluded.achieved_at
  where s.time_ms > excluded.time_ms;
  changed := found;
  return query select s.time_ms, changed from hunt_rankings.flare_scores s where s.player_hash = player and s.boss = p_boss;
end;
$$;

create function hunt_rankings.flare_list_scores(p_boss text)
returns table (nickname text, time_ms integer)
language sql stable security definer set search_path = '' as $$
  select s.nickname, s.time_ms from hunt_rankings.flare_scores s where s.boss = p_boss
  order by s.time_ms, s.achieved_at, s.player_hash limit 20;
$$;

-- Explicit class arguments keep the original RPCs available to older clients.

create function public.hunt_begin_run(p_player uuid, p_boss text, p_hunter text)
returns uuid language plpgsql set search_path = '' as $$
begin
  case p_hunter
    when 'greatsword' then return hunt_rankings.begin_run(p_player, p_boss);
    when 'flare' then return hunt_rankings.flare_begin_run(p_player, p_boss);
    else raise exception 'Invalid hunter';
  end case;
end;
$$;

create function public.hunt_finish_run(p_player uuid, p_boss text, p_ticket uuid, p_hunter text)
returns integer language plpgsql set search_path = '' as $$
begin
  case p_hunter
    when 'greatsword' then return hunt_rankings.finish_run(p_player, p_boss, p_ticket);
    when 'flare' then return hunt_rankings.flare_finish_run(p_player, p_boss, p_ticket);
    else raise exception 'Invalid hunter';
  end case;
end;
$$;

create function public.hunt_save_score(p_player uuid, p_boss text, p_ticket uuid, p_nickname text, p_hunter text)
returns table (time_ms integer, personal_best boolean)
language plpgsql set search_path = '' as $$
begin
  case p_hunter
    when 'greatsword' then return query select * from hunt_rankings.save_score(p_player, p_boss, p_ticket, p_nickname);
    when 'flare' then return query select * from hunt_rankings.flare_save_score(p_player, p_boss, p_ticket, p_nickname);
    else raise exception 'Invalid hunter';
  end case;
end;
$$;

create function public.hunt_list_scores(p_boss text, p_hunter text)
returns table (nickname text, time_ms integer)
language plpgsql stable set search_path = '' as $$
begin
  case p_hunter
    when 'greatsword' then return query select * from hunt_rankings.list_scores(p_boss);
    when 'flare' then return query select * from hunt_rankings.flare_list_scores(p_boss);
    else raise exception 'Invalid hunter';
  end case;
end;
$$;

revoke execute on function hunt_rankings.flare_begin_run(uuid,text),
  hunt_rankings.flare_finish_run(uuid,text,uuid),
  hunt_rankings.flare_save_score(uuid,text,uuid,text),
  hunt_rankings.flare_list_scores(text) from public, anon, authenticated;
grant execute on function hunt_rankings.flare_begin_run(uuid,text),
  hunt_rankings.flare_finish_run(uuid,text,uuid),
  hunt_rankings.flare_save_score(uuid,text,uuid,text),
  hunt_rankings.flare_list_scores(text) to anon;

revoke execute on function public.hunt_begin_run(uuid,text,text),
  public.hunt_finish_run(uuid,text,uuid,text),
  public.hunt_save_score(uuid,text,uuid,text,text),
  public.hunt_list_scores(text,text) from public, anon, authenticated;
grant execute on function public.hunt_begin_run(uuid,text,text),
  public.hunt_finish_run(uuid,text,uuid,text),
  public.hunt_save_score(uuid,text,uuid,text,text),
  public.hunt_list_scores(text,text) to anon;

notify pgrst, 'reload schema';

commit;
