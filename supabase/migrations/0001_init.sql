-- Farol — schema inicial (Supabase / Postgres)
-- Valores de pontuação, faixas e regras são DEMONSTRATIVOS: vivem em tabelas, nunca no código.

create extension if not exists "pgcrypto";

-- ───────── Cidades e usuários ─────────
create table cidades (
  id text primary key,                -- prefixo da OS: BH, CT
  nome text not null,
  lat double precision, lng double precision,
  ativa boolean not null default true  -- cidade com OS não é excluída, só inativada
);

create type perfil_enum as enum
  ('Administrador','Atendente','Despachante','Supervisor','Equipe de campo','Usuário Chave');

create table perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  perfil perfil_enum not null,
  todas_cidades boolean not null default false     -- permissão cidades.todas
);

create table usuario_cidades (
  user_id uuid references perfis(user_id) on delete cascade,
  cidade_id text references cidades(id),
  primary key (user_id, cidade_id)
);

-- ───────── Pontuação versionada (camada B) ─────────
create type versao_status as enum ('rascunho','publicada','aguardando_aprovacao');

create table versoes_pontuacao (
  id uuid primary key default gen_random_uuid(),
  cidade_id text references cidades(id),            -- null = global; cidade prevalece sobre global
  numero int not null,
  status versao_status not null default 'rascunho',
  conteudo jsonb not null,                          -- { criterios[], faixas[] } (ver @farol/shared)
  justificativa text,
  vigencia_inicio timestamptz,
  modo_publicacao text check (modo_publicacao in ('novas','reclassificar')),
  etag int not null default 1,                      -- gravação concorrente: token antigo → 409
  criado_por uuid references perfis(user_id),
  criado_em timestamptz not null default now(),
  unique (cidade_id, numero)
);
create unique index uq_versao_escopo_numero on versoes_pontuacao (coalesce(cidade_id,'*'), numero);
-- um único rascunho por escopo
create unique index uq_rascunho_escopo
  on versoes_pontuacao (coalesce(cidade_id,'*')) where status = 'rascunho';

create or replace function bloqueia_edicao_publicada() returns trigger language plpgsql as $$
begin
  if old.status = 'publicada' then
    raise exception 'Versão publicada é imutável; restaure como novo rascunho.';
  end if;
  return new;
end $$;
create trigger trg_versao_imutavel before update or delete on versoes_pontuacao
  for each row execute function bloqueia_edicao_publicada();

-- ───────── Regras de precedência (camada A) ─────────
create table regras_precedencia (
  id text primary key,
  nome text not null,
  ativa boolean not null default true,
  cond jsonb not null,                              -- [{criterio, opcoes[]}]
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

-- ───────── Ordens de serviço ─────────
create type tipo_manut as enum ('Corretiva','Preventiva');

create table contadores_os (
  cidade_id text references cidades(id), ano int not null, ultimo int not null default 0,
  primary key (cidade_id, ano)
);

-- {PREFIXO}-{ANO}-{SEQ}, atômico por cidade/ano
create or replace function proximo_numero_os(p_cidade text) returns text
language plpgsql as $$
declare v_ano int := extract(year from now() at time zone 'America/Sao_Paulo'); v_seq int;
begin
  insert into contadores_os (cidade_id, ano, ultimo) values (p_cidade, v_ano, 1)
  on conflict (cidade_id, ano) do update set ultimo = contadores_os.ultimo + 1
  returning ultimo into v_seq;
  return p_cidade || '-' || v_ano || '-' || lpad(v_seq::text, 4, '0');
end $$;

create table ordens_servico (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  cidade_id text not null references cidades(id),
  endereco text not null,
  lat double precision, lng double precision,
  transformador text check (transformador ~ '^\d{4,12}$'),   -- sempre texto
  uc text check (uc is null or uc ~ '^\d{6,10}$'),
  circuito text, conjunto text,
  tipo tipo_manut not null default 'Corretiva',
  fatos jsonb not null default '{}',                -- fatos informados (critério → opção)
  prazo_limite timestamptz,
  status text not null default 'Aguardando despacho',
  versao_pontuacao_id uuid references versoes_pontuacao(id),
  -- cache do último resultado, para ordenar a fila no SQL
  nivel int not null default 0, codigo int not null default 4, pontos int not null default 0,
  aberta_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index ix_os_fila on ordens_servico
  (cidade_id, nivel desc, codigo, pontos desc, aberta_em)
  where status not in ('Concluída','Cancelada');

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

create or replace function imutavel() returns trigger language plpgsql as $$
begin raise exception 'Registro imutável.'; end $$;
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

-- ───────── Auditoria ─────────
create table auditoria (
  id bigserial primary key, usuario uuid, acao text not null,
  entidade text, entidade_id text, cidade_id text,
  detalhe jsonb, resultado text not null default 'ok', em timestamptz not null default now()
);
create trigger trg_auditoria_imutavel before update or delete on auditoria
  for each row execute function imutavel();

-- ───────── RLS (defesa em profundidade; a API usa service_role e filtra no servidor) ─────────
create or replace function pode_ver_cidade(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis p where p.user_id = auth.uid() and (p.todas_cidades or p.perfil = 'Administrador'))
      or exists (select 1 from usuario_cidades u where u.user_id = auth.uid() and u.cidade_id = c);
$$;

alter table ordens_servico enable row level security;
alter table resultados_prioridade enable row level security;
alter table despachos enable row level security;
alter table perfis enable row level security;

create policy os_leitura on ordens_servico for select using (pode_ver_cidade(cidade_id));
create policy res_leitura on resultados_prioridade for select
  using (exists (select 1 from ordens_servico o where o.id = os_id and pode_ver_cidade(o.cidade_id)));
create policy desp_leitura on despachos for select
  using (exists (select 1 from ordens_servico o where o.id = os_id and pode_ver_cidade(o.cidade_id)));
create policy perfil_proprio on perfis for select using (user_id = auth.uid());
-- Escritas: somente via API (service_role ignora RLS). Nenhuma policy de insert/update/delete para anon/authenticated.
