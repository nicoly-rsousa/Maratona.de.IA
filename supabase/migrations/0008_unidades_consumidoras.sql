-- Farol — 0008: cadastro de classes de cliente, unidades consumidoras e cidade demonstrativa RP
-- (REGRADENEGOCIO §12, §14.1/§14.2/§14.3). Idempotente: pode ser rodada mais de uma vez.
--
-- Escopo (Lotes 1–3 do ajuste de UC): cadastro de classes_cliente, cadastro de unidades_consumidoras
-- com as colunas combinadas (e só elas — nada de "extras"), formato de UC configurável (nunca fixo no
-- código), edição manual com justificativa+auditoria. O Lote 4 (fundir o critério de pontuação
-- "essencial" dentro da classe "Essencial" e remover a regra R-ESS equivalente) NÃO está nesta migration.
--
-- Importante: ordens_servico.uc e solicitacoes.uc continuam como estão (regex fixa ^\d{6,10}$ gravada
-- na 0001/0002, sem FK para este cadastro) — REGRADENEGOCIO §12 diz que a UC de uma OS "não é validada
-- quando fora do cadastro", ou seja, abrir OS não passa a exigir que a UC exista aqui. Atenção: se
-- "uc.formato_regex" (abaixo) for alterado depois, o check de ordens_servico/solicitacoes NÃO acompanha
-- — os dois formatos ficam fora de sincronia até uma migration própria trocar aquele check fixo por um
-- trigger igual ao de unidades_consumidoras (fora do escopo deste lote).
--
-- Não existe tabela "ativos_rede" neste projeto (nem nesta migration, nem em nenhuma anterior) — os
-- checks de faixa de lat/lng abaixo valem só para a tabela nova com coordenadas que de fato existe aqui
-- (unidades_consumidoras).

begin;

-- ═════════ 0) Cidade demonstrativa RP ═════════
-- Centro = média aritmética de LAT/LONG das 200 linhas de
-- "docs/dados/Experimento_Dados_Ficticios - BASE CLIENTES 1.xlsx" (aba Base_Ficticia), calculada com
-- node + a lib xlsx nesta sessão (não é um valor inventado): -21.528429, -42.642412. A planilha não tem
-- coluna de cidade — é por isso que o import usa --cidade RP fixo (ver import-ucs.ts e PENDENCIAS-UC.md).
insert into cidades (id, nome, lat, lng, ativa) values
  ('RP', 'Vale do Rio Pomba (demonstrativo)', -21.528429, -42.642412, true)
on conflict (id) do nothing;

-- ═════════ 1) Formato de UC configurável (padrão ^\d{6,10}$, nunca fixo no código) ═════════
insert into configuracoes (chave, valor) values
  ('uc.formato_regex', '"^\\d{6,10}$"'::jsonb)
on conflict (chave) do nothing;

create or replace function uc_formato_regex() returns text
language plpgsql stable set search_path = public as $$
declare v text;
begin
  select valor #>> '{}' into v from configuracoes where chave = 'uc.formato_regex';
  if v is null then
    raise exception 'Configuração "uc.formato_regex" ausente.' using errcode = 'FD500', hint = 'config_ausente';
  end if;
  return v;
end $$;

-- ═════════ 2) Classes de cliente (cadastro configurável; quem pode escrever é decidido na API) ═════════
create table if not exists classes_cliente (
  id text primary key check (length(btrim(id)) > 0),
  nome text not null check (length(btrim(nome)) > 0),
  ativa boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_por uuid references perfis(user_id),
  atualizado_em timestamptz not null default now()
);

-- Classes demonstrativas (REGRADENEGOCIO §14.2): Poder público, Rural, Essencial e Residencial são as
-- iniciais; Comercial e Industrial foram cadastradas para acomodar a base fictícia de UCs.
insert into classes_cliente (id, nome, ordem) values
  ('poder_publico', 'Poder público', 1),
  ('rural', 'Rural', 2),
  ('essencial', 'Essencial', 3),
  ('residencial', 'Residencial', 4),
  ('comercial', 'Comercial', 5),
  ('industrial', 'Industrial', 6)
on conflict (id) do nothing;

-- ═════════ 3) Unidades consumidoras (cadastro da concessionária) ═════════
-- Só estas colunas: nada de "extras" nem de campos fora desta lista (ajuste de UC, item 4).
--
-- "situacao" guarda só o CÓDIGO interno fixo (ATIVO/INATIVO, check abaixo); o RÓTULO exibido é
-- configurável (REGRADENEGOCIO §14.1, "Farol:Rotulos") e vive em configuracoes.rotulos.uc_situacao,
-- sem jamais mudar o valor gravado aqui.
create table if not exists unidades_consumidoras (
  uc text primary key,
  nome text not null,                          -- nome completo; a API mascara para todo perfil exceto Administrador
  classe text references classes_cliente(id),
  situacao text check (situacao is null or situacao in ('ATIVO', 'INATIVO')),
  data_ligacao date,
  endereco text,
  bairro text,
  cidade text references cidades(id),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  id_ponto_entrega text,
  id_ramal text,
  transformador text,
  circuito text,
  conjunto text,
  cod_poste text,
  medidor text,
  tipo_medidor text,
  fases text,
  num_rota text,
  num_livro text,
  origem text not null default 'importado' check (origem in ('importado', 'manual')),
  importado_em timestamptz,
  atualizado_por uuid references perfis(user_id),
  atualizado_em timestamptz not null default now()
);
create index if not exists ix_uc_cidade on unidades_consumidoras (cidade);
create index if not exists ix_uc_classe on unidades_consumidoras (classe);

-- Rótulos exibidos para os códigos de situação (§14.1) — configurável, nunca fixo no front/back.
insert into configuracoes (chave, valor) values
  ('rotulos.uc_situacao', '{"ATIVO": "Ativo", "INATIVO": "Inativo"}'::jsonb)
on conflict (chave) do nothing;

-- Formato configurável (não fixo) e classe ativa — validados na gravação, nunca no INSERT bruto de uma planilha ruim.
create or replace function valida_unidade_consumidora() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.uc !~ uc_formato_regex() then
    raise exception 'UC fora do formato configurado (uc.formato_regex).' using errcode = 'FD400', hint = 'uc_formato_invalido';
  end if;
  if new.classe is not null and not exists (select 1 from classes_cliente c where c.id = new.classe and c.ativa) then
    raise exception 'Classe de cliente inválida ou inativa.' using errcode = 'FD400', hint = 'classe_invalida';
  end if;
  return new;
end $$;

drop trigger if exists trg_uc_valida on unidades_consumidoras;
create trigger trg_uc_valida before insert or update on unidades_consumidoras
  for each row execute function valida_unidade_consumidora();

-- ═════════ 4) Edição manual de UC: justificativa obrigatória + auditoria (espelha mudar_status/designar_equipe) ═════════
-- Só os campos de cadastro (não deixa trocar "uc" nem "origem"/"importado_em" por aqui).
create or replace function editar_unidade_consumidora(p_uc text, p_patch jsonb, p_justificativa text, p_usuario uuid)
returns unidades_consumidoras
language plpgsql set search_path = public as $$
declare
  v_just text := nullif(btrim(coalesce(p_justificativa, '')), '');
  v_antes unidades_consumidoras;
  v_depois unidades_consumidoras;
begin
  if v_just is null then
    raise exception 'Justificativa obrigatória para editar UC.' using errcode = 'FD400', hint = 'justificativa_obrigatoria';
  end if;

  select * into v_antes from unidades_consumidoras where uc = p_uc for update;
  if not found then
    raise exception 'UC % não encontrada no cadastro.', p_uc using errcode = 'FD404', hint = 'uc_nao_encontrada';
  end if;

  update unidades_consumidoras set
    nome = coalesce(p_patch ->> 'nome', nome),
    classe = coalesce(p_patch ->> 'classe', classe),
    situacao = coalesce(p_patch ->> 'situacao', situacao),
    data_ligacao = coalesce((p_patch ->> 'data_ligacao')::date, data_ligacao),
    endereco = coalesce(p_patch ->> 'endereco', endereco),
    bairro = coalesce(p_patch ->> 'bairro', bairro),
    cidade = coalesce(p_patch ->> 'cidade', cidade),
    lat = coalesce((p_patch ->> 'lat')::double precision, lat),
    lng = coalesce((p_patch ->> 'lng')::double precision, lng),
    id_ponto_entrega = coalesce(p_patch ->> 'id_ponto_entrega', id_ponto_entrega),
    id_ramal = coalesce(p_patch ->> 'id_ramal', id_ramal),
    transformador = coalesce(p_patch ->> 'transformador', transformador),
    circuito = coalesce(p_patch ->> 'circuito', circuito),
    conjunto = coalesce(p_patch ->> 'conjunto', conjunto),
    cod_poste = coalesce(p_patch ->> 'cod_poste', cod_poste),
    medidor = coalesce(p_patch ->> 'medidor', medidor),
    tipo_medidor = coalesce(p_patch ->> 'tipo_medidor', tipo_medidor),
    fases = coalesce(p_patch ->> 'fases', fases),
    num_rota = coalesce(p_patch ->> 'num_rota', num_rota),
    num_livro = coalesce(p_patch ->> 'num_livro', num_livro),
    origem = 'manual',
    atualizado_por = p_usuario,
    atualizado_em = now()
  where uc = p_uc;

  select * into v_depois from unidades_consumidoras where uc = p_uc;

  insert into auditoria (usuario, acao, entidade, entidade_id, cidade_id, detalhe, resultado)
  values (p_usuario, 'uc.editar_manual', 'unidades_consumidoras', p_uc, v_depois.cidade,
    jsonb_build_object('justificativa', v_just, 'antes', to_jsonb(v_antes), 'depois', to_jsonb(v_depois)), 'ok');

  return v_depois;
end $$;

-- ═════════ 5) RLS (defesa em profundidade; a API usa service_role e filtra/mascara no servidor) ═════════
alter table classes_cliente enable row level security;
alter table unidades_consumidoras enable row level security;

revoke all on classes_cliente from anon, authenticated;
revoke all on unidades_consumidoras from anon, authenticated;
grant all on classes_cliente to service_role;
grant all on unidades_consumidoras to service_role;

-- Cadastro de classes é só uma lista de apoio (sem PII): leitura liberada a qualquer usuário logado.
create policy classes_leitura on classes_cliente for select to authenticated using (true);
grant select on classes_cliente to authenticated;

-- unidades_consumidoras tem dado pessoal (nome, endereço): NENHUMA policy de leitura para authenticated,
-- nem mesmo escopada por cidade — só o service_role (API) lê, e é a API quem aplica a máscara de nome.
-- Sem policy de select para authenticated, RLS barra qualquer leitura direta do token do usuário.

commit;
