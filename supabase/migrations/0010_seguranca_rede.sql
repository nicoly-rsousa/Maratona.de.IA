-- 0010: acesso à rede e restrição de funções. Aplicar após 0009.
-- Mantém privilégios preexistentes de service_role; PUBLIC e anon não podem executar.
begin;

revoke execute on function public.perfil_atual(), public.perfil_ve_rede(), public.pode_ver_cidade(text)
  from public, anon;
grant execute on function public.perfil_atual(), public.perfil_ve_rede(), public.pode_ver_cidade(text)
  to authenticated;

revoke execute on function public.rede_tracado_geojson(text, boolean), public.rede_chaves_geojson(text),
  public.rede_transformadores_json(text), public.os_importadas_no_raio(double precision, double precision, double precision, text, text)
  from public, anon;
grant execute on function public.rede_tracado_geojson(text, boolean), public.rede_chaves_geojson(text),
  public.rede_transformadores_json(text), public.os_importadas_no_raio(double precision, double precision, double precision, text, text)
  to authenticated;

-- PostGIS fica fora do schema exposto; não se alteram privilégios de objetos gerenciados.
alter function public.rede_tracado_geojson(text, boolean) set search_path = pg_catalog, public, extensions, pg_temp;
alter function public.rede_chaves_geojson(text) set search_path = pg_catalog, public, extensions, pg_temp;
alter function public.rede_transformadores_json(text) set search_path = pg_catalog, public, extensions, pg_temp;
alter function public.os_importadas_no_raio(double precision, double precision, double precision, text, text)
  set search_path = pg_catalog, public, extensions, pg_temp;

-- As funções são SECURITY INVOKER: precisam de SELECT nas tabelas, além das políticas
-- da 0009 (perfil_ve_rede) e da política regional_leitura da 0008.
grant select on public.circuitos, public.rede_tracado, public.rede_chaves,
  public.rede_transformadores, public.os_importadas, public.regional to authenticated;

-- Apenas as três configurações de rede necessárias aos perfis autorizados.
grant select (chave, valor) on public.configuracoes to authenticated;
create policy configuracoes_raio_leitura on public.configuracoes for select to authenticated
  using (chave in ('rede.raio_padrao_m', 'rede.raio_max_m', 'rede.mapa_prioridade_legada')
    and public.perfil_ve_rede());

commit;
