-- Teste da gravação em lote do cadastro de OS (migração 0015). Banco de teste/local com 0001–0015.
-- Tudo roda numa transação e termina em ROLLBACK: nada permanece. psql -v ON_ERROR_STOP=1 -f supabase/tests/importar_os_pendentes.sql
begin;
set local search_path = pg_catalog, public, extensions, pg_temp;

insert into cidades (id, nome, municipio_origem) values ('TSTX', 'MUNICIPIO TESTE', 'MUNICIPIO TESTE');
insert into circuitos (codigo) values ('TESTE-CIRC-IMP');

-- item de teste: já traz a prioridade calculada (como a API envia)
create function pg_temp.item(p_num text, p_circ text, p_lat double precision, p_lng double precision, p_end text default 'Poste 1-1 — MUNICIPIO TESTE')
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'numero_origem', p_num, 'cidade_id', 'TSTX', 'endereco', p_end, 'origem_endereco', 'derivado_poste', 'poste_codigo', '1-1',
    'lat', p_lat, 'lng', p_lng, 'origem_geo', case when p_lat is null then 'desconhecido' else 'convertido_utm' end,
    'circuito', p_circ, 'municipio', 'MUNICIPIO TESTE', 'tipo', 'Corretiva', 'fatos', jsonb_build_object('espera', 'Até 1 h'),
    'status', case when p_lat is null then 'Em triagem' else 'Aguardando despacho' end, 'aberta_em', now(),
    'prioridade_legada', 'ALTA',
    'resultado', jsonb_build_object('versao', 1, 'itens', '[]'::jsonb, 'pontos', 10, 'codigoFaixa', 2, 'regrasAplicadas', '[]'::jsonb,
                                    'nivel', 2, 'codigo', 2, 'motivoPrincipal', 'Pontuação teste')));
$$;

do $$
declare
  lote jsonb := jsonb_build_array(
    pg_temp.item('OS-T-1', 'TESTE-CIRC-IMP', -21.1, -43.0),
    pg_temp.item('OS-T-2  001/2026', 'CIRCUITO-QUE-NAO-EXISTE', null, null),
    pg_temp.item('OS-T-3', null, null, null));
  r1 text[]; r2 text[]; n int; v record;
begin
  -- 1ª gravação: as 3 entram
  select array_agg(os_numero order by os_numero_origem), count(*) filter (where os_criada) into r1, n from importar_os_pendentes(lote, null);
  assert n = 3, format('esperava 3 criadas na 1ª gravação, veio %s', n);
  assert (select count(*) from ordens_servico where numero_origem like 'OS-T-%') = 3, 'deveria haver 3 OS gravadas';
  assert (select count(*) from resultados_prioridade where os_id in (select id from ordens_servico where numero_origem like 'OS-T-%')) = 3, 'resultado imutável de cada OS';
  assert (select count(*) from solicitacoes where os_id in (select id from ordens_servico where numero_origem like 'OS-T-%')) = 3, 'solicitação de abertura de cada OS';
  assert r1[1] ~ '^TSTX-[0-9]{4}-0001$', format('numeração por cidade: %s', r1[1]);

  -- número de origem com espaços internos preservado exatamente
  assert exists (select 1 from ordens_servico where numero_origem = 'OS-T-2  001/2026'), 'espaços internos do número de origem preservados';

  -- REIMPORTAR não duplica nem consome numeração
  select array_agg(os_numero order by os_numero_origem), count(*) filter (where os_criada) into r2, n from importar_os_pendentes(lote, null);
  assert n = 0, format('reimportação não pode criar nada, criou %s', n);
  assert r2 = r1, 'reimportação devolve os mesmos números das OS já existentes';
  assert (select count(*) from ordens_servico where numero_origem like 'OS-T-%') = 3, 'reimportar duplicou OS';
  assert (select ultimo from contadores_os where cidade_id = 'TSTX' order by ano desc limit 1) = 3, 'reimportação gastou numeração';

  -- geometria só com coordenada
  select * into v from ordens_servico where numero_origem = 'OS-T-1';
  assert v.geom is not null and abs(st_y(v.geom::geometry) - -21.1) < 1e-9 and abs(st_x(v.geom::geometry) - -43.0) < 1e-9, 'geom da OS com coordenada';
  assert v.origem_geo = 'convertido_utm' and v.status = 'Aguardando despacho', 'origem_geo/status com coordenada';
  select * into v from ordens_servico where numero_origem = 'OS-T-2  001/2026';
  assert v.geom is null and v.lat is null and v.lng is null, 'sem coordenada: geom e lat/lng nulos';
  assert v.status = 'Em triagem' and v.origem_geo = 'desconhecido', 'sem coordenada entra em triagem, origem desconhecida';

  -- origem do alimentador: existe nas bases de rede → importado; informado e inexistente → nao_identificado; vazio → nulo
  assert (select circuito_origem from ordens_servico where numero_origem = 'OS-T-1') = 'importado', 'alimentador conhecido';
  assert (select circuito_origem from ordens_servico where numero_origem = 'OS-T-2  001/2026') = 'nao_identificado', 'alimentador informado e desconhecido';
  assert (select circuito_origem from ordens_servico where numero_origem = 'OS-T-3') is null, 'alimentador vazio fica nulo';

  -- desconhecido = NULL (nunca 0)
  select * into v from ordens_servico where numero_origem = 'OS-T-1';
  assert v.clientes is null and v.prazo_origem is null and v.prazo_limite is null, 'clientes/prazo desconhecidos ficam nulos';
  assert v.prioridade_legada = 'ALTA' and v.endereco = 'Poste 1-1 — MUNICIPIO TESTE' and v.origem_endereco = 'derivado_poste' and v.poste_codigo = '1-1', 'campos do formato gravados';
  assert v.transformador is null and v.uc is null and v.conjunto is null, 'campos que o formato não traz ficam nulos';
end $$;

-- índice único: inserir o mesmo numero_origem direto falha
do $$
begin
  begin
    insert into ordens_servico (numero, cidade_id, endereco, tipo, fatos, status, nivel, codigo, pontos, aberta_em, numero_origem)
    values ('TSTX-X-1', 'TSTX', 'x y z', 'Corretiva', '{}', 'Em triagem', 1, 1, 1, now(), 'OS-T-1');
    raise exception 'duplicou numero_origem';
  exception when unique_violation then null; end;
end $$;

-- ATOMICIDADE: lote com um item inválido (sem endereço) não grava NENHUM item
do $$
declare lote jsonb := jsonb_build_array(pg_temp.item('OS-T-9', null, -21.2, -43.1), (pg_temp.item('OS-T-10', null, -21.3, -43.2)) - 'endereco');
begin
  begin
    perform * from importar_os_pendentes(lote, null);
    raise exception 'aceitou item sem endereço';
  exception when not_null_violation then null; end;
  assert not exists (select 1 from ordens_servico where numero_origem in ('OS-T-9', 'OS-T-10')), 'lote inválido gravou parcialmente';
end $$;

-- cidade inexistente: FK impede
do $$
begin
  begin
    perform * from importar_os_pendentes(jsonb_build_array(jsonb_set(pg_temp.item('OS-T-11', null, null, null), '{cidade_id}', '"ZZZZZ"')), null);
    raise exception 'aceitou cidade inexistente';
  exception when foreign_key_violation then null; end;
end $$;

-- entradas inválidas
do $$
begin
  begin perform * from importar_os_pendentes('{"a":1}'::jsonb, null); raise exception 'aceitou objeto no lugar de array';
  exception when sqlstate '22023' then null; end;
  begin perform * from importar_os_pendentes(jsonb_build_array(pg_temp.item(' ', null, null, null)), null); raise exception 'aceitou numero_origem em branco';
  exception when sqlstate '22023' then null; end;
  begin perform * from importar_os_pendentes((select jsonb_agg(pg_temp.item('LOTE-' || g, null, null, null)) from generate_series(1, 1001) g), null); raise exception 'aceitou lote de 1001';
  exception when sqlstate '22023' then null; end;
end $$;

-- privilégios: só o service_role executa; a restrição de endereço NOT NULL continua valendo
do $$
begin
  assert not has_function_privilege('anon', 'importar_os_pendentes(jsonb,uuid)', 'execute'), 'anon pode executar';
  assert not has_function_privilege('authenticated', 'importar_os_pendentes(jsonb,uuid)', 'execute'), 'authenticated pode executar';
  assert has_function_privilege('service_role', 'importar_os_pendentes(jsonb,uuid)', 'execute'), 'service_role não pode executar';
  assert (select is_nullable from information_schema.columns where table_name = 'ordens_servico' and column_name = 'endereco') = 'NO', 'endereco deixou de ser NOT NULL';
  assert (select count(*) from configuracoes where chave in ('importacao.textos_nulos', 'importacao.regiao', 'importacao.padrao_poste', 'importacao.fuso_horario', 'importacao.tamanho_lote')) = 5, 'configuração da importação incompleta';
  assert (select valor from configuracoes where chave = 'importacao.textos_nulos') = '[]'::jsonb, 'lista de textos nulos deve vir desligada';
end $$;

rollback;
select 'importar_os_pendentes.sql: OK' as resultado;
