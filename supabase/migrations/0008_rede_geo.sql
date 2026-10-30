-- Farol v2, etapa 1: rede elétrica, geografia e importação.
-- Só dados agregados. Nenhum dado pessoal de cliente (nome, endereço, medidor, CDC, conta) entra aqui.
-- Proximidade nunca altera a fila: nada nesta migração mexe em nivel/codigo/pontos.

create extension if not exists postgis with schema extensions;
-- IF NOT EXISTS não move uma instalação anterior: falhar antes de criar dependências.
do $$ begin
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                 where e.extname = 'postgis' and n.nspname = 'extensions') then
    raise exception 'PostGIS deve estar instalado no schema extensions';
  end if;
end $$;

-- ───────── Rastreabilidade das importações (RN07 / REGRADENEGOCIO 15.7) ─────────
create table if not exists importacoes (
  id bigserial primary key,
  fonte text not null,
  arquivo text not null,
  importado_em timestamptz not null default now(),
  linhas_lidas int not null,
  linhas_gravadas int not null,
  relatorio jsonb not null default '{}'
);

-- ───────── Circuitos (alimentadores) ─────────
create table if not exists circuitos (
  codigo text primary key,                       -- sempre texto
  bbox_min_lat double precision, bbox_min_lng double precision,
  bbox_max_lat double precision, bbox_max_lng double precision,
  chaves_qtd int,
  clientes int,                                  -- null = desconhecido (nunca zero por omissão)
  ligados int,
  desligados int,
  classes jsonb,                                 -- {"residencial": n, ...} agregado
  importacao_id bigint references importacoes(id),
  atualizado_em timestamptz not null default now()
);

create table if not exists rede_chaves (
  id bigserial primary key,
  circuito text not null,
  conjunto text,
  tipo text,
  id_ativo text,
  numero_operativo text,
  geom extensions.geography(Point, 4326),
  geom_fim extensions.geography(Point, 4326),    -- só se LAT_1/LONG_1 forem confiáveis
  importacao_id bigint references importacoes(id)
);
create index if not exists ix_rede_chaves_circuito on rede_chaves (circuito);
create index if not exists ix_rede_chaves_geom on rede_chaves using gist (geom);

create table if not exists rede_transformadores (
  id bigserial primary key,
  circuito text not null,
  transformador text not null,                   -- texto (REGRADENEGOCIO 12)
  clientes int,
  ligados int,
  classes jsonb,
  qtd_pontos_geo int,                            -- quantos clientes tinham coordenada
  geom extensions.geography(Point, 4326),        -- centroide; null se < 3 pontos (privacidade)
  importacao_id bigint references importacoes(id),
  unique (circuito, transformador)
);
create index if not exists ix_rede_trafo_geom on rede_transformadores using gist (geom);

-- ───────── Regional (município → regional), cadastrada por administrador ─────────
create table if not exists regional (
  municipio text primary key,
  regional text,                                 -- vazia = filtro "não configurado"
  os_pendentes int,
  atualizado_em timestamptz not null default now()
);

-- ───────── OS importadas (separadas da fila; ver pendência de migração para o Farol) ─────────
create table if not exists os_importadas (
  numero text primary key,
  circuito text,
  circuito_origem text not null
    check (circuito_origem in ('importado','nao_identificado','informado','confirmado')),
  lat double precision, lng double precision,
  geom extensions.geography(Point, 4326),
  municipio text,
  origem_geo text not null
    check (origem_geo in ('informado','convertido_utm','derivado','desconhecido')),
  fora_bbox boolean,                             -- null = não avaliável
  prioridade_legada text,                        -- INFORMATIVA; não entra na fila
  prazo timestamptz,
  clientes int,                                  -- null = desconhecido
  tipo_servico text,
  familia_ativo text,
  importacao_id bigint references importacoes(id),
  check (lat is null or lat between -90 and 90),
  check (lng is null or lng between -180 and 180)
);
create index if not exists ix_os_imp_geom on os_importadas using gist (geom);
create index if not exists ix_os_imp_circuito on os_importadas (circuito);
create index if not exists ix_os_imp_municipio on os_importadas (municipio);

-- ───────── Colunas novas na OS da fila (nulas nas OS existentes) ─────────
alter table ordens_servico add column if not exists circuito_origem text;
alter table ordens_servico add column if not exists municipio text;
alter table ordens_servico add column if not exists origem_geo text;
alter table ordens_servico add column if not exists geom extensions.geography(Point, 4326);
do $$ begin
  alter table ordens_servico add constraint ck_os_circuito_origem
    check (circuito_origem is null or circuito_origem in ('importado','nao_identificado','informado','confirmado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table ordens_servico add constraint ck_os_origem_geo
    check (origem_geo is null or origem_geo in ('informado','convertido_utm','derivado','desconhecido'));
exception when duplicate_object then null; end $$;
create index if not exists ix_os_geom on ordens_servico using gist (geom);

-- ───────── Sugestão de carona (só registra; não designa equipe nem muda a fila) ─────────
create table if not exists sugestoes_carona (
  id bigserial primary key,
  os_origem uuid not null references ordens_servico(id),
  os_sugerida uuid not null references ordens_servico(id),
  raio_m int not null check (raio_m > 0),
  usuario uuid not null references perfis(user_id),
  criado_em timestamptz not null default now(),
  check (os_origem <> os_sugerida)
);
create index if not exists ix_carona_origem on sugestoes_carona (os_origem);

-- ───────── RLS ─────────
-- Escritas: somente via API/importação (service_role ignora RLS). Sem policy de escrita.
alter table importacoes enable row level security;
alter table circuitos enable row level security;
alter table rede_chaves enable row level security;
alter table rede_transformadores enable row level security;
alter table regional enable row level security;
alter table os_importadas enable row level security;
alter table sugestoes_carona enable row level security;

-- Equipe de campo não acessa a busca de carona (15.6 [A CONFIRMAR]); Usuário Chave só consulta.
create or replace function perfil_atual() returns perfil_enum
language sql stable security definer set search_path = public as $$
  select perfil from perfis where user_id = auth.uid();
$$;

create policy circuitos_leitura on circuitos for select to authenticated using (true);
create policy chaves_leitura on rede_chaves for select to authenticated using (true);
create policy trafos_leitura on rede_transformadores for select to authenticated using (true);
create policy regional_leitura on regional for select to authenticated using (true);
create policy importacoes_leitura on importacoes for select to authenticated using (true);
create policy os_imp_leitura on os_importadas for select to authenticated
  using (perfil_atual() is not null);
create policy carona_leitura on sugestoes_carona for select to authenticated
  using (
    perfil_atual() in ('Administrador','Despachante','Supervisor')
    and exists (select 1 from ordens_servico o where o.id = os_origem and pode_ver_cidade(o.cidade_id))
  );
