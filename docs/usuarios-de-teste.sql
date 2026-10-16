-- Farol — usuários de teste: um por perfil, com os vínculos de cidade (e de equipe, para a Equipe de campo).
-- Rode no SQL Editor DEPOIS de 0001, seed.sql, 0002, 0003 e 0004 (perfis.equipe_id nasce no 0004).
-- Idempotente: pode ser rodado de novo; atualiza o perfil e refaz os vínculos de cidade.
--
-- PASSO 1 — crie os usuários no painel (Authentication → Users → Add user → "Create new user"),
--           marcando "Auto Confirm User", com estes e-mails e uma senha de teste que SÓ você sabe.
--           (Não grave senhas neste arquivo nem em chat.)
--             atendente@farol.teste
--             despachante@farol.teste
--             supervisor@farol.teste
--             campo@farol.teste
--             chave@farol.teste
-- PASSO 2 — rode este script. Ele NÃO cria contas: procura cada e-mail em auth.users e falha com uma
--           mensagem clara se faltar algum.
-- Troque os e-mails abaixo se preferir outros.
--
-- Escopos de teste (demonstrativos):
--   Atendente      BH            nova solicitação + consulta
--   Despachante    BH            status, designar, cancelar   (testa 403 em CT e o bloqueio de exceção)
--   Supervisor     BH, CT + todas as cidades   exceção de despacho, reabrir (testa "Todas as cidades")
--   Equipe de campo BH, equipe BH-A   só vê as OS da BH-A e registra aceite/início/conclusão
--   Usuário Chave  BH, CT        consulta + pontuação (a tela de pontuação vem em etapa futura)

begin;

create temp table _teste (email text, nome text, perfil perfil_enum, todas boolean, equipe text, cidades text[]) on commit drop;
insert into _teste values
  ('atendente@farol.teste',   'Atendente Teste',    'Atendente',       false, null,   array['BH']),
  ('despachante@farol.teste', 'Despachante Teste',  'Despachante',     false, null,   array['BH']),
  ('supervisor@farol.teste',  'Supervisor Teste',   'Supervisor',      true,  null,   array['BH','CT']),
  ('campo@farol.teste',       'Equipe de Campo BH-A','Equipe de campo', false, 'BH-A', array['BH']),
  ('chave@farol.teste',       'Usuário Chave Teste','Usuário Chave',   false, null,   array['BH','CT']);

do $$
declare
  faltam text;
begin
  select string_agg(t.email, ', ') into faltam
    from _teste t where not exists (select 1 from auth.users u where u.email = t.email);
  if faltam is not null then
    raise exception 'Crie primeiro no painel (Authentication → Users) os e-mails: %', faltam;
  end if;
end $$;

-- perfis (upsert)
insert into perfis (user_id, nome, perfil, todas_cidades, equipe_id)
select u.id, t.nome, t.perfil, t.todas, t.equipe
  from _teste t join auth.users u on u.email = t.email
on conflict (user_id) do update
  set nome = excluded.nome, perfil = excluded.perfil, todas_cidades = excluded.todas_cidades, equipe_id = excluded.equipe_id;

-- vínculos de cidade: refaz só os dos usuários de teste
delete from usuario_cidades where user_id in (select u.id from _teste t join auth.users u on u.email = t.email);
insert into usuario_cidades (user_id, cidade_id)
select u.id, x.c
  from _teste t join auth.users u on u.email = t.email, unnest(t.cidades) as x(c);

-- conferência
select p.nome, p.perfil, p.todas_cidades, p.equipe_id,
       (select string_agg(uc.cidade_id, ',' order by uc.cidade_id) from usuario_cidades uc where uc.user_id = p.user_id) as cidades
  from perfis p join auth.users u on u.id = p.user_id
 where u.email in (select email from _teste)
 order by p.perfil;

commit;
