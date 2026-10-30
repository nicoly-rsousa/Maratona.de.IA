-- Teste da busca por raio (migração 0009). Rodar SOMENTE em banco de teste/branch, com 0008 e 0009 aplicadas:
--   psql "$DATABASE_URL_TESTE" -v ON_ERROR_STOP=1 -f supabase/tests/rede_raio.sql
-- Tudo roda numa transação e termina em ROLLBACK: nada permanece no banco.
--
-- Garante a ordem (lng, lat) em ST_MakePoint com um par a distância conhecida:
--   A = (-22.268155, -42.459386)  (chave real da base) e B = 1.000 m ao norte de A.
-- Se lat/lng estivessem trocados, B estaria a centenas de km e o teste falharia.
begin;
set local search_path = pg_catalog, public, extensions, pg_temp;

insert into importacoes (fonte, arquivo, linhas_lidas, linhas_gravadas) values ('teste', 'rede_raio.sql', 0, 0);

-- Execução em banco COM a carga real: as asserções avaliam só os circuitos fictícios X-1, X-2 e X-3 (os pontos reais são checados em 2b).
-- Pontos: B a 1.000 m ao norte de A; C a ~990 m; D a ~1.010 m; E em outro circuito a ~500 m; F sem geometria.
insert into os_importadas (numero, circuito, circuito_origem, lat, lng, geom, municipio, origem_geo) values
  ('T-A', 'X-1', 'importado', -22.268155,               -42.459386, st_setsrid(st_makepoint(-42.459386, -22.268155), 4326)::geography, 'MURIAE', 'convertido_utm'),
  ('T-C', 'X-2', 'importado', -22.268155 + 990/111194.93, -42.459386, st_setsrid(st_makepoint(-42.459386, -22.268155 + 990/111194.93), 4326)::geography, 'MURIAE', 'convertido_utm'),
  ('T-D', 'X-2', 'importado', -22.268155 + 1010/111194.93, -42.459386, st_setsrid(st_makepoint(-42.459386, -22.268155 + 1010/111194.93), 4326)::geography, 'MURIAE', 'convertido_utm'),
  ('T-E', 'X-3', 'importado', -22.268155 + 500/111194.93, -42.459386, st_setsrid(st_makepoint(-42.459386, -22.268155 + 500/111194.93), 4326)::geography, 'UBA', 'convertido_utm'),
  ('T-F', 'X-2', 'importado', null, null, null, 'MURIAE', 'desconhecido');

do $$
declare
  v_n int; v_primeira text; v_dist double precision; v_d1000 double precision;
begin
  -- 1) distância no par conhecido ≈ 1.000 m (ordem lng/lat correta)
  select st_distance(
           st_setsrid(st_makepoint(-42.459386, -22.268155), 4326)::geography,
           st_setsrid(st_makepoint(-42.459386, -22.268155 + 1000/111194.93), 4326)::geography)
    into v_d1000;
  assert abs(v_d1000 - 1000) < 5, format('distância do par conhecido = %s m (esperado ~1000)', v_d1000);

  -- 2) raio de 1 km a partir de A, sem excluir circuito: T-A (0), T-E (500), T-C (990); T-D (1010) e T-F (sem geom) ficam fora
  select count(*), min(numero) filter (where distancia_m = (select min(distancia_m) from os_importadas_no_raio(-22.268155, -42.459386, 1000) where circuito in ('X-1','X-2','X-3')))
    into v_n, v_primeira from os_importadas_no_raio(-22.268155, -42.459386, 1000) where circuito in ('X-1','X-2','X-3');
  assert v_n = 3, format('esperado 3 OS em 1 km, veio %s', v_n);
  assert v_primeira = 'T-A', 'a mais próxima deveria ser T-A';

  -- 2b) sem o filtro de circuitos fictícios, as 2 OS reais da carga (JAJ-LUM, ~458 m e ~701 m) também aparecem: o filtro acima é o que isola o teste dos dados reais
  assert (select count(*) from os_importadas_no_raio(-22.268155, -42.459386, 1000)) = v_n + 2, 'sem o filtro, esperava as 3 OS do teste + as 2 reais';
  assert (select array_agg(round(distancia_m)::int order by distancia_m) from os_importadas_no_raio(-22.268155, -42.459386, 1000) where circuito = 'JAJ-LUM') = array[458, 701],
    'as 2 OS reais de JAJ-LUM deveriam estar a 458 m e 701 m';

  -- 3) ordenação por distância: T-A, T-E, T-C
  assert (select array_agg(numero order by distancia_m) from os_importadas_no_raio(-22.268155, -42.459386, 1000) where circuito in ('X-1','X-2','X-3')) = array['T-A','T-E','T-C'],
    'ordem por distância incorreta';

  -- 4) outros circuitos: excluindo X-1, sobram T-E e T-C
  assert (select count(*) from os_importadas_no_raio(-22.268155, -42.459386, 1000, 'X-1') where circuito in ('X-1','X-2','X-3')) = 2, 'excluir circuito falhou';

  -- 5) T-D (1010 m) entra com 1,1 km
  assert (select count(*) from os_importadas_no_raio(-22.268155, -42.459386, 1100) where circuito in ('X-1','X-2','X-3')) = 4, 'raio de 1,1 km deveria incluir T-D';

  -- 6) raio inválido: zero, negativo e acima do máximo (padrão 5000) levantam erro
  begin perform 1 from os_importadas_no_raio(-22.268155, -42.459386, 0); assert false, 'raio 0 deveria falhar';
  exception when sqlstate 'FD400' then null; end;
  begin perform 1 from os_importadas_no_raio(-22.268155, -42.459386, 5001); assert false, 'raio > máximo deveria falhar';
  exception when sqlstate 'FD400' then null; end;
end $$;

rollback;
select 'rede_raio.sql: OK' as resultado;
