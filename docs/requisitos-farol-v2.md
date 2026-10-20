Farol v2 — Requisitos: alimentador, proximidade e mapa


0. Como usar este documento
Leia também REGRADENEGOCIO.md (regras já implementadas) e docs/dados/DICIONARIO-DADOS.md (o que foi descoberto nos dados).
Não altere a ordem da fila (cmp), as camadas A e B de prioridade, a imutabilidade de resultados_prioridade, os perfis nem a auditoria.
Alterações no banco devem ser migrações novas em supabase/, nunca edição de histórico.
1. Objetivo

Permitir que a equipe veja as OS da rede elétrica, identifique quais priorizar e encontre oportunidades de executar serviços próximos na mesma saída, mantendo a decisão final com o usuário.

2. Decisões já tomadas (valem para toda a implementação)
Proximidade nunca altera a fila. A prioridade continua vindo das camadas A e B. A proximidade só gera sugestão de "carona".
Nível de urgência = o que o Farol já calcula (res.cod, res.nivel). Não criar fórmula nova.
Alimentador = circuito. Na base de OS, o campo CodSetor corresponde ao CIRCUITO das bases de rede e de clientes.
Raio inicial de 1 km, ajustável pelo usuário. O limite máximo é parâmetro de administrador (valor inicial demonstrativo, a definir).
O raio de 300 m de duplicidade (seção 11 do REGRADENEGOCIO) é outro conceito. Mantenha os dois separados.
Dados pessoais de clientes não entram no sistema. Só agregados por circuito e por transformador.
Informação desconhecida não é risco zero (regra existente, seção 3 do REGRADENEGOCIO).
3. Requisitos funcionais
RF01 — Consulta de informações da rede
Consultar dados de rede por circuito: chaves, transformadores e clientes atendidos (agregados).
Fonte pública (ANEEL / BDGD): [A CONFIRMAR] disponibilidade, cobertura e atualização antes de qualquer integração. Não presumir que exista API pronta.
Registrar fonte e data de atualização de cada conjunto de dados (RN07).
RF02 — Priorização por alimentador
O alimentador é o primeiro critério de análise.
Ao selecionar um circuito: listar as OS dele na ordem da fila, com código de prioridade, motivo principal e posição.
Exibir os pontos potencialmente afetados (transformadores e chaves do circuito) e a quantidade de clientes.
Mostrar por que o serviço merece atenção, usando o resultado de prioridade já gravado.
RF03 — Busca por proximidade
O raio geográfico é o segundo critério, aplicado depois do alimentador.
Listar OS abertas de outros circuitos dentro do raio, ordenadas por distância e depois pela ordem da fila.
Distância em linha reta, sem rota nem tempo (igual ao mapa atual).
Botão "sugerir junto" apenas registra a sugestão (quem, quando, quais OS). Não designa equipe.
Excluir OS concluídas ou canceladas.
RF04 — Raio configurável
Padrão 1 km; o usuário aumenta ou diminui.
Ao mudar o raio, mapa e lista atualizam (com debounce de ~150 ms).
Permitir ampliar a busca quando a área inicial não tiver serviços.
RF05 — Mapa
Visão geral com todos os elementos disponíveis por padrão.
Mostrar as OS do circuito analisado e as próximas encontradas pelo raio, com diferenciação visual.
Exibir o alimentador (circuito) no mapa. Ao selecionar um circuito, desenhar seus transformadores e chaves, com a contagem de clientes, e destacar as OS dele. Contorno do circuito: envoltória convexa dos pontos (aproximada, rotulada como tal). Linhas reais do traçado só se existir geometria confiável (BDGD/ANEEL ou colunas LAT_1/LONG_1 da base de chaves) [A CONFIRMAR]; sem isso, não inventar traçado.
Não desenhar toda a rede de uma vez; carregar chaves e transformadores só do circuito selecionado.
Manter o fallback esquemático e o estado de zoom por cidade, como hoje.
RF06 — Filtros
Filtro por regional. A regional não existe nas bases: usar a tabela regional (município → regional), cadastrada por administrador.
Segundo filtro citado na reunião: [A CONFIRMAR] (nome ilegível na transcrição). Implementar como campo configurável, sem nome definitivo.
Filtros combinam com o mapa e não eliminam a visão geral da operação.
4. Regras de negócio
ID	Regra
RN01	A análise começa pelo alimentador relacionado ao serviço.
RN02	A proximidade geográfica é o segundo critério.
RN03	Serviços próximos podem ser sugeridos mesmo de outros alimentadores.
RN04	Raio inicial de 1 km, alterável pelo usuário.
RN05	A plataforma apoia a decisão; não impõe quais serviços executar juntos.
RN06	A priorização mostra informações que permitem entender urgência e impacto.
RN07	Informação externa tem origem identificável e disponibilidade verificada.
5. Requisitos de dados
Cada OS precisa de: circuito, lat, lng, municipio, origemGeo (informado, convertido de UTM, derivado ou desconhecido).
OS sem circuito conhecido ou sem coordenada: não descartar. Marcar como "desconhecido" e listar em relatório de qualidade.
Registrar fonte e data de cada importação.
Regras de importação, formatos e armadilhas: ver docs/dados/DICIONARIO-DADOS.md.
6. Modelo de dados sugerido (Supabase / Postgres + PostGIS)
Habilitar a extensão postgis.
os.geom como geography(Point, 4326) com índice GiST. A busca por raio usa ST_DWithin(geom, ponto, metros).
Tabelas: circuitos (código, bbox, clientes, ligados, classes), rede_chaves (circuito, tipo, geom), rede_transformadores (circuito, id, clientes, ligados, geom), regional (município, regional), sugestoes_carona (os_origem, os_sugerida, raio_m, usuario, criado_em).
Respeitar RLS e os perfis existentes. Sugestão de carona: Despachante e Supervisor.
7. Critérios de aceite
 Ao selecionar um circuito, aparecem as OS dele com urgência e motivo.
 A busca geográfica retorna OS de outros circuitos.
 A busca começa com raio de 1 km.
 Alterar o raio atualiza os resultados.
 O mapa mostra todos os elementos disponíveis por padrão.
 O filtro por regional funciona e combina com o mapa.
 A plataforma não designa equipe nem altera a ordem da fila pela proximidade.
 A origem e a data de cada dado são identificáveis.
 Busca por raio responde em menos de 100 ms com ~5 mil OS.
8. Pontos em aberto (não decidir por suposição)
Nome do segundo filtro.
Fontes públicas realmente utilizáveis e como ligar a OS ao alimentador oficial.
Limite máximo do raio.
Origem da regional (cadastro da operação).
Significado de Quantidade clientes com vírgula (ver dicionário).
Mapa da prioridade legada da OS para os 5 códigos do Farol (demonstrativo até validação).
9. Ordem de implementação
Migração do banco (PostGIS) e importação dos dados (com relatório de qualidade).
Mapa, filtro de regional e raio configurável.
Painel por alimentador.
Busca por proximidade e sugestão de carona.
Testes dos critérios de aceite e medição de desempenho.
Validação com a operação.