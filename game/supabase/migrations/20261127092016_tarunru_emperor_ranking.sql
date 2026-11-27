begin;

alter table hunt_rankings.runs
  drop constraint runs_boss_check,
  add constraint runs_boss_check check (boss in ('monster001', 'MON_001', 'MON_001_OVERGROWTH', 'revotenshi', 'shikouki', 'kogobon', 'terracular-raven', 'kouencho', 'tarunru-emperor'));

alter table hunt_rankings.scores
  drop constraint scores_boss_check,
  add constraint scores_boss_check check (boss in ('monster001', 'MON_001', 'MON_001_OVERGROWTH', 'revotenshi', 'shikouki', 'kogobon', 'terracular-raven', 'kouencho', 'tarunru-emperor'));

alter table hunt_rankings.flare_runs
  drop constraint runs_boss_check,
  add constraint runs_boss_check check (boss in ('monster001', 'MON_001', 'MON_001_OVERGROWTH', 'revotenshi', 'shikouki', 'kogobon', 'terracular-raven', 'kouencho', 'tarunru-emperor'));

alter table hunt_rankings.flare_scores
  drop constraint scores_boss_check,
  add constraint scores_boss_check check (boss in ('monster001', 'MON_001', 'MON_001_OVERGROWTH', 'revotenshi', 'shikouki', 'kogobon', 'terracular-raven', 'kouencho', 'tarunru-emperor'));

commit;
