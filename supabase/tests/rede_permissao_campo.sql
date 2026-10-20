-- Somente em banco de teste com migrações 0001–0009. Executar com psql e ON_ERROR_STOP=1.
-- Simula o JWT de um usuário autenticado de campo; todas as alterações são revertidas.
begin;
set local search_path = pg_catalog, public, extensions, pg_temp;

insert into auth.users (id, aud, role, email)
values ('d1edc4fb-9330-4b26-a5fe-4f60730c8942', 'authenticated', 'authenticated', 'rede-campo-teste@example.invalid');
insert into perfis (user_id, nome, perfil)
values ('d1edc4fb-9330-4b26-a5fe-4f60730c8942', 'Teste de campo', 'Equipe de campo');

insert into rede_tracado (circuito, id_segmento, rede, trecho, geom)
values ('TESTE-RLS-REDE', 'TESTE-RLS', 'MV', 1,
  st_geogfromtext('SRID=4326;LINESTRING(-42.459386 -22.268155,-42.4593 -22.2681)'));
insert into rede_chaves (circuito, geom)
values ('TESTE-RLS-REDE', st_geogfromtext('SRID=4326;POINT(-42.459386 -22.268155)'));
insert into rede_transformadores (circuito, transformador)
values ('TESTE-RLS-REDE', 'TESTE-RLS');
insert into os_importadas (numero, circuito, circuito_origem, lat, lng, geom, origem_geo)
values ('TESTE-RLS-REDE', 'TESTE-RLS-REDE', 'importado', -22.268155, -42.459386,
  st_geogfromtext('SRID=4326;POINT(-42.459386 -22.268155)'), 'informado');

select set_config('request.jwt.claims', '{"sub":"d1edc4fb-9330-4b26-a5fe-4f60730c8942","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'd1edc4fb-9330-4b26-a5fe-4f60730c8942', true);

-- Controle positivo: existem dados que cada função devolveria sem a restrição de RLS.
do $$
begin
  if perfil_atual() is distinct from 'Equipe de campo'::perfil_enum or perfil_ve_rede() is distinct from false then
    raise exception 'Perfil de campo não identificado ou rede.perfis_com_acesso permite seu acesso';
  end if;
  if jsonb_array_length(rede_tracado_geojson('TESTE-RLS-REDE', true)->'features') <> 1
    or jsonb_array_length(rede_chaves_geojson('TESTE-RLS-REDE')->'features') <> 1
    or jsonb_array_length(rede_transformadores_json('TESTE-RLS-REDE')) <> 1
    or not exists (select 1 from os_importadas_no_raio(-22.268155, -42.459386, 1000) where numero = 'TESTE-RLS-REDE') then
    raise exception 'Controle positivo falhou: dados de teste não foram encontrados';
  end if;
end $$;

set local role authenticated;
do $$
begin
  begin
    if jsonb_array_length(rede_tracado_geojson('TESTE-RLS-REDE', true)->'features') <> 0 then
      raise exception 'Equipe de campo viu o traçado';
    end if;
  exception when insufficient_privilege then null; end;
  begin
    if jsonb_array_length(rede_chaves_geojson('TESTE-RLS-REDE')->'features') <> 0 then
      raise exception 'Equipe de campo viu chaves';
    end if;
  exception when insufficient_privilege then null; end;
  begin
    if jsonb_array_length(rede_transformadores_json('TESTE-RLS-REDE')) <> 0 then
      raise exception 'Equipe de campo viu transformadores';
    end if;
  exception when insufficient_privilege then null; end;
  begin
    if exists (select 1 from os_importadas_no_raio(-22.268155, -42.459386, 1000)) then
      raise exception 'Equipe de campo viu OS no raio';
    end if;
  exception when insufficient_privilege then null; end;
end $$;

rollback;
select 'rede_permissao_campo.sql: OK' as resultado;
