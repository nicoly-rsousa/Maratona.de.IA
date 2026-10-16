# Farol — roteiro de demonstração (8 a 10 minutos)

> **Tudo o que aparece nesta demonstração é DEMONSTRATIVO.** Pesos, faixas, regras de precedência, prazos e o máximo de pontos são valores de partida **não oficiais**: ND01–ND03 do relatório seguem indefinidos e, por desenho, **nada disso está no código** — vive no banco e é publicado pelo Usuário Chave. A mensagem é "o sistema funciona de ponta a ponta e a operação define os números", nunca "estes são os pesos certos". Diga isso logo na abertura.

## Antes de começar (15 min antes, não na frente do público)

| Item | Como conferir |
|---|---|
| Banco com `0001` → `seed.sql` → `0002` → `0003` → `0004` → `0005` | roteiros em `docs/teste-*.md` |
| Dados: `npm run seed`, `npm run seed:os`, **`npm run seed:cr`** | o último imprime as 9 OS "CR-0X …" |
| Usuários de `docs/usuarios-de-teste.sql` + **um Administrador** (o seu) | login de cada um funciona |
| **API acordada**: abra `https://SUA-API/health` | no Render o plano gratuito dorme; a primeira chamada leva ~1 min |
| Dois navegadores (ou um normal + um anônimo) já logados | despachante em um, supervisor no outro |
| `seed:cr` rodado **no mesmo dia** | a duplicidade (passo 3) olha as últimas 24 h de abertura |
| Banco de ensaio, não o de produção | o passo 6 publica uma versão de pontuação, que **não se apaga** |

Tempo médio por passo entre parênteses. Os números exatos de pontos mudam com o passar do tempo (a espera soma pontos); **a ordem entre os cenários não muda**.

---

## 1. A fila e o "por que esta prioridade" (2 min) — **Atendente**

Entre como `atendente@farol.teste` → **Fila** (BH). Procure as OS que começam com **CR-** (cenários de referência do relatório, seção 12). Abra cada uma → aba **Prioridade**.

- **CR-01** — compare *CR-01 A (cruzeta, 30 clientes, serviço essencial desconhecido)* com *CR-01 B (cruzeta, hospital e 2.000 clientes)*.
  - **Dizer:** "A B foi aberta depois, mas passa à frente. Aqui está o porquê: regra de precedência *Serviço essencial sem reserva* (nível 2), e os pontos: hospital 30 + sem reserva 20 + mais de 100 pessoas 25. Já na A o serviço essencial é *desconhecido*: não é zero, soma 10 pontos (25 no total, faixa Alta) e a OS pede confirmação, mas sem hospital confirmado a regra não se aplica."
- **CR-02** — *CR-02 A (cruzeta que afeta hospital)* × *CR-02 B (pouca circulação, aberta há ~5 h)*.
  - **Dizer:** "A reserva do hospital era *desconhecida*. Informação desconhecida **não é risco zero**: soma pontos e pede confirmação. A de pouca circulação espera, mesmo sendo bem mais antiga: precedência vem antes de antiguidade."
- **CR-03** — *CR-03 A (preventiva programada, prazo em 10 dias)*, *CR-03 B (corretiva comum)*, *CR-03 C (preventiva com prazo em 10 h)*.
  - **Dizer:** "Com o prazo longe, a programada não passa a corretiva: em prioridade equivalente, corretiva primeiro. A C tem o prazo iminente: a regra *Preventiva com prazo iminente* a antecipa. Não é um número escondido: aparece em 'Regras de precedência aplicadas'."
- **CR-04** — *CR-04 A (risco de queda)* × *CR-04 B (150 clientes)*: a A vem primeiro pela regra *Estrutura com risco de queda*. A disputa pela equipe fica para o passo 4.

**O que pode dar errado:** a fila mostra também as 11 OS do protótipo, então a *posição* absoluta varia; compare a ordem **entre** as OS CR. Se a lista estiver vazia, falta `seed:cr` (ou a API está dormindo: recarregue). **Plano B:** mostrar o resultado dos mesmos cenários nos testes (`npm test`, arquivo `cenarios.test.ts`): cada decisão está explicada em asserções.

## 2. Nova OS com duplicidade sugerida (1,5 min) — **Atendente**

**Nova solicitação** → município BH → endereço qualquer → **UC `2010002`** (a do hospital da CR-01 B) → aparece **"Possível duplicidade (sugestão, nunca automática)"** com a CR-01 B e o motivo "mesma UC".

- **Dizer:** "O sistema só sugere; quem decide é o atendente. Mesma rua sozinha não basta. Posso vincular à OS existente (nenhuma OS nova nasce e ela é reclassificada) ou confirmar que não é duplicada."
- Clique em **Vincular a esta OS**. Mostre "Nenhuma OS nova foi criada".
- Extra (20 s): **Escolher o ponto no mapa** → clique → latitude/longitude preenchidas, círculo de 300 m.

**Pode dar errado:** sem sugestão = a CR-01 B foi aberta há mais de 24 h (rode o seed no dia) ou a UC foi digitada errada. **Plano B:** registre uma OS com UC `3999001` e, em seguida, outra com a mesma UC.

## 3. Designar equipe e o 409 (1,5 min) — **Despachante** (e **Equipe de campo**)

Entre como `despachante@farol.teste` → OS **CR-04 A** → aba **Despacho**.

- Recomendação: compatibilidade e disponibilidade **antes** da distância; distância só em linha reta, rotulada, sem tempo estimado. Designe a **BH-B** (capacidade 1).
- Abra **CR-04 B** → designe também a **BH-B** → **409 "Capacidade esgotada: BH-B já está com 1/1"**.
  - **Dizer:** "A capacidade nunca é ultrapassada, nem com exceção. A segunda ocorrência permanece na fila e vai para outra equipe, ou espera."
- Concorrência de verdade (30 s, opcional): no outro navegador, **supervisor** tenta designar a *mesma* OS a outra equipe ao mesmo tempo → um 201 e um 409 `despacho_ativo`. Se não quiser depender de timing, use o PowerShell de `docs/teste-concorrencia.md` (seção C).
- **Equipe de campo** (`campo@farol.teste`, equipe BH-A): antes, como despachante, designe outra OS (ex.: *CR-03 B*) à **BH-A**. O campo só vê as OS da própria equipe e registra aceite → início → conclusão (deixe uma OS concluída para o passo 7).

**Pode dar errado:** a BH-B já pode estar cheia por testes anteriores (o 409 vem no primeiro clique: ainda serve de demonstração). Para limpar: `remover_equipe` no SQL Editor (ver `docs/teste-concorrencia.md`). **Plano B:** mostrar `docs/teste-concorrencia.md` e `despacho.test.ts`.

## 4. O mapa e o raio de 300 m (1 min) — **Supervisor**

`supervisor@farol.teste` → **Mapa**. Cor = prioridade (as mesmas das pílulas). Selecione **CR-01 B** na lista (funciona só com teclado) → círculo de **300 m** (o mesmo raio da duplicidade), distância **em linha reta** até cada equipe, "Outras OS dentro de 300 m". Desmarque **Mostrar equipes**. Troque para **Todas as cidades** (só o supervisor).

- **Dizer:** "Distância em linha reta, sem rota nem tempo: não prometemos o que não calculamos. OS sem coordenadas ficam na lista com aviso de *localização aproximada* e entram *Em triagem*."

**Pode dar errado:** tiles do OpenStreetMap lentos ou sem internet (o mapa fica cinza, mas a lista e as distâncias seguem). **Plano B:** a lista "OS no mapa" e o painel de distâncias bastam para a fala.

## 5. Precedência (30 s) — **Supervisor** ou **Administrador**

**Precedência**: as regras da camada A. O Supervisor vê em **somente leitura**; o **Administrador** edita.

Como Administrador: mude o **nível** de "Estrutura com risco de queda" de 1 para 4 → **Pré-visualizar** (tabela de impacto: quantas OS abertas mudam de código ou nível, antes e depois) → **Confirmar** → justificativa → aparece a **v2** na lista de versões. Em até 1 minuto a OS com risco de queda sobe na fila, com o motivo "Regras v2: <justificativa>" no histórico.

- **Dizer:** "Estas regras garantem prioridade mínima e nível. Só o administrador altera, sempre com justificativa, e cada alteração é uma versão nova: a anterior nunca é editada. Antes de confirmar, vemos o impacto nas OS abertas. O Usuário Chave e a Equipe de campo **não** veem esta tela."

## 6. Publicar uma versão de pontuação reclassificando as abertas (2 min) — **Usuário Chave**

`chave@farol.teste` → **Pontuação** (escopo BH).

1. Mude **Pessoas afetadas → "11–100"** de 10 para **30** pontos. Deixe um campo vazio de propósito → **Validar**: erro em vermelho "sem pontos definidos" (nulo ≠ zero). Corrija e valide de novo: alertas em amarelo, separados.
2. **Salvar rascunho**. Preencha a justificativa e o início da vigência (agora), escolha o modo **"Reclassificar as OS abertas"** (a escolha é explícita: não há valor padrão) → **Publicar nova versão**.
3. Volte para a **Fila** e espere até 60 s (a rotina recalcula) — ou rode `npm run job:reclassificar -w @farol/api`. Abra a **CR-01 A**: pontos subiram, e em **Histórico** há um resultado novo com motivo **"Nova versão v2"**; o anterior continua lá.
   - **Dizer:** "Cada OS fica na versão com que foi calculada. Esta versão foi publicada para reclassificar as abertas, então migraram. Se eu tivesse escolhido 'somente novas OS', as existentes ficariam como estavam."
4. Dois navegadores no mesmo rascunho → o segundo a salvar recebe **"Outro usuário alterou o rascunho"** (409), com o botão Recarregar (opcional, 20 s).

**Pode dar errado:** se a aprovação estiver ligada (`pontuacao.exigir_aprovacao`), a versão fica *aguardando aprovação*: aprove com o supervisor (quem enviou não aprova) — ou desligue antes (`docs/teste-pontuacao.md`, passo D). **Efeito colateral:** a versão publicada **fica** (é imutável) e muda os pontos dos cenários CR dali em diante; por isso este passo vem perto do fim e em banco de ensaio. **Plano B:** mostrar `versionamento.test.ts` e o passo E de `docs/teste-pontuacao.md`.

## 7. Reabrir uma OS (1 min) — **Supervisor**

`supervisor@farol.teste` → abra a OS **concluída** no passo 3 → aba **Status** → **Reabrir** → justificativa obrigatória → volta a *Aguardando despacho* e à fila.

- **Dizer:** "Só o supervisor reabre, sempre com justificativa, e fica na trilha de eventos e na auditoria."

**Pode dar errado:** sem OS concluída (o passo 3 não foi até o fim): conclua uma pela Equipe de campo ou use uma OS cancelada para mostrar que o botão de reabrir só aparece onde o fluxo permite. **Plano B:** `status.test.ts` lista as transições permitidas.

## 8. Fechamento (30 s) — **Administrador**

Entre como Administrador: ele vê tudo, inclusive o escopo **Global** da pontuação (o Usuário Chave de BH/CT edita só as cidades).

- **Dizer:** "Pronto: fila explicável, duplicidade sugerida, despacho sem concorrência, mapa, pontuação versionada. Falta, por decisão, completar os 19 critérios do §4, os prazos do §6, a unificação de OS e a importação do SGM — estão listados no README."

---

## Resumo de quem usa o quê

| Passo | Usuário | Tela |
|---|---|---|
| 1 | Atendente | Fila → OS → Prioridade/Histórico |
| 2 | Atendente | Nova solicitação (duplicidade, mapa) |
| 3 | Despachante · Equipe de campo | OS → Despacho |
| 4 | Supervisor | Mapa |
| 5 | Supervisor / Administrador | Precedência (leitura) |
| 6 | Usuário Chave | Pontuação |
| 7 | Supervisor | OS → Status → Reabrir |
| 8 | Administrador | Pontuação (escopo Global) |

## Se tudo der errado

Mostre `npm test`: os cenários CR-01 a CR-04 passam pelo mesmo motor da API (`packages/shared/src/cenarios.test.ts`), com a explicação de cada decisão nas asserções, e `docs/teste-concorrencia.md` e `docs/teste-pontuacao.md` provam a concorrência no banco.
