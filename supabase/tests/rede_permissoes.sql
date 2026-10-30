-- Banco de teste com 0001–0014 (rede.perfis_com_acesso = só Administrador). Executar inteiro em uma sessão; tudo termina em rollback.
-- Simula papéis e JWT no banco; não substitui um login real nem uma chamada HTTP.
begin;

insert into auth.users (id, aud, role, email)
values ('6d246d5e-96b1-40a8-a1e9-ec07881a0473', 'authenticated', 'authenticated', 'rede-permitido-teste@example.invalid');
insert into public.perfis (user_id, nome, perfil)
values ('6d246d5e-96b1-40a8-a1e9-ec07881a0473', 'Teste permitido', 'Administrador');
insert into auth.users (id, aud, role, email)
values ('7c2d273c-0f08-4d9a-a454-8e217a641349', 'authenticated', 'authenticated', 'rede-campo-acesso@example.invalid');
insert into public.perfis (user_id, nome, perfil)
values ('7c2d273c-0f08-4d9a-a454-8e217a641349', 'Teste campo', 'Equipe de campo');
insert into public.configuracoes (chave, valor) values
  ('rede.teste_nao_permitida', 'true'::jsonb), ('teste.nao_permitida', 'true'::jsonb);
insert into public.circuitos (codigo) values ('TESTE-ACESSO-REDE');
insert into public.rede_tracado (circuito, id_segmento, rede, trecho, geom)
values ('TESTE-ACESSO-REDE', 'TESTE-ACESSO', 'MV', 1,
  extensions.st_geogfromtext('SRID=4326;LINESTRING(-42.459386 -22.268155,-42.4593 -22.2681)'));
insert into public.rede_chaves (circuito, geom)
values ('TESTE-ACESSO-REDE', extensions.st_geogfromtext('SRID=4326;POINT(-42.459386 -22.268155)'));
insert into public.rede_transformadores (circuito, transformador)
values ('TESTE-ACESSO-REDE', 'TESTE-ACESSO');
insert into public.os_importadas (numero, circuito, circuito_origem, lat, lng, geom, origem_geo)
values ('TESTE-ACESSO-REDE', 'TESTE-ACESSO-REDE', 'importado', -22.268155, -42.459386,
  extensions.st_geogfromtext('SRID=4326;POINT(-42.459386 -22.268155)'), 'informado');

-- Falha se anon ainda tiver EXECUTE efetivo, inclusive através de PUBLIC.
do $$
declare f text;
begin
  foreach f in array array['public.rede_tracado_geojson(text,boolean)', 'public.rede_chaves_geojson(text)',
    'public.rede_transformadores_json(text)', 'public.os_importadas_no_raio(double precision,double precision,double precision,text,text)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'anon ainda pode executar %', f;
    end if;
  end loop;
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                 where e.extname = 'postgis' and n.nspname = 'extensions') then
    raise exception 'PostGIS não está instalado em extensions';
  end if;
  if to_regclass('public.spatial_ref_sys') is not null then
    raise exception 'spatial_ref_sys existe em public';
  end if;
  if has_column_privilege('authenticated', 'public.configuracoes', 'atualizado_em', 'select') then
    raise exception 'authenticated pode ler coluna não autorizada de configuracoes';
  end if;
end $$;

set local role anon;
do $$
begin
  begin perform public.rede_tracado_geojson('TESTE-ACESSO-REDE', true); raise exception 'anon chamou traçado';
  exception when insufficient_privilege then null; end;
  begin perform public.rede_chaves_geojson('TESTE-ACESSO-REDE'); raise exception 'anon chamou chaves';
  exception when insufficient_privilege then null; end;
  begin perform public.rede_transformadores_json('TESTE-ACESSO-REDE'); raise exception 'anon chamou transformadores';
  exception when insufficient_privilege then null; end;
  begin perform * from public.os_importadas_no_raio(-22.268155, -42.459386, 1000); raise exception 'anon chamou raio';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"6d246d5e-96b1-40a8-a1e9-ec07881a0473","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '6d246d5e-96b1-40a8-a1e9-ec07881a0473', true);
set local role authenticated;
do $$
begin
  if public.perfil_ve_rede() is distinct from true then raise exception 'Administrador não tem acesso à rede'; end if;
  if jsonb_array_length(public.rede_tracado_geojson('TESTE-ACESSO-REDE', true)->'features') <> 1 then
    raise exception 'Administrador não recebeu traçado'; end if;
  if jsonb_array_length(public.rede_chaves_geojson('TESTE-ACESSO-REDE')->'features') <> 1 then
    raise exception 'Administrador não recebeu chave'; end if;
  if jsonb_array_length(public.rede_transformadores_json('TESTE-ACESSO-REDE')) <> 1 then
    raise exception 'Administrador não recebeu transformador'; end if;
  if not exists (select 1 from public.os_importadas_no_raio(-22.268155, -42.459386, 1000) where numero = 'TESTE-ACESSO-REDE') then
    raise exception 'Administrador não recebeu OS no raio'; end if;
  if (select array_agg(chave order by chave) from public.configuracoes) is distinct from
    array['rede.mapa_prioridade_legada', 'rede.raio_max_m', 'rede.raio_padrao_m']::text[] then
    raise exception 'Administrador deve ler exatamente as três chaves de rede permitidas'; end if;
  if exists (select 1 from public.configuracoes where chave not in
    ('rede.raio_padrao_m', 'rede.raio_max_m', 'rede.mapa_prioridade_legada')) then
    raise exception 'Administrador pode ler outras configurações'; end if;
  begin
    perform atualizado_em from public.configuracoes;
    raise exception 'Administrador pode ler coluna atualizado_em';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"7c2d273c-0f08-4d9a-a454-8e217a641349","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '7c2d273c-0f08-4d9a-a454-8e217a641349', true);
set local role authenticated;
do $$
begin
  if public.perfil_atual() is distinct from 'Equipe de campo'::public.perfil_enum
    or public.perfil_ve_rede() is distinct from false then
    raise exception 'Identidade ou permissão de Equipe de campo incorreta'; end if;
  if exists (select 1 from public.circuitos)
    or exists (select 1 from public.rede_tracado)
    or exists (select 1 from public.rede_chaves)
    or exists (select 1 from public.rede_transformadores)
    or exists (select 1 from public.os_importadas)
    or exists (select 1 from public.configuracoes) then
    raise exception 'Equipe de campo conseguiu ler dados protegidos'; end if;
end $$;
reset role;

-- Perfis que NÃO estão em rede.perfis_com_acesso (só o Administrador está): sem acesso nenhum, nem às funções.
-- Cada perfil é testado com seu próprio JWT simulado; o controle positivo (Administrador) está acima.
do $$
declare
  v_perfil text; v_id uuid;
begin
  foreach v_perfil in array array['Supervisor', 'Despachante', 'Atendente', 'Usuário Chave'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, aud, role, email)
      values (v_id, 'authenticated', 'authenticated', 'rede-negado-' || v_id || '@example.invalid');
    insert into public.perfis (user_id, nome, perfil) values (v_id, 'Teste negado ' || v_perfil, v_perfil::public.perfil_enum);

    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    execute 'set local role authenticated';
    begin
      if public.perfil_ve_rede() is distinct from false then raise exception '% tem acesso à rede', v_perfil; end if;
      if exists (select 1 from public.circuitos) or exists (select 1 from public.rede_tracado)
        or exists (select 1 from public.rede_chaves) or exists (select 1 from public.rede_transformadores)
        or exists (select 1 from public.os_importadas) or exists (select 1 from public.configuracoes)
        or exists (select 1 from public.regional) then
        raise exception '% leu dados protegidos da rede', v_perfil; end if;
      if jsonb_array_length(public.rede_tracado_geojson('TESTE-ACESSO-REDE', true)->'features') <> 0
        or jsonb_array_length(public.rede_chaves_geojson('TESTE-ACESSO-REDE')->'features') <> 0
        or jsonb_array_length(public.rede_transformadores_json('TESTE-ACESSO-REDE')) <> 0
        or exists (select 1 from public.os_importadas_no_raio(-22.268155, -42.459386, 1000)) then
        raise exception '% recebeu dados pelas funções de rede', v_perfil; end if;
    exception when others then
      execute 'reset role';
      raise;
    end;
    execute 'reset role';
  end loop;
end $$;
rollback;
select 'rede_permissoes.sql: OK' as resultado;
