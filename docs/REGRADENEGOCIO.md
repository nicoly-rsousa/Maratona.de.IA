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

- Um rascunho por escopo (global ou cidade); gravação concorrente com token antigo → 409.
- Publicação exige justificativa, início de vigência e escolha explícita: **somente novas OS** ou **reclassificar as OS abertas**. Opcionalmente exige aprovação de um segundo usuário (`Farol:Pontuacao:ExigirAprovacao`).
- Versão publicada nunca é editada; restaurar uma versão cria um novo rascunho.
- Versão da cidade prevalece sobre a global naquela cidade.
- Cada OS fica vinculada à versão com que foi calculada; uma nova versão só a alcança se publicada com "reclassificar abertas", e o resultado anterior permanece no histórico.
- Validações: inteiros ≥ 0 e ≤ máximo configurável; faixas sem lacunas nem sobreposições, de 0 até "sem limite"; alertas (não bloqueantes) de incoerência — p.ex. Essencial valendo menos que Residencial, "desconhecida" valendo 0 sem "requer confirmação".

## 6. Prazos

Cinco prazos distintos por código: triagem, despacho, início do atendimento, restabelecimento (opcional) e conclusão, contados da abertura. Calendário **corrido** (minutos) ou **útil** (seg–sex, 08h–18h no fuso `America/Sao_Paulo`, sem feriados cadastrados). O "prazo corrente" depende do status: triagem (Aberta/Em triagem) → despacho (Aguardando despacho/Suspensa) → início (Equipe designada/a caminho) → conclusão (Em execução/Aguardando recurso).

## 7. Reclassificação automática

A cada 60 s: aplica versões cuja vigência chegou (quando "reclassificar abertas") e recalcula critérios dependentes do tempo; grava novo resultado e histórico **somente se** código, pontos ou precedência mudarem. Também reclassificam: atualização de fatos, nova solicitação vinculada, unificação, troca de município e revisão manual (justificativa obrigatória; o cálculo fica registrado ao lado).

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
| Usuário Chave | editar, publicar e aprovar pontuação; consultar |

## 14. Premissas a confirmar com a operação (seção 0.2)

1. "Situação do cliente" = situação da UC no registro (rótulos configuráveis em `Farol:Rotulos`).
2. Classes iniciais: Poder público, Rural, Essencial, Residencial; Comercial e Industrial foram cadastradas para acomodar a base fictícia.
3. Formatos não informados (UC, tamanho do transformador) são configuráveis: UC `^\d{6,10}$`, transformador até 12 dígitos.
4. Pontos, faixas, prazos e regras: demonstrativos até a publicação/validação oficial.
5. Situação "desligado" vale menos que "ligado" na pontuação demonstrativa — a operação deve decidir o sentido real deste critério.
6. Calendário útil (08h–18h, seg–sex) e feriados nacionais fixos; feriados móveis e municipais devem ser cadastrados.
7. Nova OS nasce "Aguardando despacho", ou "Em triagem" quando falta localização.
