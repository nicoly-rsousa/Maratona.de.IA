-- 0012: sugestões "sugerir junto" entre OS importadas (chave = numero) e perfis que podem sugerir.
-- sugestoes_carona (0008) referencia ordens_servico por uuid e não comporta OS importadas; esta tabela cobre a rede.
-- Só registra: não designa equipe nem altera a fila. Escrita e leitura apenas pela API (service_role).
begin;

create table if not exists sugestoes_rede (
  id bigserial primary key,
  os_origem text not null,
  os_sugerida text not null,
  raio_m int not null check (raio_m > 0),
  usuario uuid not null references perfis(user_id),
  criado_em timestamptz not null default now(),
  check (os_origem <> os_sugerida),
  unique (os_origem, os_sugerida)
);
alter table sugestoes_rede enable row level security;   -- sem policy: authenticated/anon não leem nem escrevem
revoke all on sugestoes_rede from anon, authenticated;
revoke all on sequence sugestoes_rede_id_seq from anon, authenticated;

-- Perfis autorizados a sugerir (DEMONSTRATIVO; configurável, nada fixo no código).
insert into configuracoes (chave, valor) values
  ('rede.perfis_sugerir_carona', '["Administrador","Despachante","Supervisor"]'::jsonb)
on conflict (chave) do nothing;

do $$ begin
  alter table configuracoes add constraint ck_config_rede_sugerir check (
    chave <> 'rede.perfis_sugerir_carona' or jsonb_typeof(valor) = 'array'
  );
exception when duplicate_object then null; end $$;

commit;
