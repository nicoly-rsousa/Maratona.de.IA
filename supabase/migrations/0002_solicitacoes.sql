-- Farol — 0002: solicitações (vínculo de nova solicitação a uma OS existente, §11),
-- marca de OS demonstrativa e qualificação exigida.
-- Idempotente: pode ser rodada mais de uma vez. Requer o 0001_init.sql já aplicado.
-- Não altera nada do 0001 além de ADICIONAR colunas e um índice único em ordens_servico.

begin;

-- ───────── ordens_servico: novas colunas ─────────
-- OS carregada pelo seed:os (dado demonstrativo); torna o seed idempotente sem depender do endereço.
alter table ordens_servico add column if not exists demo boolean not null default false;
-- Qualificação exigida para o atendimento (ex.: "Linha viva"); null = nenhuma. Usada pela compatibilidade do despacho (§9).
alter table ordens_servico add column if not exists exige_qualificacao text
  check (exige_qualificacao is null or length(btrim(exige_qualificacao)) > 0);

-- Permite FK composta (os_id, cidade_id): a solicitação nunca fica em cidade diferente da OS.
create unique index if not exists uq_os_id_cidade on ordens_servico (id, cidade_id);
-- Consulta de duplicidade (§11): conjunto + tipo
create index if not exists ix_os_conjunto on ordens_servico (cidade_id, conjunto) where conjunto is not null;

-- ───────── solicitacoes ─────────
-- Cada pedido recebido para uma OS: o primeiro ('abertura') nasce com a OS; os demais ('vinculada')
-- são solicitações novas que o atendente vinculou a uma OS existente. Append-only.
create table if not exists solicitacoes (
  id uuid primary key default gen_random_uuid(),
  os_id uuid not null,
  cidade_id text not null references cidades(id),
  origem text not null check (origem in ('abertura','vinculada')),
  endereco text,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  transformador text check (transformador is null or transformador ~ '^\d{4,12}$'),
  uc text check (uc is null or uc ~ '^\d{6,10}$'),
  fatos jsonb not null default '{}',          -- o que o solicitante informou (critério → opção); não altera os fatos da OS
  observacao text,
  criado_por uuid references perfis(user_id),
  criado_em timestamptz not null default now(),
  foreign key (os_id, cidade_id) references ordens_servico (id, cidade_id)
);
create index if not exists ix_solic_os on solicitacoes (os_id, criado_em);
-- no máximo uma solicitação de abertura por OS
create unique index if not exists uq_solic_abertura on solicitacoes (os_id) where origem = 'abertura';

-- Imutável (reaproveita imutavel() do 0001)
drop trigger if exists trg_solicitacao_imutavel on solicitacoes;
create trigger trg_solicitacao_imutavel before update or delete on solicitacoes
  for each row execute function imutavel();

-- ───────── Segurança: nega por padrão, leitura por cidade ─────────
alter table solicitacoes enable row level security;
revoke all on solicitacoes from anon, authenticated;
grant select on solicitacoes to authenticated;
grant all on solicitacoes to service_role;

drop policy if exists solic_leitura on solicitacoes;
create policy solic_leitura on solicitacoes for select to authenticated
  using (pode_ver_cidade(cidade_id));
-- Escritas: somente a API (service_role ignora RLS). Nenhuma policy de insert/update/delete.

-- OS que já existiam antes desta migration ganham a solicitação de abertura (idempotente).
insert into solicitacoes (os_id, cidade_id, origem, endereco, lat, lng, transformador, uc, fatos, criado_em)
select o.id, o.cidade_id, 'abertura', o.endereco, o.lat, o.lng, o.transformador, o.uc, o.fatos, o.aberta_em
from ordens_servico o
where not exists (select 1 from solicitacoes s where s.os_id = o.id and s.origem = 'abertura');

commit;
