-- Farol — 0005: pontuação do Usuário Chave (§3, §4, §5, §7, §13).
-- Idempotente: pode ser rodada mais de uma vez. Rode DEPOIS de 0001, seed.sql, 0002, 0003 e 0004.
-- Nenhum peso, faixa ou prazo mora aqui: o conteúdo das versões vive em versoes_pontuacao.conteudo e os
-- limites em `configuracoes`. As funções só aplicam as regras, de forma transacional.
--
-- Erros específicos (SQLSTATE próprio; a API traduz em HTTP e o campo HINT diz qual regra falhou):
--   FD400 entrada inválida (justificativa, vigência, modo, conteúdo com erros)   → 400
--   FD403 não permitido (quem publicou não aprova a própria versão)              → 403
--   FD404 versão, rascunho ou cidade inexistente                                 → 404
--   FD409 conflito (etag antigo, aprovação pendente, rascunho já existente…)     → 409
--   FD500 configuração ausente ou inválida                                       → 500

begin;

-- ═════════ 1) configuracoes ═════════
create table if not exists configuracoes (
  chave text primary key check (length(btrim(chave)) > 0),
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.configuracoes'::regclass and conname = 'ck_config_pontuacao') then
    alter table configuracoes add constraint ck_config_pontuacao check (
      (chave <> 'pontuacao.max_pontos'
        or (jsonb_typeof(valor) = 'number' and (valor #>> '{}') ~ '^[1-9][0-9]{0,8}$'))
      and (chave <> 'pontuacao.exigir_aprovacao' or jsonb_typeof(valor) = 'boolean')
    );
  end if;
end $$;

-- Padrões da instalação (não sobrescreve o que já foi ajustado)
insert into configuracoes (chave, valor) values
  ('pontuacao.max_pontos', '100'::jsonb),
  ('pontuacao.exigir_aprovacao', 'false'::jsonb)
on conflict (chave) do nothing;

-- ═════════ 2) versoes_pontuacao: autoria, aprovação e rastros de edição ═════════
-- (a imutabilidade da publicada é o trigger do 0001/0003; só colunas novas aqui, nenhum UPDATE em linha publicada)
alter table versoes_pontuacao add column if not exists autor_publicacao uuid references perfis(user_id);  -- quem publicou / enviou para aprovação
alter table versoes_pontuacao add column if not exists publicado_em timestamptz;
alter table versoes_pontuacao add column if not exists aprovado_por uuid references perfis(user_id);
alter table versoes_pontuacao add column if not exists aprovado_em timestamptz;
alter table versoes_pontuacao add column if not exists atualizado_por uuid references perfis(user_id);
alter table versoes_pontuacao add column if not exists atualizado_em timestamptz not null default now();
alter table versoes_pontuacao add column if not exists restaurada_de int;                               -- número da versão de origem

do $$
begin
  -- o autor da publicação NUNCA é quem aprova (também garantido na função aprovar_versao)
  if not exists (select 1 from pg_constraint where conrelid = 'public.versoes_pontuacao'::regclass and conname = 'ck_versao_autor_nao_aprova') then
    alter table versoes_pontuacao add constraint ck_versao_autor_nao_aprova
      check (aprovado_por is null or autor_publicacao is null or aprovado_por <> autor_publicacao);
  end if;
end $$;

-- ═════════ 3) Funções auxiliares ═════════
create or replace function pontuacao_max() returns int
language plpgsql stable set search_path = public as $$
declare v int;
begin
  select (valor #>> '{}')::int into v from configuracoes where chave = 'pontuacao.max_pontos';
  if v is null then
    raise exception 'Configuração "pontuacao.max_pontos" ausente.' using errcode = 'FD500', hint = 'config_ausente';
  end if;
  return v;
end $$;

create or replace function pontuacao_exigir_aprovacao() returns boolean
language plpgsql stable set search_path = public as $$
declare v boolean;
begin
  select (valor #>> '{}')::boolean into v from configuracoes where chave = 'pontuacao.exigir_aprovacao';
  if v is null then
    raise exception 'Configuração "pontuacao.exigir_aprovacao" ausente.' using errcode = 'FD500', hint = 'config_ausente';
  end if;
  return v;
end $$;

-- Erros que BLOQUEIAM a publicação (espelha validarVersao em packages/shared/src/validate.ts; os alertas só existem lá).
create or replace function validar_conteudo_pontuacao(p_conteudo jsonb, p_max int)
returns text[] language plpgsql stable set search_path = public as $$
declare
  v_erros text[] := '{}';
  v_c jsonb; v_o jsonb; v_f jsonb;
  v_pts text;
  v_n int := 0;
  v_de int; v_ate int;
  v_prev_ate int; v_prev_sem_limite boolean := false;
begin
  if jsonb_typeof(p_conteudo) is distinct from 'object'
     or jsonb_typeof(p_conteudo -> 'criterios') is distinct from 'array'
     or jsonb_typeof(p_conteudo -> 'faixas') is distinct from 'array' then
    return array['Conteúdo inválido: esperado { criterios[], faixas[] }.'];
  end if;

  -- pontos: só dos critérios habilitados; nulo (sem pontos definidos) é diferente de zero e bloqueia
  for v_c in select e from jsonb_array_elements(p_conteudo -> 'criterios') e loop
    continue when v_c ->> 'habilitado' = 'false';
    if jsonb_typeof(v_c -> 'opcoes') is distinct from 'array' or jsonb_array_length(v_c -> 'opcoes') = 0 then
      v_erros := v_erros || format('"%s": sem opções.', v_c ->> 'nome');
      continue;
    end if;
    for v_o in select e from jsonb_array_elements(v_c -> 'opcoes') e loop
      if (v_o -> 'pontos') is null or jsonb_typeof(v_o -> 'pontos') = 'null' then
        v_erros := v_erros || format('"%s → %s": sem pontos definidos.', v_c ->> 'nome', v_o ->> 'label');
      else
        v_pts := case when jsonb_typeof(v_o -> 'pontos') = 'number' then v_o ->> 'pontos' end;
        if v_pts is null or v_pts !~ '^[0-9]{1,9}$' then
          v_erros := v_erros || format('"%s → %s": use um inteiro maior ou igual a 0.', v_c ->> 'nome', v_o ->> 'label');
        elsif v_pts::int > p_max then
          v_erros := v_erros || format('"%s → %s": acima do máximo (%s).', v_c ->> 'nome', v_o ->> 'label', p_max);
        end if;
      end if;
    end loop;
  end loop;

  -- faixas: sem lacunas nem sobreposições, de 0 até "sem limite"
  if jsonb_array_length(p_conteudo -> 'faixas') = 0 then
    return v_erros || 'Nenhuma faixa definida.'::text;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_conteudo -> 'faixas') e
     where jsonb_typeof(e -> 'de') is distinct from 'number' or (e ->> 'de') !~ '^[0-9]{1,9}$'
        or ((e -> 'ate') is not null and jsonb_typeof(e -> 'ate') <> 'null'
            and (jsonb_typeof(e -> 'ate') <> 'number' or (e ->> 'ate') !~ '^[0-9]{1,9}$'))
  ) then
    return v_erros || 'Faixas: "de" e "até" devem ser inteiros maiores ou iguais a 0.'::text;
  end if;

  for v_f in select e from jsonb_array_elements(p_conteudo -> 'faixas') e order by (e ->> 'de')::int loop
    v_de := (v_f ->> 'de')::int;
    v_ate := case when jsonb_typeof(v_f -> 'ate') = 'number' then (v_f ->> 'ate')::int end;  -- nulo = sem limite
    v_n := v_n + 1;
    if v_n = 1 and v_de <> 0 then
      v_erros := v_erros || 'As faixas devem começar em 0.'::text;
    end if;
    if v_ate is not null and v_ate < v_de then
      v_erros := v_erros || format('Faixa %s: "até" menor que "de".', v_de);
    end if;
    if v_n > 1 then
      if v_prev_sem_limite then
        v_erros := v_erros || 'Faixa sem limite só pode ser a última.'::text;
      elsif v_de > v_prev_ate + 1 then
        v_erros := v_erros || format('Lacuna entre %s e %s.', v_prev_ate, v_de);
      elsif v_de <= v_prev_ate then
        v_erros := v_erros || format('Sobreposição entre faixas em %s.', v_de);
      end if;
    end if;
    v_prev_sem_limite := v_ate is null;
    v_prev_ate := v_ate;
  end loop;
  if not v_prev_sem_limite then
    v_erros := v_erros || 'A última faixa deve ser "sem limite".'::text;
  end if;
  return v_erros;
end $$;

-- ═════════ 4) Funções transacionais ═════════
-- Todas serializam por escopo (global ou cidade) com um advisory lock de transação: duas chamadas
-- simultâneas no mesmo escopo andam uma depois da outra; a segunda enxerga o que a primeira gravou.

-- 4a) salvar_rascunho: cria ou atualiza o ÚNICO rascunho do escopo. Etag antigo → FD409 (API → 409).
--     p_escopo = 'global' ou o id da cidade. p_etag = null só vale quando ainda não existe rascunho.
create or replace function salvar_rascunho(p_escopo text, p_conteudo jsonb, p_etag int, p_usuario uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_cidade text := case when p_escopo = 'global' then null else nullif(btrim(coalesce(p_escopo, '')), '') end;
  v_row versoes_pontuacao%rowtype;
  v_num int;
begin
  if p_escopo is null or btrim(p_escopo) = '' then
    raise exception 'Informe o escopo ("global" ou a cidade).' using errcode = 'FD400', hint = 'escopo_obrigatorio';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('versoes_pontuacao:' || coalesce(v_cidade, '*'), 0));

  if v_cidade is not null and not exists (select 1 from cidades where id = v_cidade) then
    raise exception 'Cidade "%" não encontrada.', v_cidade using errcode = 'FD404', hint = 'cidade_inexistente';
  end if;
  if jsonb_typeof(p_conteudo) is distinct from 'object'
     or jsonb_typeof(p_conteudo -> 'criterios') is distinct from 'array'
     or jsonb_typeof(p_conteudo -> 'faixas') is distinct from 'array' then
    raise exception 'Conteúdo inválido: esperado { criterios[], faixas[] }.' using errcode = 'FD400', hint = 'conteudo_invalido';
  end if;

  select * into v_row from versoes_pontuacao
    where coalesce(cidade_id, '*') = coalesce(v_cidade, '*') and status = 'rascunho' for update;

  if found then
    if p_etag is distinct from v_row.etag then
      raise exception 'O rascunho foi alterado por outro usuário (versão % no servidor). Recarregue antes de salvar.', v_row.etag
        using errcode = 'FD409', hint = 'conflito_rascunho';
    end if;
    update versoes_pontuacao
       set conteudo = p_conteudo, etag = etag + 1, atualizado_por = p_usuario, atualizado_em = now()
     where id = v_row.id
     returning * into v_row;
  else
    if p_etag is not null then
      raise exception 'O rascunho que você editava não existe mais (foi publicado ou descartado). Recarregue.'
        using errcode = 'FD409', hint = 'conflito_rascunho';
    end if;
    select coalesce(max(numero), 0) + 1 into v_num from versoes_pontuacao where coalesce(cidade_id, '*') = coalesce(v_cidade, '*');
    insert into versoes_pontuacao (cidade_id, numero, status, conteudo, criado_por, atualizado_por)
      values (v_cidade, v_num, 'rascunho', p_conteudo, p_usuario, p_usuario)
      returning * into v_row;
  end if;

  return jsonb_build_object('id', v_row.id, 'numero', v_row.numero, 'etag', v_row.etag, 'escopo', coalesce(v_row.cidade_id, 'global'));
end $$;

-- 4b) publicar_versao: justificativa, vigência e modo ('novas' | 'reclassificar') são obrigatórios; sem valor padrão.
--     Revalida no banco o que bloqueia. Com pontuacao.exigir_aprovacao ligado vai para 'aguardando_aprovacao'
--     (o autor não aprova); senão publica direto. p_etag (opcional) garante que se publica o que foi validado.
create or replace function publicar_versao(
  p_rascunho uuid, p_justificativa text, p_vigencia_inicio timestamptz, p_modo text, p_usuario uuid, p_etag int default null
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_row versoes_pontuacao%rowtype;
  v_just text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_erros text[];
  v_aprov boolean;
begin
  select * into v_row from versoes_pontuacao where id = p_rascunho;
  if not found then
    raise exception 'Rascunho não encontrado.' using errcode = 'FD404', hint = 'rascunho_inexistente';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('versoes_pontuacao:' || coalesce(v_row.cidade_id, '*'), 0));
  select * into v_row from versoes_pontuacao where id = p_rascunho for update;  -- relê já com a trava
  if not found then
    raise exception 'Rascunho não encontrado.' using errcode = 'FD404', hint = 'rascunho_inexistente';
  end if;

  if v_row.status <> 'rascunho' then
    raise exception 'A versão v% não é um rascunho (está "%").', v_row.numero, v_row.status using errcode = 'FD409', hint = 'nao_e_rascunho';
  end if;
  if p_etag is not null and p_etag <> v_row.etag then
    raise exception 'O rascunho foi alterado por outro usuário (versão % no servidor). Recarregue e valide de novo.', v_row.etag
      using errcode = 'FD409', hint = 'conflito_rascunho';
  end if;
  if v_just is null then
    raise exception 'Informe a justificativa da publicação.' using errcode = 'FD400', hint = 'justificativa_obrigatoria';
  end if;
  if p_vigencia_inicio is null then
    raise exception 'Informe o início da vigência.' using errcode = 'FD400', hint = 'vigencia_obrigatoria';
  end if;
  if p_modo is null or p_modo not in ('novas', 'reclassificar') then
    raise exception 'Escolha o modo: somente novas OS ou reclassificar as OS abertas.' using errcode = 'FD400', hint = 'modo_obrigatorio';
  end if;
  if exists (
    select 1 from versoes_pontuacao
     where coalesce(cidade_id, '*') = coalesce(v_row.cidade_id, '*') and status = 'aguardando_aprovacao'
  ) then
    raise exception 'Já existe uma versão aguardando aprovação neste escopo. Aprove-a antes de publicar outra.'
      using errcode = 'FD409', hint = 'aprovacao_pendente';
  end if;

  v_erros := validar_conteudo_pontuacao(v_row.conteudo, pontuacao_max());
  if coalesce(array_length(v_erros, 1), 0) > 0 then
    raise exception 'A versão tem % erro(s) que bloqueiam a publicação: %', array_length(v_erros, 1), array_to_string(v_erros, ' ')
      using errcode = 'FD400', hint = 'validacao';
  end if;

  v_aprov := pontuacao_exigir_aprovacao();
  update versoes_pontuacao set
    status = case when v_aprov then 'aguardando_aprovacao'::versao_status else 'publicada'::versao_status end,
    justificativa = v_just, vigencia_inicio = p_vigencia_inicio, modo_publicacao = p_modo,
    autor_publicacao = p_usuario,
    publicado_em = case when v_aprov then null else now() end,
    atualizado_por = p_usuario, atualizado_em = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'numero', v_row.numero, 'status', v_row.status,
                            'aguardando_aprovacao', v_aprov, 'escopo', coalesce(v_row.cidade_id, 'global'));
end $$;

-- 4c) aprovar_versao: só quem NÃO publicou a versão. Publica com a vigência e o modo já escolhidos.
create or replace function aprovar_versao(p_versao uuid, p_usuario uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_row versoes_pontuacao%rowtype;
begin
  select * into v_row from versoes_pontuacao where id = p_versao;
  if not found then
    raise exception 'Versão não encontrada.' using errcode = 'FD404', hint = 'versao_inexistente';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('versoes_pontuacao:' || coalesce(v_row.cidade_id, '*'), 0));
  select * into v_row from versoes_pontuacao where id = p_versao for update;
  if not found then
    raise exception 'Versão não encontrada.' using errcode = 'FD404', hint = 'versao_inexistente';
  end if;

  if v_row.status <> 'aguardando_aprovacao' then
    raise exception 'A versão v% não está aguardando aprovação (está "%").', v_row.numero, v_row.status
      using errcode = 'FD409', hint = 'nao_aguarda_aprovacao';
  end if;
  if p_usuario is null then
    raise exception 'Identifique quem aprova.' using errcode = 'FD400', hint = 'usuario_obrigatorio';
  end if;
  if v_row.autor_publicacao is not distinct from p_usuario then
    raise exception 'Quem enviou a versão para aprovação não pode aprová-la: peça a outro usuário.'
      using errcode = 'FD403', hint = 'autor_nao_aprova';
  end if;

  update versoes_pontuacao set
    status = 'publicada', aprovado_por = p_usuario, aprovado_em = now(), publicado_em = now(), atualizado_em = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'numero', v_row.numero, 'status', v_row.status, 'escopo', coalesce(v_row.cidade_id, 'global'));
end $$;

-- 4d) restaurar_versao: cria um NOVO rascunho a partir de uma versão publicada; nunca edita a publicada.
create or replace function restaurar_versao(p_versao uuid, p_usuario uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_src versoes_pontuacao%rowtype;
  v_new versoes_pontuacao%rowtype;
  v_num int;
begin
  select * into v_src from versoes_pontuacao where id = p_versao;
  if not found then
    raise exception 'Versão não encontrada.' using errcode = 'FD404', hint = 'versao_inexistente';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('versoes_pontuacao:' || coalesce(v_src.cidade_id, '*'), 0));

  if v_src.status <> 'publicada' then
    raise exception 'Só uma versão publicada pode ser restaurada (a v% está "%").', v_src.numero, v_src.status
      using errcode = 'FD409', hint = 'so_publicada';
  end if;
  if exists (
    select 1 from versoes_pontuacao
     where coalesce(cidade_id, '*') = coalesce(v_src.cidade_id, '*') and status = 'rascunho'
  ) then
    raise exception 'Já existe um rascunho neste escopo. Publique ou descarte o rascunho antes de restaurar.'
      using errcode = 'FD409', hint = 'rascunho_existente';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num from versoes_pontuacao where coalesce(cidade_id, '*') = coalesce(v_src.cidade_id, '*');
  insert into versoes_pontuacao (cidade_id, numero, status, conteudo, criado_por, atualizado_por, restaurada_de)
    values (v_src.cidade_id, v_num, 'rascunho', v_src.conteudo, p_usuario, p_usuario, v_src.numero)
    returning * into v_new;

  return jsonb_build_object('id', v_new.id, 'numero', v_new.numero, 'etag', v_new.etag,
                            'restaurada_de', v_src.numero, 'escopo', coalesce(v_new.cidade_id, 'global'));
end $$;

-- 4e) descartar_rascunho: apaga o rascunho (nunca uma versão publicada) para poder recomeçar ou restaurar.
create or replace function descartar_rascunho(p_rascunho uuid, p_etag int, p_usuario uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_row versoes_pontuacao%rowtype;
begin
  select * into v_row from versoes_pontuacao where id = p_rascunho;
  if not found then
    raise exception 'Rascunho não encontrado.' using errcode = 'FD404', hint = 'rascunho_inexistente';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('versoes_pontuacao:' || coalesce(v_row.cidade_id, '*'), 0));
  select * into v_row from versoes_pontuacao where id = p_rascunho for update;
  if not found then
    raise exception 'Rascunho não encontrado.' using errcode = 'FD404', hint = 'rascunho_inexistente';
  end if;

  if v_row.status <> 'rascunho' then
    raise exception 'A versão v% não é um rascunho (está "%"): só rascunhos podem ser descartados.', v_row.numero, v_row.status
      using errcode = 'FD409', hint = 'nao_e_rascunho';
  end if;
  if p_etag is distinct from v_row.etag then
    raise exception 'O rascunho foi alterado por outro usuário (versão % no servidor). Recarregue antes de descartar.', v_row.etag
      using errcode = 'FD409', hint = 'conflito_rascunho';
  end if;

  delete from versoes_pontuacao where id = v_row.id;
  return jsonb_build_object('id', v_row.id, 'numero', v_row.numero, 'escopo', coalesce(v_row.cidade_id, 'global'));
end $$;

-- ═════════ 5) Segurança: nega por padrão ═════════
alter table configuracoes enable row level security;
revoke all on configuracoes from anon, authenticated;
-- configuracoes e versoes_pontuacao: sem policy → só a API (service_role) lê e grava
grant all on configuracoes to service_role;

-- funções: executáveis SÓ pelo service_role (a API)
revoke all on function pontuacao_max()                                                       from public, anon, authenticated;
revoke all on function pontuacao_exigir_aprovacao()                                          from public, anon, authenticated;
revoke all on function validar_conteudo_pontuacao(jsonb, int)                                from public, anon, authenticated;
revoke all on function salvar_rascunho(text, jsonb, int, uuid)                               from public, anon, authenticated;
revoke all on function publicar_versao(uuid, text, timestamptz, text, uuid, int)             from public, anon, authenticated;
revoke all on function aprovar_versao(uuid, uuid)                                            from public, anon, authenticated;
revoke all on function restaurar_versao(uuid, uuid)                                          from public, anon, authenticated;
revoke all on function descartar_rascunho(uuid, int, uuid)                                   from public, anon, authenticated;
grant execute on function pontuacao_max()                                                    to service_role;
grant execute on function pontuacao_exigir_aprovacao()                                       to service_role;
grant execute on function validar_conteudo_pontuacao(jsonb, int)                             to service_role;
grant execute on function salvar_rascunho(text, jsonb, int, uuid)                            to service_role;
grant execute on function publicar_versao(uuid, text, timestamptz, text, uuid, int)          to service_role;
grant execute on function aprovar_versao(uuid, uuid)                                         to service_role;
grant execute on function restaurar_versao(uuid, uuid)                                       to service_role;
grant execute on function descartar_rascunho(uuid, int, uuid)                                to service_role;

commit;
