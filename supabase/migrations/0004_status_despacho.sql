-- Farol — 0004: status e despacho (§9, §10, §13).
-- Idempotente: pode ser rodada mais de uma vez. Rode DEPOIS de 0001, seed.sql, 0002 e 0003.
-- Nada aqui é regra "escondida": a tabela de transições, a capacidade e as qualificações vivem em tabelas;
-- as funções só as aplicam, de forma transacional (trava a OS e a equipe com FOR UPDATE).
--
-- Erros específicos (SQLSTATE próprio; a API traduz em HTTP e o campo HINT diz qual regra falhou):
--   FD400 entrada inválida (ex.: justificativa/motivo obrigatório)   → 400
--   FD403 fora do escopo (ex.: OS de outra equipe)                    → 403
--   FD404 OS ou equipe inexistente                                    → 404
--   FD409 conflito (despacho ativo, capacidade, transição inválida…)  → 409

begin;

-- ═════════ 1) Perfil "Equipe de campo": a equipe do usuário ═════════
alter table perfis add column if not exists equipe_id text references equipes(id);

-- ═════════ 2) Equipes: coordenadas (já existem lat/lng; dados DEMONSTRATIVOS onde faltam) ═════════
alter table equipes add column if not exists lat double precision;
alter table equipes add column if not exists lng double precision;
update equipes set lat = -19.91311, lng = -43.93832 where id = 'BH-A' and lat is null and lng is null;
update equipes set lat = -19.91850, lng = -43.93068 where id = 'BH-B' and lat is null and lng is null;
update equipes set lat = -19.93190, lng = -44.05581 where id = 'CT-A' and lat is null and lng is null;
update equipes set lat = -19.92741, lng = -44.04912 where id = 'CT-B' and lat is null and lng is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.equipes'::regclass and conname = 'ck_equipe_lat') then
    alter table equipes add constraint ck_equipe_lat check (lat is null or lat between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.equipes'::regclass and conname = 'ck_equipe_lng') then
    alter table equipes add constraint ck_equipe_lng check (lng is null or lng between -180 and 180);
  end if;
end $$;

-- ═════════ 3) Despachos: ciclo com a data de cada passo e motivo da remoção ═════════
-- (estado e apoio_intermunicipal/excecao_justificativa já existem no 0001)
alter table despachos add column if not exists apoio_justificativa text;
alter table despachos add column if not exists designada_em  timestamptz not null default now();
alter table despachos add column if not exists a_caminho_em  timestamptz;
alter table despachos add column if not exists em_execucao_em timestamptz;
alter table despachos add column if not exists concluida_em  timestamptz;
alter table despachos add column if not exists removida_em   timestamptz;
alter table despachos add column if not exists removida_motivo text;
alter table despachos add column if not exists criado_por  uuid references perfis(user_id);
alter table despachos add column if not exists removida_por uuid references perfis(user_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.despachos'::regclass and conname = 'ck_despacho_apoio_justificado') then
    alter table despachos add constraint ck_despacho_apoio_justificado
      check (not apoio_intermunicipal or (apoio_justificativa is not null and length(btrim(apoio_justificativa)) > 0)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.despachos'::regclass and conname = 'ck_despacho_removida') then
    alter table despachos add constraint ck_despacho_removida
      check (estado <> 'removida' or (removida_em is not null and removida_motivo is not null and length(btrim(removida_motivo)) > 0)) not valid;
  end if;
end $$;

-- A remoção NÃO apaga: o registro anterior fica (estado 'removida') e uma nova designação cria outra linha.
-- O índice uq_despacho_ativo (0001) continua garantindo um único despacho ativo por OS.
create index if not exists ix_despacho_equipe_ativo on despachos (equipe_id)
  where estado in ('designada','a_caminho','em_execucao');
create index if not exists ix_despacho_os on despachos (os_id, criado_em desc);

-- ═════════ 4) eventos_os: trilha imutável de cada ação (alimenta "Eventos" do Histórico) ═════════
create table if not exists eventos_os (
  id bigserial primary key,
  os_id uuid not null references ordens_servico(id),
  tipo text not null check (length(btrim(tipo)) > 0),   -- status, designacao, aceite, inicio, conclusao, remocao
  de text,
  para text,
  motivo text,
  usuario uuid references perfis(user_id),
  em timestamptz not null default now(),
  detalhe jsonb not null default '{}'
);
create index if not exists ix_eventos_os on eventos_os (os_id, em desc, id desc);

drop trigger if exists trg_evento_imutavel on eventos_os;
create trigger trg_evento_imutavel before update or delete on eventos_os
  for each row execute function imutavel();

-- ═════════ 5) Transições manuais de status (§10) ═════════
-- Espelha packages/shared/src/status.ts; o teste status.test.ts compara as duas listas.
create table if not exists transicoes_status (
  de text not null,
  para text not null,
  permissao text not null check (permissao in ('status','cancelar','reabrir')),
  exige_motivo boolean not null default false,
  primary key (de, para)
);

-- BEGIN transicoes (lido pelo teste; mantenha uma linha por transição)
insert into transicoes_status (de, para, permissao, exige_motivo) values
  ('Aberta', 'Em triagem', 'status', false),
  ('Aberta', 'Aguardando despacho', 'status', false),
  ('Aberta', 'Cancelada', 'cancelar', true),
  ('Em triagem', 'Aguardando despacho', 'status', false),
  ('Em triagem', 'Cancelada', 'cancelar', true),
  ('Aguardando despacho', 'Suspensa', 'status', true),
  ('Aguardando despacho', 'Cancelada', 'cancelar', true),
  ('Aguardando despacho', 'Em triagem', 'status', false),
  ('Suspensa', 'Aguardando despacho', 'status', false),
  ('Suspensa', 'Cancelada', 'cancelar', true),
  ('Em execução', 'Aguardando recurso', 'status', false),
  ('Aguardando recurso', 'Em execução', 'status', false),
  ('Concluída', 'Aguardando despacho', 'reabrir', true)
on conflict (de, para) do update set permissao = excluded.permissao, exige_motivo = excluded.exige_motivo;
-- END transicoes

-- ═════════ 6) Funções transacionais ═════════

-- 6a) mudar_status: transição MANUAL validada pela tabela acima; grava o evento.
create or replace function mudar_status(p_os uuid, p_para text, p_motivo text, p_usuario uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_os ordens_servico%rowtype;
  v_t transicoes_status%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into v_os from ordens_servico where id = p_os for update;
  if not found then
    raise exception 'OS não encontrada.' using errcode = 'FD404';
  end if;

  select * into v_t from transicoes_status where de = v_os.status and para = p_para;
  if not found then
    raise exception 'Transição "% → %" não é permitida pelo fluxo.', v_os.status, p_para
      using errcode = 'FD409', hint = 'transicao_invalida';
  end if;
  if v_t.exige_motivo and v_motivo is null then
    raise exception 'Informe o motivo/justificativa para "% → %".', v_os.status, p_para
      using errcode = 'FD400', hint = 'motivo_obrigatorio';
  end if;

  update ordens_servico set status = p_para, atualizada_em = now() where id = p_os;
  insert into eventos_os (os_id, tipo, de, para, motivo, usuario)
    values (p_os, 'status', v_os.status, p_para, v_motivo, p_usuario);

  return jsonb_build_object('os_id', p_os, 'de', v_os.status, 'status', p_para);
end $$;

-- 6b) designar_equipe: trava OS e equipe; capacidade NUNCA é ultrapassada (nem com exceção).
create or replace function designar_equipe(
  p_os uuid, p_equipe text, p_apoio boolean, p_excecao boolean, p_justificativa text, p_usuario uuid
) returns jsonb language plpgsql set search_path = public as $$
declare
  v_os ordens_servico%rowtype;
  v_eq equipes%rowtype;
  v_carga int;
  v_apoio boolean;
  v_incompat boolean;
  v_just text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_desp uuid;
begin
  -- ordem fixa de travas (OS, depois equipe) evita deadlock entre designações simultâneas
  select * into v_os from ordens_servico where id = p_os for update;
  if not found then
    raise exception 'OS não encontrada.' using errcode = 'FD404';
  end if;
  select * into v_eq from equipes where id = p_equipe for update;
  if not found then
    raise exception 'Equipe não encontrada.' using errcode = 'FD404';
  end if;
  if not v_eq.ativa then
    raise exception 'A equipe % está inativa.', p_equipe using errcode = 'FD409', hint = 'equipe_inativa';
  end if;

  if exists (select 1 from despachos where os_id = p_os and estado in ('designada','a_caminho','em_execucao')) then
    raise exception 'A OS % já tem despacho ativo. Remova a equipe atual antes de designar outra.', v_os.numero
      using errcode = 'FD409', hint = 'despacho_ativo';
  end if;
  if v_os.status <> 'Aguardando despacho' then
    raise exception 'A OS % está "%": só é possível designar equipe em "Aguardando despacho".', v_os.numero, v_os.status
      using errcode = 'FD409', hint = 'status_invalido';
  end if;

  select count(*) into v_carga from despachos
    where equipe_id = p_equipe and estado in ('designada','a_caminho','em_execucao');
  if v_carga >= v_eq.capacidade then
    raise exception 'Capacidade esgotada: a equipe % já está com %/%. Nem exceção libera este limite.', p_equipe, v_carga, v_eq.capacidade
      using errcode = 'FD409', hint = 'capacidade';
  end if;

  v_apoio := v_eq.cidade_id <> v_os.cidade_id;
  v_incompat := v_os.exige_qualificacao is not null and not (v_os.exige_qualificacao = any (v_eq.qualificacoes));

  if v_apoio and not coalesce(p_apoio, false) then
    raise exception 'A equipe % é de outra cidade: só como apoio intermunicipal, com justificativa.', p_equipe
      using errcode = 'FD409', hint = 'apoio_nao_confirmado';
  end if;
  if v_incompat and not coalesce(p_excecao, false) then
    raise exception 'A equipe % não tem a qualificação "%": só com exceção autorizada e justificada.', p_equipe, v_os.exige_qualificacao
      using errcode = 'FD409', hint = 'incompativel';
  end if;
  if (v_apoio or v_incompat) and v_just is null then
    raise exception 'Informe a justificativa do apoio intermunicipal / da exceção.'
      using errcode = 'FD400', hint = 'justificativa_obrigatoria';
  end if;

  begin
    insert into despachos (os_id, equipe_id, estado, apoio_intermunicipal, apoio_justificativa, excecao_justificativa, designada_em, criado_por)
      values (p_os, p_equipe, 'designada', v_apoio,
              case when v_apoio then v_just end, case when v_incompat then v_just end, now(), p_usuario)
      returning id into v_desp;
  exception when unique_violation then
    raise exception 'A OS % já tem despacho ativo.', v_os.numero using errcode = 'FD409', hint = 'despacho_ativo';
  end;

  update ordens_servico set status = 'Equipe designada', atualizada_em = now() where id = p_os;
  insert into eventos_os (os_id, tipo, de, para, motivo, usuario, detalhe)
    values (p_os, 'designacao', v_os.status, 'Equipe designada', v_just, p_usuario,
            jsonb_build_object('equipe', p_equipe, 'despacho', v_desp, 'apoio_intermunicipal', v_apoio, 'excecao', v_incompat));

  return jsonb_build_object('despacho_id', v_desp, 'equipe', p_equipe, 'status', 'Equipe designada',
                            'apoio_intermunicipal', v_apoio, 'excecao', v_incompat);
end $$;

-- 6c) avancar_despacho: aceite → início → conclusão. p_equipe_exigida (perfil Equipe de campo) garante,
--     dentro da transação, que o despacho é mesmo da equipe do usuário.
create or replace function avancar_despacho(p_os uuid, p_passo text, p_usuario uuid, p_equipe_exigida text default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_os ordens_servico%rowtype;
  v_d despachos%rowtype;
  v_estado_de text; v_status_de text; v_estado_para text; v_status_para text;
begin
  select * into v_os from ordens_servico where id = p_os for update;
  if not found then
    raise exception 'OS não encontrada.' using errcode = 'FD404';
  end if;

  select * into v_d from despachos where os_id = p_os and estado in ('designada','a_caminho','em_execucao') for update;
  if not found then
    raise exception 'A OS % não tem despacho ativo.', v_os.numero using errcode = 'FD409', hint = 'sem_despacho';
  end if;
  if p_equipe_exigida is not null and v_d.equipe_id <> p_equipe_exigida then
    raise exception 'Esta OS não é da sua equipe.' using errcode = 'FD403';
  end if;

  if p_passo = 'aceite' then
    v_estado_de := 'designada';   v_status_de := 'Equipe designada'; v_estado_para := 'a_caminho';   v_status_para := 'A caminho';
  elsif p_passo = 'inicio' then
    v_estado_de := 'a_caminho';   v_status_de := 'A caminho';        v_estado_para := 'em_execucao'; v_status_para := 'Em execução';
  elsif p_passo = 'conclusao' then
    v_estado_de := 'em_execucao'; v_status_de := 'Em execução';      v_estado_para := 'concluida';   v_status_para := 'Concluída';
  else
    raise exception 'Passo inválido: "%".', p_passo using errcode = 'FD400', hint = 'passo_desconhecido';
  end if;

  if v_d.estado <> v_estado_de or v_os.status <> v_status_de then
    raise exception 'O passo "%" não é permitido com a OS "%" e o despacho "%".', p_passo, v_os.status, v_d.estado
      using errcode = 'FD409', hint = 'passo_invalido';
  end if;

  update despachos set
    estado = v_estado_para,
    a_caminho_em   = case when p_passo = 'aceite'    then now() else a_caminho_em end,
    em_execucao_em = case when p_passo = 'inicio'    then now() else em_execucao_em end,
    concluida_em   = case when p_passo = 'conclusao' then now() else concluida_em end
  where id = v_d.id;
  update ordens_servico set status = v_status_para, atualizada_em = now() where id = p_os;
  insert into eventos_os (os_id, tipo, de, para, usuario, detalhe)
    values (p_os, p_passo, v_os.status, v_status_para, p_usuario, jsonb_build_object('equipe', v_d.equipe_id, 'despacho', v_d.id));

  return jsonb_build_object('despacho_id', v_d.id, 'equipe', v_d.equipe_id, 'status', v_status_para);
end $$;

-- 6d) remover_equipe: preserva o despacho (estado 'removida', com data e motivo) e devolve a OS à fila.
create or replace function remover_equipe(p_os uuid, p_motivo text, p_usuario uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_os ordens_servico%rowtype;
  v_d despachos%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into v_os from ordens_servico where id = p_os for update;
  if not found then
    raise exception 'OS não encontrada.' using errcode = 'FD404';
  end if;
  select * into v_d from despachos where os_id = p_os and estado in ('designada','a_caminho','em_execucao') for update;
  if not found then
    raise exception 'A OS % não tem despacho ativo.', v_os.numero using errcode = 'FD409', hint = 'sem_despacho';
  end if;
  if v_motivo is null then
    raise exception 'Informe o motivo da remoção da equipe.' using errcode = 'FD400', hint = 'motivo_obrigatorio';
  end if;

  update despachos set estado = 'removida', removida_em = now(), removida_motivo = v_motivo, removida_por = p_usuario
    where id = v_d.id;
  update ordens_servico set status = 'Aguardando despacho', atualizada_em = now() where id = p_os;
  insert into eventos_os (os_id, tipo, de, para, motivo, usuario, detalhe)
    values (p_os, 'remocao', v_os.status, 'Aguardando despacho', v_motivo, p_usuario,
            jsonb_build_object('equipe', v_d.equipe_id, 'despacho', v_d.id));

  return jsonb_build_object('despacho_id', v_d.id, 'equipe', v_d.equipe_id, 'status', 'Aguardando despacho');
end $$;

-- ═════════ 7) Segurança: nega por padrão ═════════
alter table eventos_os        enable row level security;
alter table transicoes_status enable row level security;

revoke all on eventos_os, transicoes_status from anon, authenticated;
grant select on eventos_os to authenticated;
drop policy if exists eventos_leitura on eventos_os;
create policy eventos_leitura on eventos_os for select to authenticated
  using (exists (select 1 from ordens_servico o where o.id = os_id and pode_ver_cidade(o.cidade_id)));
-- transicoes_status: sem policy → só a API (service_role)

grant all on eventos_os, transicoes_status to service_role;
grant all on sequence eventos_os_id_seq to service_role;

-- funções: executáveis SÓ pelo service_role (a API)
revoke all on function mudar_status(uuid, text, text, uuid)                           from public, anon, authenticated;
revoke all on function designar_equipe(uuid, text, boolean, boolean, text, uuid)      from public, anon, authenticated;
revoke all on function avancar_despacho(uuid, text, uuid, text)                       from public, anon, authenticated;
revoke all on function remover_equipe(uuid, text, uuid)                               from public, anon, authenticated;
grant execute on function mudar_status(uuid, text, text, uuid)                        to service_role;
grant execute on function designar_equipe(uuid, text, boolean, boolean, text, uuid)   to service_role;
grant execute on function avancar_despacho(uuid, text, uuid, text)                    to service_role;
grant execute on function remover_equipe(uuid, text, uuid)                            to service_role;

commit;
