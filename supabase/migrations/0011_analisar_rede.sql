-- 0011: ANALYZE das tabelas de rede ao fim da importação (o importador só fala REST/service_role).
-- Só o service_role executa; anon, authenticated e PUBLIC não.
begin;

create or replace function public.analisar_tabelas_rede() returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  analyze public.circuitos;
  analyze public.rede_chaves;
  analyze public.rede_transformadores;
  analyze public.rede_tracado;
  analyze public.os_importadas;
  analyze public.regional;
end $$;

revoke execute on function public.analisar_tabelas_rede() from public, anon, authenticated;
grant execute on function public.analisar_tabelas_rede() to service_role;

commit;
