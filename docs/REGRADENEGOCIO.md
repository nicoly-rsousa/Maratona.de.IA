# Farol — Regras de negócio implementadas

> Todos os pontos, faixas, prazos e regras de precedência carregados na instalação são **demonstrativos e não oficiais**. Eles existem para o sistema funcionar de ponta a ponta até que a operação publique os valores reais (Usuário Chave) e os administradores cadastrem os códigos, prazos e regras validados.

## 1. Classificação em duas camadas

**Camada A — precedência e segurança** (`regras_precedencia`, editável só por administrador, com justificativa e versão). Cada regra é um E lógico de condições "critério ∈ opções" e define um **nível de precedência** (1–10) e uma **prioridade mínima**. Regras demonstrativas:

| Regra | Condição | Nível | Prioridade mínima |
|---|---|---|---|
| Risco iminente à vida | risco de choque, cabo energizado ou incêndio | 3 | Urgente |
| Serviço essencial sem reserva | hospital/emergência + interrupção (parcial, total ou desconhecida) + fonte de reserva não/desconhecida | 2 | Emergente |
| Estrutura com risco de queda | poste/estrutura com risco de queda | 1 | Alta |
| Preventiva com prazo iminente | preventiva + prazo-limite < 24 h ou vencido | 1 | Alta |

**Camada B — pontuação** (versão publicada pelo Usuário Chave): soma dos pontos por critério habilitado. Critérios de múltipla escolha agregam por **soma** (condições de segurança) ou **máximo** (classes do cliente). A pontuação cai numa **faixa** que define o código de prioridade.

**Resultado:** código = o mais urgente entre (faixa) e (prioridades mínimas das regras aplicadas). Cada cálculo grava um `resultados_prioridade` **imutável** com itens por critério, regras aplicadas, versão usada, motivo principal e motivo do cálculo.

## 2. Ordem da fila (por cidade)

1. Nível de precedência (maior primeiro)
2. Código de prioridade (mais urgente primeiro)
3. Em prioridade equivalente, **corretiva antes de preventiva**
4. Pontuação (maior primeiro)
5. Próximo prazo (mais próximo/vencido primeiro)
6. Abertura (mais antiga primeiro)
7. Número da OS (desempate final determinístico)

A preventiva com risco crítico ou prazo regulatório iminente sobe pela camada A, nunca por um número escondido. A posição é sempre calculada dentro da cidade da OS, inclusive na visão "Todas as cidades".

## 3. Informação desconhecida não é risco zero

Todo critério tem uma opção "Desconhecida / Não identificado / Não informada" com pontos explícitos (e, em geral, "requer confirmação"). Um fato não informado vira essa opção. "Sem pontos definidos" (nulo) é diferente de zero e **impede a publicação** da versão.

## 4. Critérios fixos da versão 1

Risco à vida e à segurança · Serviço essencial · Fonte de reserva · Pessoas afetadas · UCs afetadas · Extensão da interrupção · Duração estimada · Tipo de ocorrência (opções = cadastro de tipos) · Equipamento afetado · Abrangência geográfica · Circuito e conjunto afetados (nível da rede) · UCs ligadas ao transformador (contagem no cadastro) · Tempo de espera (automático) · Proximidade do prazo-limite (automático) · Tipo de manutenção · Redundância · Equipe especializada · Classe do cliente (opções = cadastro de classes) · Situação do cliente. Administradores podem cadastrar **critérios personalizados**, que nascem desabilitados e sem pontos até o Usuário Chave defini-los.

## 5. Versões de pontuação (Usuário Chave)

- Um rascunho por escopo (global ou cidade); gravação concorrente com token (`etag`) antigo → 409. Descartar o rascunho é possível; restaurar uma versão com rascunho aberto é recusado (409).
- Publicação exige justificativa, início de vigência e escolha explícita (sem valor padrão): **somente novas OS** ou **reclassificar as OS abertas**. Opcionalmente exige aprovação de um segundo usuário (`pontuacao.exigir_aprovacao` na tabela `configuracoes`; padrão desligado): a versão fica "aguardando aprovação" e **quem a enviou não pode aprová-la**. Havendo uma versão aguardando aprovação no escopo, outra não é publicada.
- Versão publicada nunca é editada; restaurar uma versão cria um novo rascunho (com o número seguinte do escopo).
- Versão da cidade prevalece sobre a global naquela cidade. A numeração é por escopo. O escopo global só é editado por quem acessa todas as cidades; o de cidade, por quem tem a cidade no escopo (fora dele: 403 + auditoria).
- Cada OS fica vinculada à versão com que foi calculada (`ordens_servico.versao_pontuacao_id`); todo recálculo (tempo, nova solicitação) usa a versão da própria OS. Uma nova versão só a alcança se publicada com "reclassificar abertas" e já em vigência; entre várias, vale a mais nova que reclassifica. A migração grava um novo resultado ("Nova versão vN") e atualiza o vínculo; o resultado anterior permanece no histórico. Versões "somente novas OS" valem só para OS abertas depois.
- Validações: inteiros ≥ 0 e ≤ máximo (`pontuacao.max_pontos` em `configuracoes`, padrão 100); faixas sem lacunas nem sobreposições, de 0 até "sem limite" (o banco revalida esses erros ao publicar); alertas (não bloqueantes) de incoerência — Essencial valendo menos que Residencial, "desconhecida" valendo 0 sem "requer confirmação", critério sem opção "desconhecida".

## 6. Prazos

Cinco prazos distintos por código: triagem, despacho, início do atendimento, restabelecimento (opcional) e conclusão, contados da abertura. Calendário **corrido** (minutos) ou **útil** (seg–sex, 08h–18h no fuso `America/Sao_Paulo`, sem feriados cadastrados). O "prazo corrente" depende do status: triagem (Aberta/Em triagem) → despacho (Aguardando despacho/Suspensa) → início (Equipe designada/a caminho) → conclusão (Em execução/Aguardando recurso).

## 7. Reclassificação automática

A cada 60 s: aplica versões cuja vigência chegou (quando "reclassificar abertas", §5) e recalcula critérios dependentes do tempo **com a versão em que a OS está**; grava novo resultado e histórico **somente se** código, pontos ou precedência mudarem (a migração de versão sempre grava). Também reclassificam: atualização de fatos, nova solicitação vinculada, unificação, troca de município e revisão manual (justificativa obrigatória; o cálculo fica registrado ao lado).

## 8. Cidades

Toda solicitação e OS tem município obrigatório; toda consulta é filtrada no servidor pelos vínculos do usuário; acesso fora do escopo → 403 + auditoria. "Todas as cidades" só com a permissão `cidades.todas` (Supervisor, Administrador). Numeração `{PREFIXO}-{ANO}-{SEQ}` gerada no banco por contador por cidade/ano, com índice único. Município com OS não é excluído, só inativado. Troca de município: permissão própria, justificativa, auditoria e reclassificação com a versão da nova cidade.

## 9. Despacho

- Recomendação: **compatibilidade** (qualificações exigidas pelo tipo de ocorrência + "equipe especializada" quando marcada + recursos pedidos) e **disponibilidade** antes da distância. Distância e tempo vêm do serviço de rotas quando configurado; sem ele, só distância em linha reta, rotulada como tal, sem tempo estimado.
- Equipes do município da OS (base ou adicionais autorizados) por padrão; de outras cidades apenas como **apoio intermunicipal**, com justificativa.
- Incompatível ou indisponível: só com **exceção autorizada** (`despacho.excecao`) e justificativa. A **capacidade** da equipe nunca é ultrapassada.
- Um despacho ativo por OS (índice único parcial). OS e equipe são bloqueadas na transação; a segunda designação simultânea recebe 409 e nada é gravado.
- Na designação a equipe recebe coordenadas (copiar, link de mapa, `geo:`), endereço, CEP, UCs, circuito, conjunto e transformador; sem coordenadas, aviso de localização aproximada.
- Ciclo: designada → aceite (a caminho) → início (em execução) → conclusão; remoção da equipe preserva o despacho anterior e devolve a OS à fila.

## 10. Status da OS

Transições manuais permitidas: Aberta → Em triagem/Aguardando despacho/Cancelada; Em triagem → Aguardando despacho/Cancelada; Aguardando despacho → Suspensa/Cancelada/Em triagem; Suspensa → Aguardando despacho/Cancelada; Em execução ⇄ Aguardando recurso; Concluída → Aguardando despacho (**reabertura**, só Supervisor, justificada). Cancelamento exige motivo. Transições do despacho seguem o ciclo acima. O backend recusa qualquer outra (409).

## 11. Duplicidade

Sugestão (nunca automática) para OS abertas da mesma cidade nas últimas 24 h com: distância ≤ 300 m, mesmo transformador, mesma UC, ou mesmo conjunto + mesmo tipo. Mesma rua sozinha não basta. O atendente pode vincular a nova solicitação a uma OS existente; o supervisor pode unificar duas OS (a duplicada é cancelada como "Unificada em …", as solicitações migram, fatos são mesclados — faixas de impacto ficam com a maior, desconhecidos são completados — e a principal é reclassificada).

## 12. Dados de localização e rede

- Transformador sempre como **texto**: 3 primeiros dígitos = localidade, restante = número local; mínimo 4 dígitos, máximo configurável; localidade não cadastrada é aceita com alerta.
- Circuito/conjunto: o conjunto precisa pertencer ao circuito. A origem é derivada no servidor: não informado, informado, identificado pelo cadastro (a confirmar) ou confirmado.
- Coordenadas: graus decimais, link de mapa ou graus/minutos/segundos; intervalo validado; alerta (não bloqueio) fora do Brasil ou fora do raio do município; origem, precisão e instante registrados.
- UC: formato configurável; não validada quando fora do cadastro; consulta auditada e nome mascarado (LGPD); "não sabe a UC" exige motivo e algum meio de localização.

## 13. Perfis

| Perfil | Principais permissões |
|---|---|
| Administrador | todas |
| Atendente | registrar solicitações, consultar OS |
| Despachante | consultar, alterar status, atualizar fatos, designar equipes, cancelar |
| Supervisor | despachante + revisar prioridade, trocar município, unificar, reabrir, exceção de despacho, todas as cidades, auditoria, aprovar pontuação |
| Equipe de campo | consultar e registrar aceite/início/conclusão das próprias OS |
| Usuário Chave | editar, publicar e aprovar pontuação; consultar. Não vê a precedência (camada A) nem o despacho |

## 14. Premissas a confirmar com a operação (seção 0.2)

1. "Situação do cliente" = situação da UC no registro (rótulos configuráveis em `Farol:Rotulos`).
2. Classes iniciais: Poder público, Rural, Essencial, Residencial; Comercial e Industrial foram cadastradas para acomodar a base fictícia.
3. Formatos não informados (UC, tamanho do transformador) são configuráveis: UC `^\d{6,10}$`, transformador até 12 dígitos.
4. Pontos, faixas, prazos e regras: demonstrativos até a publicação/validação oficial.
5. Situação "desligado" vale menos que "ligado" na pontuação demonstrativa — a operação deve decidir o sentido real deste critério.
6. Calendário útil (08h–18h, seg–sex) e feriados nacionais fixos; feriados móveis e municipais devem ser cadastrados.
7. Nova OS nasce "Aguardando despacho", ou "Em triagem" quando falta localização.
15. Alimentadores, proximidade e mapa (v2 — planejado)

Seção nova. Não altera as seções 1 a 14. Numere a partir da próxima seção livre do arquivo. Valores e limites aqui são demonstrativos e não oficiais até a operação validar. Itens [A CONFIRMAR] não são decisão.

15.1 Alimentador da OS
O alimentador da OS é o circuito. Na importação, vem do campo CodSetor da OS.
Origem do circuito registrada em cada OS: importado, não identificado (código que não existe nas bases) ou informado/confirmado pela operação.
Código que não casa com a rede (ex.: CET-LUM 2) não é corrigido automaticamente: a OS fica com circuito "não identificado" e entra no relatório de qualidade.
Correção manual do circuito por Supervisor, com justificativa e registro em auditoria [A CONFIRMAR].
Esta regra complementa a seção 12 (circuito/conjunto) e não a substitui: o conjunto continua precisando pertencer ao circuito.
15.2 Alimentador no mapa
Selecionar um circuito mostra: suas OS (na ordem da fila), seus transformadores e chaves, e a contagem de clientes (total, ligados, desligados).
O contorno do circuito é aproximado (envoltória dos pontos) e deve ser rotulado assim. Traçado real só com geometria confiável [A CONFIRMAR].
Dados de clientes mostrados são agregados; nenhum dado pessoal é exibido.
Informação ausente (circuito sem clientes, transformador sem coordenada) aparece como "desconhecido", nunca como zero (seção 3).
Elementos são carregados por circuito, sob demanda; o mapa não desenha toda a rede de uma vez.
15.3 Carona (serviços próximos)
Critério: depois de analisar o alimentador, listar OS abertas de outros circuitos dentro do raio.
Raio inicial 1 km, ajustável pelo usuário até um limite máximo configurável por administrador (valor inicial demonstrativo [A CONFIRMAR]).
Distância em linha reta, sem rota nem tempo.
Ordenação da lista: distância; em empate, a ordem da fila (seção 2).
A proximidade nunca altera a prioridade, a pontuação nem a posição na fila. Ela só gera sugestão.
"Sugerir junto" apenas registra a sugestão (quem, quando, OS de origem, OS sugerida, raio usado). Não designa equipe nem muda o status. A decisão de despacho continua com o usuário.
OS concluídas ou canceladas não entram. OS sem coordenada não participam da busca, mas são sinalizadas (não somem da lista do circuito).
OS marcada como fora do retângulo do seu circuito exibe alerta de localização duvidosa; não é bloqueada (mesmo princípio da seção 12).
15.4 Filtros
Filtro por regional, a partir da tabela regional (município → regional), cadastrada por administrador.
Regional vazia = filtro "não configurado"; as OS continuam visíveis. Filtrar nunca remove a visão geral da operação.
Segundo filtro citado na reunião: [A CONFIRMAR].
15.5 Relação com a duplicidade (seção 11)
Raio de 300 m (duplicidade) e raio de 1 km (carona) são independentes. Duplicidade sugere unificar a mesma ocorrência; carona sugere executar serviços diferentes na mesma saída.
Uma OS sugerida como carona não é candidata a unificação por esse motivo.
15.6 Perfis (acrescenta à seção 13)
Neste módulo (mapa da rede, busca por proximidade e sugestão de carona) só o Administrador acessa e sugere. Decisão vigente nesta fase; substitui a tabela anterior (que liberava Despachante, Supervisor e Atendente).
Perfil	Permissão no módulo da rede
Administrador	único perfil com acesso: consultar a rede, buscar por proximidade e registrar sugestão de carona; configurar raio máximo e cadastrar regional
Equipe de campo	sem acesso: 403 em todas as rotas da rede
Supervisor, Despachante, Atendente, Usuário Chave	sem acesso nesta fase: negados por não constarem na lista (403)
A regra é configuração, não código: rede.perfis_com_acesso (quem acessa a rede) e rede.perfis_sugerir_carona (quem registra sugestão), ambas hoje só com o Administrador. Ampliar o acesso no futuro é mudar a configuração, sem alterar a API.
A API aplica a regra em cada rota (ela usa service_role e ignora a RLS) e lê a configuração a cada requisição, sem cache. Se a configuração estiver ausente, ilegível ou falhar a leitura, o acesso é NEGADO. A negação é registrada na auditoria. A RLS do banco aplica a mesma lista como defesa em profundidade.
Esta seção não altera os perfis nem as permissões dos demais módulos (fila, despacho, pontuação, precedência, mapa de OS).
Sugestão simétrica: A→B e B→A são a mesma sugestão (par não ordenado); o par só pode ser registrado uma vez.
15.7 Origem e rastreabilidade dos dados
Toda base importada registra fonte, arquivo e data da importação.
Cada OS guarda a origem da coordenada (origem_geo): convertida de UTM, informada ou desconhecida.
Dados públicos externos (ANEEL/BDGD) só entram depois de verificar disponibilidade, cobertura e data de atualização.
15.8 Premissas a confirmar com a operação
Nome e função do segundo filtro.
Limite máximo do raio de carona.
Quem pode corrigir o circuito de uma OS.
Traçado real do alimentador: existe geometria utilizável?
Origem oficial da regional.
Permissões de Atendente e Equipe de campo na carona.
Mapa da prioridade legada da OS para os códigos do Farol (demonstrativo).
15.9 Cadastro de OS no formato "OS manutenção pendente" (importação por arquivo CSV)
Formato: a planilha "OS manutenção pendente" exportada como CSV (UTF-8 ou Windows-1252; separador ponto e vírgula, vírgula ou tab). As colunas são lidas pelo NOME, sem acento e sem caixa; se um cabeçalho se repetir, vale a primeira ocorrência. Só 15 colunas são usadas (OSNumero, CodSetor, CodPrioridade, DataDeadline, Quantidade clientes, Localidade, Logradouro, Bairro, Complemento de Localização, COORDENADA UTM X e Y, latitude e longitude SIRGAS 2000, DescEsquema, Familias); as demais nunca saem do navegador.
Quem importa: somente o Administrador (a importação cria cidades). A API aplica a regra; negado = 403 com auditoria.
Obrigatórios: apenas o número da OS (OSNumero, guardado em numero_origem) e o município (extraído da Localidade, sem o código final "NN-NN"). Linha sem um dos dois, ou com número repetido no arquivo, é rejeitada e vai para um arquivo de rejeitadas (só número da linha, motivo e colunas permitidas; sem endereço, bairro nem complemento).
Vazio: célula vazia ou só com espaços vira NULL (desconhecido), nunca zero nem texto de preenchimento. Uma lista de textos nulos ("N/A", "-") é configurável (importacao.textos_nulos) e vem desligada.
Valor presente e inválido em campo opcional (texto em clientes, data impossível, coordenada fora da região, UTM com só X ou só Y): a linha entra com AVISO e o campo fica nulo. Nada é corrigido em silêncio.
Coordenadas: latitude/longitude se existirem e forem válidas; senão a UTM (SIRGAS 2000 zona 23S), que exige X e Y juntos. Sem coordenada a OS entra "Em triagem", fora do mapa e da busca por raio, mas visível em lista.
Endereço: a coluna continua NOT NULL. Vazio vira "Poste <código> — <município>" (código vindo do Complemento de Localização, só se casar com o padrão configurável importacao.padrao_poste; texto livre NUNCA é copiado) ou "Endereço não informado — <município>". A origem fica em origem_endereco (informado, derivado_poste, nao_informado).
Cidades: cada município vira uma cidade do Farol (código de 2 a 5 letras gerado sem colisão; cidades.municipio_origem guarda a origem, então reimportar não duplica).
Número: a OS mantém o número gerado pelo Farol e guarda o OSNumero em numero_origem (único). Reimportar o mesmo número não cria outra OS nem altera a existente.
Prioridade: calculada pelas regras do Farol (camadas A e B), na fila do Farol. A planilha não traz as respostas dos critérios, então cada critério de risco sem resposta vale a opção "Desconhecido" da versão (que pontua; nunca zero). A prioridade legada (CodPrioridade), a quantidade de clientes e o prazo (DataDeadline, em prazo_origem) são só informativos: o prazo NÃO vira prazo-limite do Farol, e o fato "prazo" é omitido (não afirma "Sem prazo"), inclusive na reclassificação automática.
Duplicidade (seção 11): não roda neste formato; a identidade da OS é o numero_origem.
Gravação: em lotes de até importacao.tamanho_lote (200), cada lote atômico e idempotente. Falha em um lote não grava nada dele e o lote pode ser reenviado.
