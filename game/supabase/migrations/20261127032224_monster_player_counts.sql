begin;

-- A browser may have both a run and a score in both hunter categories.
create function hunt_rankings.monster_player_counts()
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
  select p.boss, count(*) from players p group by p.boss;
$$;

create function public.hunt_monster_player_counts()
returns table (boss text, player_count bigint)
language sql stable set search_path = '' as $$
  select * from hunt_rankings.monster_player_counts();
$$;

revoke execute on function hunt_rankings.monster_player_counts(), public.hunt_monster_player_counts()
  from public, anon, authenticated;
grant execute on function hunt_rankings.monster_player_counts(), public.hunt_monster_player_counts()
  to anon;

notify pgrst, 'reload schema';

commit;
