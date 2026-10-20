-- 0013: a leitura direta de `regional` passa a seguir a mesma regra de perfil da rede (0009/0010).
-- Antes (0008): regional_leitura using (true) deixava qualquer usuário autenticado, inclusive Equipe de campo, ler o mapeamento.
-- O front só fala com a API; a API usa service_role. As funções de rede (SECURITY INVOKER) continuam lendo `regional`
-- para os perfis em rede.perfis_com_acesso.
begin;
drop policy if exists regional_leitura on regional;
create policy regional_leitura on regional for select to authenticated using (perfil_ve_rede());
commit;
