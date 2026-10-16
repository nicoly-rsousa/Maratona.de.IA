-- Farol — 0003: endurecimento de segurança e integridade sobre 0001 + 0002.
-- Idempotente: pode ser rodada mais de uma vez. Rode DEPOIS de 0001_init.sql, seed.sql e 0002_solicitacoes.sql.
-- Valores de pontuação, faixas e regras continuam DEMONSTRATIVOS e fora daqui (vivem em tabelas).
--
-- Itens: (1) RLS e privilégios, (2) search_path das funções, (4) trigger de versão publicada,
--        (5) checks de versoes_pontuacao, (7) checks de cidades, (8) checks e índices de ordens_servico.
-- Não inclui: security definer em proximo_numero_os, trigger de histórico de regras, bloqueio de DELETE em cidades.

begin;

-- ═════════ (2) search_path fixo nas funções ═════════
alter function imutavel()                 set search_path = public;
alter function bloqueia_edicao_publicada() set search_path = public;
alter function proximo_numero_os(text)    set search_path = public;
alter function pode_ver_cidade(text)      set search_path = public;

-- ═════════ (4) Versão publicada: nem UPDATE nem DELETE; DELETE de rascunho devolve OLD ═════════
-- (no 0001 o DELETE devolvia NEW, que é nulo: o trigger cancelava a exclusão do rascunho em silêncio)
create or replace function bloqueia_edicao_publicada() returns trigger language plpgsql
set search_path = public as $$
begin
  if old.status = 'publicada' then
    raise exception 'Versão publicada é imutável; restaure como novo rascunho.';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;

-- ═════════ (5) versoes_pontuacao ═════════
-- (o unique (cidade_id, numero) do 0001 é MANTIDO)
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.versoes_pontuacao'::regclass and conname = 'ck_versao_numero_positivo') then
    alter table versoes_pontuacao add constraint ck_versao_numero_positivo check (numero > 0);
  end if;
  -- publicada (ou aguardando aprovação) exige justificativa, vigência e modo escolhido (§5)
  if not exists (select 1 from pg_constraint where conrelid = 'public.versoes_pontuacao'::regclass and conname = 'ck_versao_publicacao_completa') then
    alter table versoes_pontuacao add constraint ck_versao_publicacao_completa check (
      status = 'rascunho'
      or (justificativa is not null and length(btrim(justificativa)) > 0
          and vigencia_inicio is not null and modo_publicacao is not null)
    );
  end if;
end $$;

-- ═════════ (7) cidades ═════════
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cidades'::regclass and conname = 'ck_cidade_id_formato') then
    alter table cidades add constraint ck_cidade_id_formato check (id ~ '^[A-Z]{2,5}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cidades'::regclass and conname = 'ck_cidade_lat') then
    alter table cidades add constraint ck_cidade_lat check (lat is null or lat between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cidades'::regclass and conname = 'ck_cidade_lng') then
    alter table cidades add constraint ck_cidade_lng check (lng is null or lng between -180 and 180);
  end if;
end $$;

-- ═════════ (8) ordens_servico ═════════
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ordens_servico'::regclass and conname = 'ck_os_status') then
    alter table ordens_servico add constraint ck_os_status check (status in (
      'Aberta','Em triagem','Aguardando despacho','Suspensa','Equipe designada','A caminho',
      'Em execução','Aguardando recurso','Concluída','Cancelada'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ordens_servico'::regclass and conname = 'ck_os_lat') then
    alter table ordens_servico add constraint ck_os_lat check (lat is null or lat between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ordens_servico'::regclass and conname = 'ck_os_lng') then
    alter table ordens_servico add constraint ck_os_lng check (lng is null or lng between -180 and 180);
  end if;
end $$;
-- consulta de duplicidade (§11)
create index if not exists ix_os_transformador on ordens_servico (transformador) where transformador is not null;
create index if not exists ix_os_uc on ordens_servico (uc) where uc is not null;

-- ═════════ (1) Segurança: nega por padrão ═════════
-- 1a) Nenhum privilégio para anon/authenticated em nada do schema public…
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
-- …e o que for criado no futuro (por este papel) também nasce sem acesso.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 1b) RLS ligado em TODAS as tabelas (sem policy = nega tudo)
alter table cidades                 enable row level security;
alter table perfis                  enable row level security;
alter table usuario_cidades         enable row level security;
alter table versoes_pontuacao       enable row level security;
alter table regras_precedencia      enable row level security;
alter table regras_precedencia_hist enable row level security;
alter table contadores_os           enable row level security;
alter table ordens_servico          enable row level security;
alter table resultados_prioridade   enable row level security;
alter table equipes                 enable row level security;
alter table despachos               enable row level security;
alter table auditoria               enable row level security;
alter table solicitacoes            enable row level security;

-- 1c) Leitura para usuários logados, sempre pelo escopo de cidade. NENHUMA escrita e NADA para anon.
-- A policy chama pode_ver_cidade() com o papel de quem consulta, então authenticated precisa de EXECUTE nela.
grant execute on function pode_ver_cidade(text) to authenticated;
grant select on perfis, usuario_cidades, ordens_servico, resultados_prioridade, despachos, equipes, solicitacoes to authenticated;

drop policy if exists perfil_proprio on perfis;
create policy perfil_proprio on perfis for select to authenticated using (user_id = auth.uid());
drop policy if exists uc_proprio on usuario_cidades;
create policy uc_proprio on usuario_cidades for select to authenticated using (user_id = auth.uid());
drop policy if exists os_leitura on ordens_servico;
create policy os_leitura on ordens_servico for select to authenticated using (pode_ver_cidade(cidade_id));
drop policy if exists equipes_leitura on equipes;
create policy equipes_leitura on equipes for select to authenticated using (pode_ver_cidade(cidade_id));
drop policy if exists res_leitura on resultados_prioridade;
create policy res_leitura on resultados_prioridade for select to authenticated
  using (exists (select 1 from ordens_servico o where o.id = os_id and pode_ver_cidade(o.cidade_id)));
drop policy if exists desp_leitura on despachos;
create policy desp_leitura on despachos for select to authenticated
  using (exists (select 1 from ordens_servico o where o.id = os_id and pode_ver_cidade(o.cidade_id)));
drop policy if exists solic_leitura on solicitacoes;
create policy solic_leitura on solicitacoes for select to authenticated using (pode_ver_cidade(cidade_id));
-- cidades, versoes_pontuacao, regras_*, contadores_os, auditoria: sem policy → só a API (service_role) acessa.

-- 1d) service_role (a API) precisa de acesso explícito às tabelas, sequências e à função de numeração
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function proximo_numero_os(text) to service_role;

commit;
