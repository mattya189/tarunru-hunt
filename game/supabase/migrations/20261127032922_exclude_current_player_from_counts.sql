begin;

create function hunt_rankings.monster_player_counts(p_player uuid)
returns table (boss text, player_count bigint)
language sql stable security definer set search_path = '' as $$
  with players as (
    select boss, player_hash from hunt_rankings.runs
    union
    select boss, player_hash from hunt_rankings.flare_runs
    union
    select boss, player_hash from hunt_rankings.scores
    union
    select boss, player_hash from hunt_rankings.flare_scores
  )
  select p.boss,
         count(*) filter (where p.player_hash is distinct from sha256(convert_to(p_player::text, 'UTF8')))
  from players p
  group by p.boss;
$$;

create or replace function hunt_rankings.monster_player_counts()
returns table (boss text, player_count bigint)
language sql stable security invoker set search_path = '' as $$
  select * from hunt_rankings.monster_player_counts(null::uuid);
$$;

create function public.hunt_monster_player_counts(p_player uuid)
returns table (boss text, player_count bigint)
language sql stable set search_path = '' as $$
  select * from hunt_rankings.monster_player_counts(p_player);
$$;

revoke execute on function hunt_rankings.monster_player_counts(uuid), public.hunt_monster_player_counts(uuid)
  from public, anon, authenticated;
grant execute on function hunt_rankings.monster_player_counts(uuid), public.hunt_monster_player_counts(uuid)
  to anon;

notify pgrst, 'reload schema';

commit;
