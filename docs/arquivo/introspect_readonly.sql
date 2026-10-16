-- Farol — introspecção SOMENTE LEITURA do banco real (Fase 1).
-- Rode no SQL Editor do Supabase (projeto ndiedxeupbswmqexoypw) e cole os resultados no chat.
-- Cada bloco retorna uma única coluna JSON; nada aqui altera dados ou schema.

-- 1) Tabelas e colunas
select jsonb_agg(jsonb_build_object('tabela', c.table_name, 'coluna', c.column_name, 'tipo', c.data_type,
  'udt', c.udt_name, 'nulo', c.is_nullable, 'default', c.column_default) order by c.table_name, c.ordinal_position) as colunas
from information_schema.columns c where c.table_schema = 'public';

-- 2) Constraints (PK, FK, UNIQUE, CHECK)
select jsonb_agg(jsonb_build_object('tabela', conrelid::regclass::text, 'nome', conname, 'def', pg_get_constraintdef(oid))) as constraints
from pg_constraint where connamespace = 'public'::regnamespace;

-- 3) Índices
select jsonb_agg(jsonb_build_object('tabela', tablename, 'nome', indexname, 'def', indexdef)) as indices
from pg_indexes where schemaname = 'public';

-- 4) Enums
select jsonb_agg(jsonb_build_object('enum', t.typname, 'valores', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))) as enums
from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e';

-- 5) RLS ligado/desligado por tabela + policies
select jsonb_agg(jsonb_build_object('tabela', c.relname, 'rls', c.relrowsecurity, 'rls_force', c.relforcerowsecurity)) as rls_tabelas
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p');

select jsonb_agg(jsonb_build_object('tabela', tablename, 'policy', policyname, 'cmd', cmd, 'roles', roles,
  'using', qual, 'check', with_check)) as policies
from pg_policies where schemaname = 'public';

-- 6) Grants para anon/authenticated (aponta escrita perigosa)
select jsonb_agg(jsonb_build_object('tabela', table_name, 'role', grantee, 'privilegio', privilege_type)) as grants_tabelas
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated','public');

select jsonb_agg(jsonb_build_object('funcao', routine_name, 'role', grantee, 'privilegio', privilege_type)) as grants_funcoes
from information_schema.routine_privileges
where routine_schema = 'public' and grantee in ('anon','authenticated','public');

-- 7) Funções (inclui autorizar_api_farol), com definição completa, SECURITY DEFINER e config
select jsonb_agg(jsonb_build_object('funcao', p.proname, 'args', pg_get_function_arguments(p.oid),
  'security_definer', p.prosecdef, 'config', p.proconfig, 'def', pg_get_functiondef(p.oid))) as funcoes
from pg_proc p where p.pronamespace = 'public'::regnamespace;

-- 8) Triggers
select jsonb_agg(jsonb_build_object('tabela', event_object_table, 'trigger', trigger_name, 'evento', event_manipulation,
  'quando', action_timing, 'acao', action_statement)) as triggers
from information_schema.triggers where trigger_schema = 'public';

-- 9) Views
select jsonb_agg(jsonb_build_object('view', viewname, 'def', definition)) as views
from pg_views where schemaname = 'public';

-- 10) Migrations aplicadas (se usar Supabase CLI)
select jsonb_agg(to_jsonb(m)) as migrations from supabase_migrations.schema_migrations m;

-- 11) Contagem de linhas por tabela (exata)
select jsonb_object_agg(table_name,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::bigint
) as contagens
from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';
