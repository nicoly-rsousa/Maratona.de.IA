-- 0014: módulo da rede — acesso e sugestão de carona SOMENTE para o Administrador; sugestão simétrica.
-- Não altera perfis, permissões nem tabelas de outros módulos. Equipe de campo segue sem acesso (já fora da lista).
-- Valores DEMONSTRATIVOS e configuráveis: continuam em `configuracoes`, nada fixo no código.
begin;

-- Confere o nome EXATO do perfil no enum antes de gravá-lo na configuração.
do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'perfil_enum' and e.enumlabel = 'Administrador') then
    raise exception 'perfil_enum não contém "Administrador"';
  end if;
end $$;

insert into configuracoes (chave, valor) values
  ('rede.perfis_com_acesso', '["Administrador"]'::jsonb),
  ('rede.perfis_sugerir_carona', '["Administrador"]'::jsonb)
on conflict (chave) do update set valor = excluded.valor;

-- A→B e B→A são a mesma sugestão: unicidade sobre o par NÃO ordenado.
-- (Se houver sugestões inversas já gravadas, a criação do índice falha de propósito: resolva-as antes.)
alter table sugestoes_rede drop constraint if exists sugestoes_rede_os_origem_os_sugerida_key;
create unique index if not exists ux_sugestoes_rede_par
  on sugestoes_rede (least(os_origem, os_sugerida), greatest(os_origem, os_sugerida));

commit;
