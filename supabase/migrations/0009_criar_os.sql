-- Farol — 0009: criar_os transacional (P-04 da revisão de produção).
--
-- Hoje apps/api/src/services/os.ts grava a OS em 3 INSERTs separados (ordens_servico,
-- resultados_prioridade, solicitacoes); se o 2º ou 3º falhar, a OS fica inconsistente (sem resultado
-- ou sem a solicitação de abertura) e nada desfaz o que já gravou. Esta função junta os três numa
-- única transação, no mesmo padrão de salvar_regras/designar_equipe (plpgsql, FD4xx/FD5xx).
--
-- Escopo mínimo (autorizado): só a gravação atômica. NENHUMA regra de validação nova — os checks que
-- já existem nas colunas (uc, transformador, etc.) continuam os únicos. O cálculo de prioridade
-- continua inteiramente em packages/shared (motor puro, sem I/O); esta função só grava o que a API já
-- calculou em JS. Idempotente (create or replace).

begin;

create or replace function criar_os(p_os jsonb, p_resultado jsonb, p_usuario uuid)
returns ordens_servico
language plpgsql set search_path = public as $$
declare
  v_numero text;
  v_os ordens_servico;
begin
  v_numero := proximo_numero_os(p_os ->> 'cidade');

  insert into ordens_servico (
    numero, cidade_id, endereco, lat, lng, transformador, uc, circuito, conjunto,
    exige_qualificacao, demo, tipo, fatos, prazo_limite, status,
    versao_pontuacao_id, regras_versao, nivel, codigo, pontos, aberta_em
  ) values (
    v_numero, p_os ->> 'cidade', p_os ->> 'endereco',
    (p_os ->> 'lat')::double precision, (p_os ->> 'lng')::double precision,
    p_os ->> 'transformador', p_os ->> 'uc', p_os ->> 'circuito', p_os ->> 'conjunto',
    p_os ->> 'exigeQualificacao', coalesce((p_os ->> 'demo')::boolean, false),
    (p_os ->> 'tipo')::tipo_manut, p_os -> 'fatos',
    (p_os ->> 'prazoLimite')::timestamptz, p_os ->> 'status',
    (p_os ->> 'versaoPontuacaoId')::uuid, (p_os ->> 'regrasVersao')::int,
    (p_resultado ->> 'nivel')::int, (p_resultado ->> 'codigo')::int, (p_resultado ->> 'pontos')::int,
    (p_os ->> 'abertaEm')::timestamptz
  ) returning * into v_os;

  insert into resultados_prioridade (
    os_id, versao, itens, pontos, codigo_faixa, regras_aplicadas, nivel, codigo, motivo_principal, motivo_calculo
  ) values (
    v_os.id, (p_resultado ->> 'versao')::int, p_resultado -> 'itens', (p_resultado ->> 'pontos')::int,
    (p_resultado ->> 'codigoFaixa')::int,
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_resultado -> 'regrasAplicadas') x), '{}'),
    (p_resultado ->> 'nivel')::int, (p_resultado ->> 'codigo')::int,
    p_resultado ->> 'motivoPrincipal', 'Abertura'
  );

  insert into solicitacoes (
    os_id, cidade_id, origem, endereco, lat, lng, transformador, uc, fatos, criado_por, criado_em
  ) values (
    v_os.id, v_os.cidade_id, 'abertura', p_os ->> 'endereco',
    (p_os ->> 'lat')::double precision, (p_os ->> 'lng')::double precision,
    p_os ->> 'transformador', p_os ->> 'uc', p_os -> 'fatos', p_usuario, v_os.aberta_em
  );

  return v_os;
end $$;

commit;
