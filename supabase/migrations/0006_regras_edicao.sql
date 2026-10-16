-- Farol — 0006: edição das regras de precedência (camada A) com versão, justificativa e reclassificação (§4, §7, §13).
-- Idempotente: pode ser rodada mais de uma vez. Rode DEPOIS de 0001, seed.sql, 0002, 0003, 0004 e 0005.
-- Nenhuma regra, nível ou prioridade mora aqui: o conteúdo vive em regras_versoes.conteudo (snapshot imutável) e em
-- regras_precedencia (o conjunto em vigor, que o motor lê). A função só aplica as regras de integridade, de forma transacional.
--
-- Modelo: cada gravação cria UMA nova linha em regras_versoes (numero = anterior + 1, conteúdo = o conjunto INTEIRO) e
-- sincroniza regras_precedencia com esse conteúdo. Versão anterior nunca é alterada (trigger). O conjunto vale para todas
-- as cidades, por isso há um único contador de versão (diferente da pontuação, que é por escopo).
--
-- Erros específicos (SQLSTATE próprio; a API traduz em HTTP e o campo HINT diz qual regra falhou):
--   FD400 entrada inválida (justificativa, conteúdo com erros, nenhuma alteração)   → 400
--   FD403 não permitido (só o Administrador grava)                                    → 403
--   FD409 conflito (versão base antiga, sem versão de pontuação vigente)              → 409
--   FD500 estado inconsistente da instalação                                          → 500

begin;

-- ═════════ 1) Versões do conjunto de regras (imutáveis) ═════════
create table if not exists regras_versoes (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique check (numero > 0),
  conteudo jsonb not null check (jsonb_typeof(conteudo) = 'array'),   -- [{id, nome, ativa, cond[{criterio, opcoes[]}], nivel, prioridadeMinima}]
  justificativa text not null check (length(btrim(justificativa)) > 0),
  criado_por uuid references perfis(user_id),                          -- nulo só na carga inicial (v1)
  criado_em timestamptz not null default now()
);

-- Nunca UPDATE, DELETE nem TRUNCATE (imutavel() vem do 0001)
drop trigger if exists trg_regras_versao_imutavel on regras_versoes;
create trigger trg_regras_versao_imutavel before update or delete on regras_versoes
  for each row execute function imutavel();
drop trigger if exists trg_regras_versao_truncate on regras_versoes;
create trigger trg_regras_versao_truncate before truncate on regras_versoes
  for each statement execute function imutavel();

-- ═════════ 2) Funções auxiliares ═════════
-- Forma canônica de um conjunto de regras: ordenado por id, só os campos do modelo. Serve para comparar "igual ou não".
create or replace function normalizar_regras(p_regras jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e ->> 'id',
        'nome', btrim(e ->> 'nome'),
        'ativa', (e ->> 'ativa')::boolean,
        'cond', coalesce(
          (select jsonb_agg(jsonb_build_object('criterio', c ->> 'criterio', 'opcoes', c -> 'opcoes') order by o)
             from jsonb_array_elements(e -> 'cond') with ordinality as t(c, o)),
          '[]'::jsonb),
        'nivel', (e ->> 'nivel')::int,
        'prioridadeMinima', (e ->> 'prioridadeMinima')::int
      )
      order by e ->> 'id'
    ),
    '[]'::jsonb)
  from jsonb_array_elements(p_regras) e;
$$;

-- Erros que BLOQUEIAM a gravação (espelha validarRegras em packages/shared/src/regras-edicao.ts; os alertas só existem lá).
-- p_pontuacao = conteúdo da versão de pontuação global vigente: critérios e opções são conferidos contra ELA, nunca fixos aqui.
create or replace function validar_conteudo_regras(p_conteudo jsonb, p_pontuacao jsonb)
returns text[] language plpgsql stable set search_path = public as $$
declare
  v_erros text[] := '{}';
  v_r jsonb; v_c jsonb; v_o jsonb; v_crit jsonb;
  v_i int := 0;
  v_ids text[] := '{}';
  v_id text; v_rot text;
  v_vistos text[]; v_ops text[];
  v_nome_crit text; v_op text;
begin
  if jsonb_typeof(p_conteudo) is distinct from 'array' then
    return array['Conteúdo inválido: esperado uma lista de regras.'];
  end if;
  if jsonb_typeof(p_pontuacao -> 'criterios') is distinct from 'array' then
    return array['Versão de pontuação vigente inválida: sem critérios.'];
  end if;

  for v_r in select e from jsonb_array_elements(p_conteudo) e loop
    v_i := v_i + 1;
    if jsonb_typeof(v_r) is distinct from 'object' then
      v_erros := v_erros || format('Regra nº %s: formato inválido.', v_i);
      continue;
    end if;
    v_id := case when jsonb_typeof(v_r -> 'id') = 'string' then v_r ->> 'id' end;
    v_rot := format('Regra "%s"', coalesce(
      nullif(btrim(case when jsonb_typeof(v_r -> 'nome') = 'string' then v_r ->> 'nome' end), ''), nullif(btrim(v_id), ''), 'nº ' || v_i));

    if v_id is null or btrim(v_id) = '' then
      v_erros := v_erros || format('%s: informe o identificador.', v_rot);
    elsif v_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$' then
      v_erros := v_erros || format('%s: identificador inválido (letras, números, "-" e "_", até 40 caracteres).', v_rot);
    elsif v_id = any (v_ids) then
      v_erros := v_erros || format('Identificador repetido: "%s".', v_id);
    end if;
    if v_id is not null then v_ids := v_ids || v_id; end if;

    if jsonb_typeof(v_r -> 'nome') is distinct from 'string' or btrim(v_r ->> 'nome') = '' then
      v_erros := v_erros || format('%s: informe o nome.', v_rot);
    end if;
    if jsonb_typeof(v_r -> 'ativa') is distinct from 'boolean' then
      v_erros := v_erros || format('%s: "ativa" deve ser verdadeiro ou falso.', v_rot);
    end if;
    if jsonb_typeof(v_r -> 'nivel') is distinct from 'number' or (v_r ->> 'nivel') !~ '^([1-9]|10)$' then
      v_erros := v_erros || format('%s: o nível deve ser um inteiro de 1 a 10.', v_rot);
    end if;
    if jsonb_typeof(v_r -> 'prioridadeMinima') is distinct from 'number' or (v_r ->> 'prioridadeMinima') !~ '^[0-4]$' then
      v_erros := v_erros || format('%s: a prioridade mínima deve ser um inteiro de 0 a 4.', v_rot);
    end if;

    if jsonb_typeof(v_r -> 'cond') is distinct from 'array' or jsonb_array_length(v_r -> 'cond') = 0 then
      v_erros := v_erros || format('%s: informe pelo menos uma condição.', v_rot);
      continue;
    end if;

    v_vistos := '{}';
    for v_c in select e from jsonb_array_elements(v_r -> 'cond') e loop
      if jsonb_typeof(v_c) is distinct from 'object' or jsonb_typeof(v_c -> 'criterio') is distinct from 'string' then
        v_erros := v_erros || format('%s: condição com formato inválido.', v_rot);
        continue;
      end if;
      select e into v_crit from jsonb_array_elements(p_pontuacao -> 'criterios') e where e ->> 'id' = (v_c ->> 'criterio') limit 1;
      if v_crit is null then
        v_erros := v_erros || format('%s: o critério "%s" não existe na versão de pontuação vigente.', v_rot, v_c ->> 'criterio');
        continue;
      end if;
      v_nome_crit := coalesce(v_crit ->> 'nome', v_c ->> 'criterio');
      if (v_c ->> 'criterio') = any (v_vistos) then
        v_erros := v_erros || format('%s: o critério "%s" aparece mais de uma vez; reúna as opções numa só condição.', v_rot, v_nome_crit);
      end if;
      v_vistos := v_vistos || (v_c ->> 'criterio');

      if jsonb_typeof(v_c -> 'opcoes') is distinct from 'array' or jsonb_array_length(v_c -> 'opcoes') = 0 then
        v_erros := v_erros || format('%s: a condição em "%s" precisa de ao menos uma opção.', v_rot, v_nome_crit);
        continue;
      end if;
      v_ops := '{}';
      for v_o in select e from jsonb_array_elements(v_c -> 'opcoes') e loop
        if jsonb_typeof(v_o) is distinct from 'string' then
          v_erros := v_erros || format('%s: opção com formato inválido em "%s".', v_rot, v_nome_crit);
          continue;
        end if;
        v_op := v_o #>> '{}';
        if not exists (select 1 from jsonb_array_elements(v_crit -> 'opcoes') x where x ->> 'label' = v_op) then
          v_erros := v_erros || format('%s: a opção "%s" não existe em "%s".', v_rot, v_op, v_nome_crit);
        elsif v_op = any (v_ops) then
          v_erros := v_erros || format('%s: opção repetida em "%s": "%s".', v_rot, v_nome_crit, v_op);
        end if;
        v_ops := v_ops || v_op;
      end loop;
    end loop;
  end loop;
  return v_erros;
end $$;

-- ═════════ 3) OS: com que versão das regras a OS foi calculada ═════════
alter table ordens_servico add column if not exists regras_versao int;

-- ═════════ 4) Carga inicial: o conjunto atual vira a v1 ═════════
insert into regras_versoes (numero, conteudo, justificativa)
select 1,
       normalizar_regras(coalesce((
         select jsonb_agg(jsonb_build_object(
                  'id', id, 'nome', nome, 'ativa', ativa, 'cond', cond, 'nivel', nivel, 'prioridadeMinima', prioridade_minima))
           from regras_precedencia), '[]'::jsonb)),
       'Carga inicial (regras existentes antes da edição)'
 where not exists (select 1 from regras_versoes);

-- As OS existentes foram calculadas com o conjunto atual (as regras ainda não eram editáveis): ficam na versão em vigor.
update ordens_servico
   set regras_versao = (select max(numero) from regras_versoes)
 where regras_versao is null;

-- ═════════ 5) Gravação transacional ═════════
-- Cria a próxima versão do conjunto INTEIRO e sincroniza regras_precedencia (que o motor lê).
-- Serializada por um advisory lock de transação: duas gravações simultâneas andam uma depois da outra e a segunda vê o que a
-- primeira gravou (e falha com 409 se partiu de uma versão antiga). A justificativa chega como PARÂMETRO (sem set_config).
-- Só o Administrador grava (a API também confere; aqui é a segunda trava).
create or replace function salvar_regras(p_conteudo jsonb, p_justificativa text, p_usuario uuid, p_versao_base int)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_just text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_atual int;
  v_prev jsonb;
  v_pont jsonb;
  v_erros text[];
  v_novo jsonb;
  v_num int;
  v_r jsonb;
  v_old regras_precedencia%rowtype;
  v_oldj jsonb;
  v_alt int := 0;
  v_rem int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('regras_precedencia', 0));

  if v_just is null then
    raise exception 'Informe a justificativa da alteração.' using errcode = 'FD400', hint = 'justificativa_obrigatoria';
  end if;
  if p_usuario is null or not exists (select 1 from perfis where user_id = p_usuario and perfil = 'Administrador') then
    raise exception 'Só o Administrador altera as regras de precedência.' using errcode = 'FD403', hint = 'so_administrador';
  end if;

  select numero, conteudo into v_atual, v_prev from regras_versoes order by numero desc limit 1;
  if v_atual is null then
    raise exception 'Não há versão inicial das regras: rode a migration 0006 por inteiro.' using errcode = 'FD500', hint = 'sem_versao_inicial';
  end if;
  if p_versao_base is distinct from v_atual then
    raise exception 'As regras foram alteradas por outro usuário (versão % no servidor, você partiu da %). Recarregue antes de salvar.',
      v_atual, p_versao_base using errcode = 'FD409', hint = 'conflito_versao';
  end if;

  -- critérios e opções são conferidos contra a versão de pontuação GLOBAL vigente (a mesma que a tela e a API usam)
  select conteudo into v_pont from versoes_pontuacao
   where cidade_id is null and status = 'publicada' and vigencia_inicio <= now()
   order by numero desc limit 1;
  if v_pont is null then
    raise exception 'Não há versão de pontuação global vigente para validar as condições.' using errcode = 'FD409', hint = 'sem_versao_pontuacao';
  end if;

  v_erros := validar_conteudo_regras(p_conteudo, v_pont);
  if coalesce(array_length(v_erros, 1), 0) > 0 then
    raise exception 'As regras têm % erro(s) que bloqueiam a gravação: %', array_length(v_erros, 1), array_to_string(v_erros, ' ')
      using errcode = 'FD400', hint = 'validacao';
  end if;

  v_novo := normalizar_regras(p_conteudo);
  if v_novo = normalizar_regras(v_prev) then
    raise exception 'Nenhuma alteração em relação à versão %.', v_atual using errcode = 'FD400', hint = 'sem_alteracao';
  end if;

  v_num := v_atual + 1;
  insert into regras_versoes (numero, conteudo, justificativa, criado_por) values (v_num, v_novo, v_just, p_usuario);

  -- regras novas ou alteradas: gravam, ganham a versão nova e entram no histórico por regra
  for v_r in select e from jsonb_array_elements(v_novo) e loop
    select * into v_old from regras_precedencia where id = v_r ->> 'id';
    if not found then
      insert into regras_precedencia (id, nome, ativa, cond, nivel, prioridade_minima, versao, atualizado_em)
        values (v_r ->> 'id', v_r ->> 'nome', (v_r ->> 'ativa')::boolean, v_r -> 'cond',
                (v_r ->> 'nivel')::int, (v_r ->> 'prioridadeMinima')::int, v_num, now());
    else
      v_oldj := jsonb_build_object('id', v_old.id, 'nome', v_old.nome, 'ativa', v_old.ativa, 'cond', v_old.cond,
                                   'nivel', v_old.nivel, 'prioridadeMinima', v_old.prioridade_minima);
      continue when normalizar_regras(jsonb_build_array(v_oldj)) = normalizar_regras(jsonb_build_array(v_r));  -- igual: não toca
      update regras_precedencia set
        nome = v_r ->> 'nome', ativa = (v_r ->> 'ativa')::boolean, cond = v_r -> 'cond',
        nivel = (v_r ->> 'nivel')::int, prioridade_minima = (v_r ->> 'prioridadeMinima')::int,
        versao = v_num, atualizado_em = now()
       where id = v_old.id;
    end if;
    insert into regras_precedencia_hist (regra_id, versao, snapshot, justificativa, usuario)
      values (v_r ->> 'id', v_num, v_r, v_just, p_usuario);
    v_alt := v_alt + 1;
  end loop;

  -- regras que saíram do conjunto: ficam no histórico (e na versão anterior), saem do que o motor lê
  with removidas as (
    delete from regras_precedencia
     where id <> all (select e ->> 'id' from jsonb_array_elements(v_novo) e)
    returning *
  )
  insert into regras_precedencia_hist (regra_id, versao, snapshot, justificativa, usuario)
  select id, v_num,
         jsonb_build_object('id', id, 'nome', nome, 'ativa', ativa, 'cond', cond, 'nivel', nivel,
                            'prioridadeMinima', prioridade_minima, 'removida', true),
         v_just, p_usuario
    from removidas;
  get diagnostics v_rem = row_count;

  return jsonb_build_object('numero', v_num, 'anterior', v_atual, 'alteradas', v_alt, 'removidas', v_rem);
end $$;

-- ═════════ 6) Segurança: nega por padrão ═════════
alter table regras_versoes enable row level security;
revoke all on regras_versoes from anon, authenticated;
-- sem policy → só a API (service_role) acessa; e ela só lê e insere (UPDATE/DELETE/TRUNCATE nem são concedidos)
revoke all on regras_versoes from service_role;
grant select, insert on regras_versoes to service_role;

-- funções: executáveis SÓ pelo service_role (a API)
revoke all on function normalizar_regras(jsonb)                       from public, anon, authenticated;
revoke all on function validar_conteudo_regras(jsonb, jsonb)          from public, anon, authenticated;
revoke all on function salvar_regras(jsonb, text, uuid, int)          from public, anon, authenticated;
grant execute on function normalizar_regras(jsonb)                    to service_role;
grant execute on function validar_conteudo_regras(jsonb, jsonb)       to service_role;
grant execute on function salvar_regras(jsonb, text, uuid, int)       to service_role;

commit;
