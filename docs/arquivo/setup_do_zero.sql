-- Farol — criação do banco DO ZERO (projeto Supabase VAZIO).
-- Baseado em migrations/0001_init.sql + correções de segurança e de regra de negócio.
-- Rode inteiro no SQL Editor (aba SQL Editor, NÃO Logs). Tudo roda em uma transação:
-- se algo falhar, nada é criado. NÃO rode em um banco que já tenha dados do Farol.
-- Valores de pontuação/faixas/regras são DEMONSTRATIVOS.

begin;

create extension if not exists pgcrypto;

-- ───────── Tipos ─────────
create type perfil_enum   as enum ('Administrador','Atendente','Despachante','Supervisor','Equipe de campo','Usuário Chave');
create type versao_status as enum ('rascunho','publicada','aguardando_aprovacao');
create type tipo_manut    as enum ('Corretiva','Preventiva');

-- ───────── Cidades, perfis e escopo ─────────
create table cidades (
  id text primary key check (id ~ '^[A-Z]{2,5}$'),   -- prefixo da OS: BH, CT
  nome text not null,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  ativa boolean not null default true                  -- cidade com OS não é excluída, só inativada
);

create table perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  perfil perfil_enum not null,
  todas_cidades boolean not null default false         -- permissão cidades.todas
);

create table usuario_cidades (
  user_id uuid references perfis(user_id) on delete cascade,
  cidade_id text references cidades(id),
  primary key (user_id, cidade_id)
);

-- ───────── Funções utilitárias ─────────
create function imutavel() returns trigger language plpgsql
set search_path = public as $$
begin raise exception 'Registro imutável (%).', tg_table_name; end $$;

-- Cidade com OS não pode ser excluída
create function bloqueia_exclusao_cidade() returns trigger language plpgsql
set search_path = public as $$
begin raise exception 'Cidade não é excluída, apenas inativada.'; end $$;
create trigger trg_cidade_sem_delete before delete on cidades
  for each row execute function bloqueia_exclusao_cidade();

-- ───────── Pontuação versionada (camada B) ─────────
create table versoes_pontuacao (
  id uuid primary key default gen_random_uuid(),
  cidade_id text references cidades(id),               -- null = global; cidade prevalece sobre global
  numero int not null check (numero > 0),
  status versao_status not null default 'rascunho',
  conteudo jsonb not null,                             -- { criterios[], faixas[] } (ver @farol/shared)
  justificativa text,
  vigencia_inicio timestamptz,
  modo_publicacao text check (modo_publicacao in ('novas','reclassificar')),
  etag int not null default 1,                         -- gravação concorrente: token antigo → 409
  criado_por uuid references perfis(user_id),
  criado_em timestamptz not null default now(),
  -- publicada exige justificativa, vigência e modo escolhido (§5)
  check (status = 'rascunho' or (justificativa is not null and vigencia_inicio is not null and modo_publicacao is not null))
);
create unique index uq_versao_escopo_numero on versoes_pontuacao (coalesce(cidade_id,'*'), numero);
create unique index uq_rascunho_escopo on versoes_pontuacao (coalesce(cidade_id,'*')) where status = 'rascunho';

-- Versão publicada é imutável: nem UPDATE nem DELETE
create function bloqueia_edicao_publicada() returns trigger language plpgsql
set search_path = public as $$
begin
  if old.status = 'publicada' then
    raise exception 'Versão publicada é imutável; restaure como novo rascunho.';
  end if;
  return case tg_op when 'DELETE' then old else new end;   -- (0001 retornava NEW no DELETE → apagava nada, sem erro)
end $$;
create trigger trg_versao_imutavel before update or delete on versoes_pontuacao
  for each row execute function bloqueia_edicao_publicada();

-- ───────── Regras de precedência (camada A) com histórico ─────────
create table regras_precedencia (
  id text primary key,
  nome text not null,
  ativa boolean not null default true,
  cond jsonb not null,                                 -- [{criterio, opcoes[]}]
  nivel int not null check (nivel between 1 and 10),
  prioridade_minima int not null check (prioridade_minima between 0 and 4),
  versao int not null default 1,
  atualizado_em timestamptz not null default now()
);
create table regras_precedencia_hist (
  id bigserial primary key,
  regra_id text not null, versao int not null,
  snapshot jsonb not null, justificativa text not null,
  usuario uuid references perfis(user_id), em timestamptz not null default now()
);
create trigger trg_regras_hist_imutavel before update or delete on regras_precedencia_hist
  for each row execute function imutavel();

-- Toda criação/alteração de regra grava snapshot e incrementa a versão.
-- A API pode informar a justificativa com: select set_config('farol.justificativa','texto',true);
create function regra_historico() returns trigger language plpgsql
set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.versao := old.versao + 1; end if;
  new.atualizado_em := now();
  insert into regras_precedencia_hist (regra_id, versao, snapshot, justificativa, usuario)
  values (new.id, new.versao, to_jsonb(new),
          coalesce(nullif(current_setting('farol.justificativa', true), ''), 'Sem justificativa informada'),
          auth.uid());
  return new;
end $$;
-- BEFORE para ajustar versao; histórico grava o estado final
create trigger trg_regras_hist before insert or update on regras_precedencia
  for each row execute function regra_historico();

-- ───────── Ordens de serviço ─────────
create table contadores_os (
  cidade_id text references cidades(id), ano int not null, ultimo int not null default 0,
  primary key (cidade_id, ano)
);

-- {PREFIXO}-{ANO}-{SEQ}, atômico por cidade/ano (upsert com lock de linha)
create function proximo_numero_os(p_cidade text) returns text
language plpgsql security definer set search_path = public as $$
declare v_ano int := extract(year from now() at time zone 'America/Sao_Paulo'); v_seq int;
begin
  insert into contadores_os (cidade_id, ano, ultimo) values (p_cidade, v_ano, 1)
  on conflict (cidade_id, ano) do update set ultimo = contadores_os.ultimo + 1
  returning ultimo into v_seq;
  return p_cidade || '-' || v_ano || '-' || lpad(v_seq::text, 4, '0');
end $$;

create table ordens_servico (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,                         -- índice único do número
  cidade_id text not null references cidades(id),
  endereco text not null,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  transformador text check (transformador ~ '^\d{4,12}$'),   -- sempre TEXTO, nunca número
  uc text check (uc ~ '^\d{6,10}$'),                         -- sempre TEXTO
  circuito text, conjunto text,
  tipo tipo_manut not null default 'Corretiva',
  fatos jsonb not null default '{}',                   -- fatos informados (critério → opção)
  prazo_limite timestamptz,
  status text not null default 'Aguardando despacho'
    check (status in ('Aberta','Em triagem','Aguardando despacho','Suspensa','Equipe designada','A caminho',
                      'Em execução','Aguardando recurso','Concluída','Cancelada')),
  versao_pontuacao_id uuid references versoes_pontuacao(id),
  -- cache do último resultado, para ordenar a fila no SQL
  nivel int not null default 0, codigo int not null default 4, pontos int not null default 0,
  aberta_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index ix_os_fila on ordens_servico (cidade_id, nivel desc, codigo, pontos desc, aberta_em)
  where status not in ('Concluída','Cancelada');
create index ix_os_transformador on ordens_servico (transformador) where transformador is not null;
create index ix_os_uc on ordens_servico (uc) where uc is not null;

-- Resultado imutável de cada cálculo
create table resultados_prioridade (
  id bigserial primary key,
  os_id uuid not null references ordens_servico(id),
  versao int not null,
  itens jsonb not null, pontos int not null, codigo_faixa int not null,
  regras_aplicadas text[] not null default '{}',
  nivel int not null, codigo int not null,
  motivo_principal text not null, motivo_calculo text not null,
  calculado_em timestamptz not null default now()
);
create index ix_res_os on resultados_prioridade (os_id, calculado_em desc);
create trigger trg_resultado_imutavel before update or delete on resultados_prioridade
  for each row execute function imutavel();

-- ───────── Equipes e despacho ─────────
create table equipes (
  id text primary key, cidade_id text not null references cidades(id),
  capacidade int not null check (capacidade > 0),
  qualificacoes text[] not null default '{}',
  lat double precision, lng double precision, ativa boolean not null default true
);
create table despachos (
  id uuid primary key default gen_random_uuid(),
  os_id uuid not null references ordens_servico(id),
  equipe_id text not null references equipes(id),
  estado text not null default 'designada'
    check (estado in ('designada','a_caminho','em_execucao','concluida','removida')),
  apoio_intermunicipal boolean not null default false,
  excecao_justificativa text,
  criado_em timestamptz not null default now()
);
-- um despacho ativo por OS: a 2ª designação simultânea falha (→ 409)
create unique index uq_despacho_ativo on despachos (os_id)
  where estado in ('designada','a_caminho','em_execucao');

-- ───────── Auditoria (imutável) ─────────
create table auditoria (
  id bigserial primary key, usuario uuid, acao text not null,
  entidade text, entidade_id text, cidade_id text,
  detalhe jsonb, resultado text not null default 'ok', em timestamptz not null default now()
);
create trigger trg_auditoria_imutavel before update or delete on auditoria
  for each row execute function imutavel();

-- ───────── Segurança: nega por padrão ─────────
-- 1) Nenhum privilégio para anon/authenticated em nada do schema public…
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
-- …e o que for criado no futuro também nasce sem acesso.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 2) RLS ligado em TODAS as tabelas (sem policy = nega tudo)
alter table cidades                enable row level security;
alter table perfis                 enable row level security;
alter table usuario_cidades        enable row level security;
alter table versoes_pontuacao      enable row level security;
alter table regras_precedencia     enable row level security;
alter table regras_precedencia_hist enable row level security;
alter table contadores_os          enable row level security;
alter table ordens_servico         enable row level security;
alter table resultados_prioridade  enable row level security;
alter table equipes                enable row level security;
alter table despachos              enable row level security;
alter table auditoria              enable row level security;

-- 3) Escopo por cidade (usado só pelas policies de LEITURA de usuários logados)
create function pode_ver_cidade(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis p where p.user_id = auth.uid() and (p.todas_cidades or p.perfil = 'Administrador'))
      or exists (select 1 from usuario_cidades u where u.user_id = auth.uid() and u.cidade_id = c);
$$;
revoke execute on function pode_ver_cidade(text) from public, anon;
grant  execute on function pode_ver_cidade(text) to authenticated;

-- 4) Leitura para usuários autenticados, sempre pelo escopo de cidade. NENHUMA escrita e NADA para anon.
grant select on perfis, usuario_cidades, ordens_servico, resultados_prioridade, despachos, equipes to authenticated;
create policy perfil_proprio on perfis          for select to authenticated using (user_id = auth.uid());
create policy uc_proprio     on usuario_cidades for select to authenticated using (user_id = auth.uid());
create policy os_leitura     on ordens_servico  for select to authenticated using (pode_ver_cidade(cidade_id));
create policy equipes_leitura on equipes        for select to authenticated using (pode_ver_cidade(cidade_id));
create policy res_leitura on resultados_prioridade for select to authenticated
  using (exists (select 1 from ordens_servico o where o.id = os_id and pode_ver_cidade(o.cidade_id)));
create policy desp_leitura on despachos for select to authenticated
  using (exists (select 1 from ordens_servico o where o.id = os_id and pode_ver_cidade(o.cidade_id)));
-- cidades, versoes_pontuacao, regras_*, contadores_os, auditoria: sem policy → só a API (service_role) acessa.

-- 5) service_role (API) precisa de acesso explícito às tabelas e à função de numeração
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function proximo_numero_os(text) to service_role;

-- ───────── Dados demonstrativos (NÃO OFICIAIS) ─────────
insert into cidades (id, nome, lat, lng) values
  ('BH','Belo Horizonte',-19.9167,-43.9345),
  ('CT','Contagem',-19.9319,-44.0539);

insert into equipes (id, cidade_id, capacidade, qualificacoes) values
  ('BH-A','BH',2,'{"Linha viva"}'), ('BH-B','BH',1,'{}'),
  ('CT-A','CT',1,'{"Linha viva"}'), ('CT-B','CT',2,'{}');

select set_config('farol.justificativa','Carga inicial demonstrativa',true);
insert into regras_precedencia (id, nome, cond, nivel, prioridade_minima) values
 ('R-VIDA','Risco iminente à vida','[{"criterio":"vida","opcoes":["Cabo energizado / choque"]}]',3,1),
 ('R-ESS','Serviço essencial sem reserva','[{"criterio":"essencial","opcoes":["Hospital / emergência"]},{"criterio":"reserva","opcoes":["Não","Desconhecida"]}]',2,0),
 ('R-EST','Estrutura com risco de queda','[{"criterio":"estrutura","opcoes":["Risco de queda"]}]',1,2),
 ('R-PREV','Preventiva com prazo iminente','[{"criterio":"tipo","opcoes":["Preventiva"]},{"criterio":"prazo","opcoes":["< 24 h ou vencido"]}]',1,2);
-- A versão de pontuação v1 é inserida pela API:  npm run seed -w @farol/api

commit;

-- ───────── Depois de rodar ─────────
-- 1. Authentication → Users → Add user (e-mail + senha). Copie o UUID do usuário.
-- 2. Crie o perfil do primeiro administrador (troque o UUID):
--    insert into perfis (user_id, nome, perfil) values ('<UUID>', 'Seu Nome', 'Administrador');
-- 3. No computador:  npm run seed -w @farol/api   (cria a pontuação v1 demonstrativa)
