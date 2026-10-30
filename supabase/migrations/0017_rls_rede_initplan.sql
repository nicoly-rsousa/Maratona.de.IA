-- 0017: otimiza as políticas de leitura da rede (RLS).
-- Problema (README, pendência a): perfil_ve_rede() era avaliada por linha nas tabelas grandes
-- (chaves, transformadores, traçado), ~20 s por perfil direto no PostgREST.
-- Correção: (select perfil_ve_rede()) vira um InitPlan, avaliado uma vez por consulta.
-- A regra de acesso NÃO muda: mesma função, mesma lista (rede.perfis_com_acesso), mesmo resultado.
-- Não altera dados, grants, funções nem a regra de perfil. A API (service_role) ignora RLS.
begin;

drop policy if exists circuitos_leitura on circuitos;
drop policy if exists chaves_leitura on rede_chaves;
drop policy if exists trafos_leitura on rede_transformadores;
drop policy if exists os_imp_leitura on os_importadas;
drop policy if exists tracado_leitura on rede_tracado;
drop policy if exists regional_leitura on regional;
drop policy if exists configuracoes_raio_leitura on public.configuracoes;

create policy circuitos_leitura on circuitos for select to authenticated using ((select perfil_ve_rede()));
create policy chaves_leitura on rede_chaves for select to authenticated using ((select perfil_ve_rede()));
create policy trafos_leitura on rede_transformadores for select to authenticated using ((select perfil_ve_rede()));
create policy os_imp_leitura on os_importadas for select to authenticated using ((select perfil_ve_rede()));
create policy tracado_leitura on rede_tracado for select to authenticated using ((select perfil_ve_rede()));
create policy regional_leitura on regional for select to authenticated using ((select perfil_ve_rede()));
create policy configuracoes_raio_leitura on public.configuracoes for select to authenticated
  using (chave in ('rede.raio_padrao_m', 'rede.raio_max_m', 'rede.mapa_prioridade_legada')
    and (select public.perfil_ve_rede()));

commit;
