-- 0015: cadastro de OS no formato "OS manutenção pendente" (importação por arquivo). Aplicar após 0014.
-- Não altera migrações anteriores. Valores de configuração são DEMONSTRATIVOS (nada fixo no código).
--
-- Decisões: cada município da Localidade vira uma cidade real (cidades.municipio_origem lembra a origem, para reimportar sem
-- duplicar); o OSNumero da planilha fica em numero_origem (único, base da idempotência) e a OS mantém o número gerado pelo Farol;
-- o prazo da planilha é só informativo (prazo_origem) e NÃO entra no motor; endereço continua NOT NULL.
begin;

-- ───────── Cidades criadas a partir do município ─────────
alter table cidades add column if not exists municipio_origem text;
create unique index if not exists ux_cidades_municipio_origem on cidades (municipio_origem) where municipio_origem is not null;

-- ───────── Campos do formato na OS (todos opcionais, exceto o que já era obrigatório) ─────────
alter table ordens_servico
  add column if not exists numero_origem text,
  add column if not exists prioridade_legada text,        -- CodPrioridade: informativa, não é a pontuação do Farol
  add column if not exists clientes int,                  -- null = desconhecido (nunca 0 por falta de dado)
  add column if not exists tipo_servico text,             -- DescEsquema
  add column if not exists familia_ativo text,            -- Familias
  add column if not exists prazo_origem timestamptz,      -- DataDeadline: informativo; prazo_limite continua sendo o do Farol
  add column if not exists poste_codigo text,
  add column if not exists origem_endereco text;

do $$ begin
  alter table ordens_servico add constraint ck_os_clientes check (clientes is null or clientes >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table ordens_servico add constraint ck_os_origem_endereco
    check (origem_endereco is null or origem_endereco in ('informado', 'derivado_poste', 'nao_informado'));
exception when duplicate_object then null; end $$;

-- identidade da OS vinda da planilha: reimportar não duplica
create unique index if not exists ux_os_numero_origem on ordens_servico (numero_origem) where numero_origem is not null;

-- ───────── Configuração da importação (lida pela API a cada pedido; ausente = a API recusa) ─────────
insert into configuracoes (chave, valor) values
  ('importacao.textos_nulos', '[]'::jsonb),                                                    -- lista de textos que contam como vazio ("N/A", "-"); [] = desligada
  ('importacao.regiao', '{"latMin":-25,"latMax":-17,"lngMin":-46,"lngMax":-38}'::jsonb),        -- coordenada válida (DEMONSTRATIVO)
  ('importacao.padrao_poste', '"^[A-Za-z0-9./-]{1,20}$"'::jsonb),                              -- o que vale como código de poste no Complemento
  ('importacao.fuso_horario', '"-03:00"'::jsonb),
  ('importacao.tamanho_lote', '200'::jsonb)
on conflict (chave) do nothing;

-- ───────── Gravação em lote: atômica por lote e idempotente por numero_origem ─────────
-- Cada item já traz a prioridade calculada pelo motor (TypeScript), com a versão de pontuação e de regras. A função só grava:
-- OS + resultado imutável + solicitação de abertura, como o caminho normal (criarOS). Só o service_role executa.
create or replace function importar_os_pendentes(p_itens jsonb, p_usuario uuid default null)
returns table (os_numero_origem text, os_numero text, os_criada boolean)
language plpgsql set search_path = public, extensions, pg_temp as $$
declare
  it jsonb;
  v_id uuid;
  v_num text;
  v_origem text;
  v_lat double precision;
  v_lng double precision;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'p_itens deve ser um array JSON' using errcode = '22023';
  end if;
  if jsonb_array_length(p_itens) > 1000 then
    raise exception 'lote grande demais (máximo 1000 itens)' using errcode = '22023';
  end if;

  for it in select value from jsonb_array_elements(p_itens) loop
    v_origem := it->>'numero_origem';
    if v_origem is null or btrim(v_origem) = '' then
      raise exception 'item sem numero_origem' using errcode = '22023';
    end if;

    select o.numero into v_num from ordens_servico o where o.numero_origem = v_origem;
    if found then os_numero_origem := v_origem; os_numero := v_num; os_criada := false; return next; continue; end if;

    begin
      v_lat := nullif(it->>'lat', '')::double precision;
      v_lng := nullif(it->>'lng', '')::double precision;
      v_num := proximo_numero_os(it->>'cidade_id');

      insert into ordens_servico (
        numero, cidade_id, endereco, lat, lng, geom, circuito, circuito_origem, municipio, origem_geo, tipo, fatos, status,
        versao_pontuacao_id, regras_versao, nivel, codigo, pontos, aberta_em,
        numero_origem, prioridade_legada, clientes, tipo_servico, familia_ativo, prazo_origem, poste_codigo, origem_endereco
      ) values (
        v_num, it->>'cidade_id', it->>'endereco', v_lat, v_lng,
        case when v_lat is null or v_lng is null then null else st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography end,
        nullif(it->>'circuito', ''),
        case when nullif(it->>'circuito', '') is null then null
             when exists (select 1 from circuitos c where c.codigo = it->>'circuito') then 'importado' else 'nao_identificado' end,
        it->>'municipio', coalesce(it->>'origem_geo', 'desconhecido'), (it->>'tipo')::tipo_manut, coalesce(it->'fatos', '{}'::jsonb), it->>'status',
        nullif(it->>'versao_pontuacao_id', '')::uuid, nullif(it->>'regras_versao', '')::int,
        (it->'resultado'->>'nivel')::int, (it->'resultado'->>'codigo')::int, (it->'resultado'->>'pontos')::int, (it->>'aberta_em')::timestamptz,
        v_origem, nullif(it->>'prioridade_legada', ''), nullif(it->>'clientes', '')::int, nullif(it->>'tipo_servico', ''),
        nullif(it->>'familia_ativo', ''), nullif(it->>'prazo_origem', '')::timestamptz, nullif(it->>'poste_codigo', ''), it->>'origem_endereco'
      ) returning id into v_id;

      insert into resultados_prioridade (os_id, versao, itens, pontos, codigo_faixa, regras_aplicadas, nivel, codigo, motivo_principal, motivo_calculo)
      values (
        v_id, (it->'resultado'->>'versao')::int, it->'resultado'->'itens', (it->'resultado'->>'pontos')::int,
        (it->'resultado'->>'codigoFaixa')::int, array(select jsonb_array_elements_text(coalesce(it->'resultado'->'regrasAplicadas', '[]'::jsonb))),
        (it->'resultado'->>'nivel')::int, (it->'resultado'->>'codigo')::int, it->'resultado'->>'motivoPrincipal', 'Abertura'
      );

      insert into solicitacoes (os_id, cidade_id, origem, endereco, lat, lng, fatos, criado_por, criado_em)
      values (v_id, it->>'cidade_id', 'abertura', it->>'endereco', v_lat, v_lng, coalesce(it->'fatos', '{}'::jsonb), p_usuario, (it->>'aberta_em')::timestamptz);

      os_numero_origem := v_origem; os_numero := v_num; os_criada := true; return next;
    exception when unique_violation then
      -- outra importação gravou o mesmo numero_origem entre a checagem e o insert: vale como já existente
      select o.numero into v_num from ordens_servico o where o.numero_origem = v_origem;
      os_numero_origem := v_origem; os_numero := v_num; os_criada := false; return next;
    end;
  end loop;
end $$;

revoke execute on function importar_os_pendentes(jsonb, uuid) from public, anon, authenticated;
grant execute on function importar_os_pendentes(jsonb, uuid) to service_role;

commit;
