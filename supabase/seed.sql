-- Dados demonstrativos (NÃO OFICIAIS)
insert into cidades (id, nome, lat, lng) values
  ('BH','Belo Horizonte',-19.9167,-43.9345),
  ('CT','Contagem',-19.9319,-44.0539)
on conflict do nothing;

insert into equipes (id, cidade_id, capacidade, qualificacoes) values
  ('BH-A','BH',2,'{"Linha viva"}'), ('BH-B','BH',1,'{}'),
  ('CT-A','CT',1,'{"Linha viva"}'), ('CT-B','CT',2,'{}')
on conflict do nothing;

insert into regras_precedencia (id, nome, cond, nivel, prioridade_minima) values
 ('R-VIDA','Risco iminente à vida','[{"criterio":"vida","opcoes":["Cabo energizado / choque"]}]',3,1),
 ('R-ESS','Serviço essencial sem reserva','[{"criterio":"essencial","opcoes":["Hospital / emergência"]},{"criterio":"reserva","opcoes":["Não","Desconhecida"]}]',2,0),
 ('R-EST','Estrutura com risco de queda','[{"criterio":"estrutura","opcoes":["Risco de queda"]}]',1,2),
 ('R-PREV','Preventiva com prazo iminente','[{"criterio":"tipo","opcoes":["Preventiva"]},{"criterio":"prazo","opcoes":["< 24 h ou vencido"]}]',1,2)
on conflict do nothing;
-- A versão de pontuação v1 (VERSAO_DEMO) é inserida pela API:  npm run seed -w @farol/api
