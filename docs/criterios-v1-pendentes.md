# Farol — critérios do §4 que a v1 ainda não tem

Conferência de `docs/REGRADENEGOCIO.md` §4 contra a versão 1 carregada no banco (`npm run seed`, conteúdo em `packages/shared/src/demo.ts`). **Nada foi acrescentado nesta etapa**: completar os critérios é uma etapa própria (cada um traz pergunta no formulário, opções, pontos configuráveis e, em vários casos, um cadastro ou um dado calculado).

A v1 tem **8 critérios**: Risco à vida (`vida`), Serviço essencial (`essencial`), Fonte de reserva (`reserva`), Pessoas afetadas (`pessoas`), Estrutura (`estrutura`), Tipo de manutenção (`tipo`), Prazo-limite (`prazo`, automático) e Tempo de espera (`espera`, automático).

## Já cobertos (7 dos 19)

| §4 | Critério na v1 |
|---|---|
| Risco à vida e à segurança | `vida` |
| Serviço essencial | `essencial` |
| Fonte de reserva | `reserva` |
| Pessoas afetadas | `pessoas` |
| Tempo de espera (automático) | `espera` |
| Proximidade do prazo-limite (automático) | `prazo` |
| Tipo de manutenção | `tipo` |

## Faltam (12 dos 19)

| # | Critério do §4 | O que a etapa própria precisa trazer |
|---|---|---|
| 1 | UCs afetadas | opções por faixa de contagem; campo na solicitação |
| 2 | Extensão da interrupção | opções (ex.: trecho, ramal, alimentador); campo na solicitação |
| 3 | Duração estimada | opções por faixa de horas; campo na solicitação |
| 4 | Tipo de ocorrência | **opções = cadastro de tipos de ocorrência** (o cadastro ainda não existe; também alimenta as qualificações exigidas do despacho, §9) |
| 5 | Equipamento afetado | opções de tipo de equipamento; campo na solicitação |
| 6 | Abrangência geográfica | opções (ex.: ponto, rua, bairro, município); campo na solicitação |
| 7 | Circuito e conjunto afetados (nível da rede) | derivado de circuito/conjunto da OS (§12), não perguntado |
| 8 | UCs ligadas ao transformador | **contagem no cadastro** de UCs por transformador (cadastro ainda não existe); derivado, não perguntado |
| 9 | Redundância | opções (ex.: com rede alternativa, sem); campo na solicitação |
| 10 | Equipe especializada | opções; relaciona-se com `exigeQualificacao` da OS (despacho), mas ainda não pontua |
| 11 | Classe do cliente | **opções = cadastro de classes** (Poder público, Rural, Essencial, Residencial; §14.2); derivado da UC |
| 12 | Situação do cliente | rótulos configuráveis (§14.1); derivado da UC |

Também fora desta etapa: **critérios personalizados** cadastrados pelo administrador (nascem desabilitados e sem pontos, §4).

## Fora da lista do §4, mas na v1

`estrutura` (Estrutura: sem risco / risco de queda) vem do protótipo e sustenta a regra de precedência "Estrutura com risco de queda" (§1). Não consta do §4; decidir se vira "Equipamento afetado" ou permanece como critério próprio.

## Dependências que afetam a validação da Etapa E

- O alerta **"Essencial valendo menos que Residencial"** (§5) procura as opções "Essencial" e "Residencial" dentro de um mesmo critério. Só passa a disparar na prática quando existir o critério **Classe do cliente** (item 11). Está coberto por teste com uma versão sintética em `packages/shared/src/validate.test.ts`.
- ND01–ND07 do relatório continuam indefinidos: pesos, faixas, máximo e exigência de aprovação são **configuráveis** (`versoes_pontuacao`, `configuracoes`), nunca fixos.
