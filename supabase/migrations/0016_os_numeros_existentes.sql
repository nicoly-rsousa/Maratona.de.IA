-- 0016: apoio à pré-visualização do cadastro de OS: quais números de origem já existem (sem filtros in.(...) frágeis na URL).
-- Só o service_role executa. Não altera migrações anteriores.
begin;

create or replace function os_numeros_origem_existentes(p_numeros text[])
returns table (numero_origem text)
language sql stable set search_path = public, pg_temp as $$
  select o.numero_origem from ordens_servico o where o.numero_origem = any (p_numeros);
$$;

revoke execute on function os_numeros_origem_existentes(text[]) from public, anon, authenticated;
grant execute on function os_numeros_origem_existentes(text[]) to service_role;

commit;
