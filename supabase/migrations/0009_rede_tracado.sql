-- Farol v2, etapa 2: traçado dos alimentadores, tipo legível das chaves, configuração do mapa e funções de consulta.
-- Depende da 0008. Só dados agregados/geográficos da rede; nenhum dado pessoal.
-- Proximidade nunca altera a fila: nada aqui toca nivel/codigo/pontos.

-- ───────── Colunas novas ─────────
alter table rede_chaves add column if not exists tipo_unidade text;      -- TIPOUNIDADE, ex.: "FU - Chave Fusível"
alter table circuitos add column if not exists tem_tracado boolean not null default false;

-- ───────── Traçado (um segmento por linha; cor pelo campo trecho, visibilidade pela rede) ─────────
create table if not exists rede_tracado (
  id bigserial primary key,
  circuito text not null,
  id_segmento text not null,
  rede text not null check (rede in ('MV','LV')),          -- LV = baixa tensão
  uso text,
  trecho int not null check (trecho between 1 and 4),      -- 4 = baixa tensão; 51 segmentos LV têm trecho 3
  dono text,                                               -- categoria (Energisa, Particular, Prefeitura)
  geom extensions.geography(LineString, 4326) not null,
  importacao_id bigint references importacoes(id),
  unique (circuito, id_segmento)
);
create index if not exists ix_tracado_circuito on rede_tracado (circuito, rede);
create index if not exists ix_tracado_geom on rede_tracado using gist (geom);
alter table rede_tracado enable row level security;

-- ───────── Configuração (valores DEMONSTRATIVOS; nada fixo no código) ─────────
do $$ begin
  alter table configuracoes add constraint ck_config_rede check (
    (chave not in ('rede.raio_padrao_m','rede.raio_max_m')
      or (jsonb_typeof(valor) = 'number' and (valor #>> '{}') ~ '^[1-9][0-9]{0,6}$'))
    and (chave <> 'rede.perfis_com_acesso' or jsonb_typeof(valor) = 'array')
    and (chave <> 'rede.mapa_prioridade_legada' or jsonb_typeof(valor) = 'object')
  );
exception when duplicate_object then null; end $$;

insert into configuracoes (chave, valor) values
  ('rede.raio_padrao_m', '1000'::jsonb),
  ('rede.raio_max_m', '5000'::jsonb),                                           -- [A CONFIRMAR]
  ('rede.perfis_com_acesso', '["Administrador","Supervisor","Despachante","Atendente","Usuário Chave"]'::jsonb),
  -- prioridade legada → código do Farol (0 Emergente … 4 Baixa). DEMONSTRATIVO, informativo.
  ('rede.mapa_prioridade_legada', '{
     "EMERGENCIAL":0, "URGENTE":1, "<2 DIAS":1, "<4 HORAS":1,
     "<5 DIAS":2, "ALTA":2, "<15 DIAS":3, "<30 DIAS":3, "BAIXA":4, "<90 DIAS":4
   }'::jsonb)
on conflict (chave) do nothing;

-- ───────── RLS: o acesso à rede segue rede.perfis_com_acesso (Equipe de campo fora por padrão) ─────────
create or replace function perfil_ve_rede() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.valor ? (perfil_atual())::text
    from configuracoes c where c.chave = 'rede.perfis_com_acesso'
  ), false);
$$;

drop policy if exists circuitos_leitura on circuitos;
drop policy if exists chaves_leitura on rede_chaves;
drop policy if exists trafos_leitura on rede_transformadores;
drop policy if exists os_imp_leitura on os_importadas;
create policy circuitos_leitura on circuitos for select to authenticated using (perfil_ve_rede());
create policy chaves_leitura on rede_chaves for select to authenticated using (perfil_ve_rede());
create policy trafos_leitura on rede_transformadores for select to authenticated using (perfil_ve_rede());
create policy os_imp_leitura on os_importadas for select to authenticated using (perfil_ve_rede());
create policy tracado_leitura on rede_tracado for select to authenticated using (perfil_ve_rede());

-- ───────── Funções de consulta (sob demanda, por circuito). SECURITY INVOKER: respeitam a RLS ─────────
create or replace function rede_tracado_geojson(p_circuito text, p_incluir_bt boolean default false)
returns jsonb language sql stable set search_path = pg_catalog, public, extensions, pg_temp as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(
    jsonb_build_object('type', 'Feature', 'geometry', st_asgeojson(t.geom, 6)::jsonb,
      'properties', jsonb_build_object('id', t.id_segmento, 'rede', t.rede, 'uso', t.uso, 'trecho', t.trecho, 'dono', t.dono))
  ), '[]'::jsonb))
  from rede_tracado t
  where t.circuito = p_circuito and (p_incluir_bt or t.rede <> 'LV');   -- baixa tensão liga/desliga por rede, não por trecho
$$;

create or replace function rede_chaves_geojson(p_circuito text)
returns jsonb language sql stable set search_path = pg_catalog, public, extensions, pg_temp as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(
    jsonb_build_object('type', 'Feature', 'geometry', st_asgeojson(c.geom, 6)::jsonb,
      'properties', jsonb_build_object('tipo', c.tipo, 'tipo_unidade', c.tipo_unidade, 'numero_operativo', c.numero_operativo))
  ), '[]'::jsonb))
  from rede_chaves c
  where c.circuito = p_circuito and c.geom is not null;
$$;

-- Transformadores só como agregado; sem posição (geom nula) a lat/lng saem nulas ("desconhecido").
create or replace function rede_transformadores_json(p_circuito text)
returns jsonb language sql stable set search_path = pg_catalog, public, extensions, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'transformador', t.transformador, 'clientes', t.clientes, 'ligados', t.ligados,
    'lat', case when t.geom is null then null else st_y(t.geom::extensions.geometry) end,
    'lng', case when t.geom is null then null else st_x(t.geom::extensions.geometry) end
  ) order by t.transformador), '[]'::jsonb)
  from rede_transformadores t where t.circuito = p_circuito;
$$;

-- Busca por raio: ST_MakePoint(LNG, LAT) — a ordem é (x, y) = (longitude, latitude).
-- Distância em linha reta, em metros. Ordena por distância e, em empate, por número (a ordem da fila entra na etapa 4).
-- O raio é validado contra o máximo configurado; nunca altera prioridade nem fila.
create or replace function os_importadas_no_raio(
  p_lat double precision, p_lng double precision, p_raio_m double precision,
  p_excluir_circuito text default null, p_regional text default null
) returns table (
  numero text, circuito text, circuito_origem text, prioridade_legada text, municipio text,
  lat double precision, lng double precision, distancia_m double precision
) language plpgsql stable set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_max double precision := coalesce((select (valor #>> '{}')::double precision from configuracoes where chave = 'rede.raio_max_m'), 5000);
  v_pt extensions.geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
begin
  if p_raio_m is null or p_raio_m <= 0 or p_raio_m > v_max then
    raise exception 'Raio inválido: use de 1 a % m.', v_max using errcode = 'FD400';
  end if;
  return query
    select o.numero, o.circuito, o.circuito_origem, o.prioridade_legada, o.municipio, o.lat, o.lng,
           st_distance(o.geom, v_pt) as distancia_m
    from os_importadas o
    left join regional r on r.municipio = o.municipio
    where o.geom is not null
      and st_dwithin(o.geom, v_pt, p_raio_m)
      and (p_excluir_circuito is null or o.circuito is distinct from p_excluir_circuito)
      and (p_regional is null or r.regional = p_regional)
    order by distancia_m, o.numero;
end $$;
