# Farol — design system do front (`apps/web`)

Como a interface é construída: tokens, CSS em BEM, componentes React e ícones. Meta de acessibilidade: **WCAG 2.2 AA**.
O protótipo `docs/farol.html` continua como referência de **fluxos**; a identidade visual dele (tema escuro azul-petróleo)
foi substituída pela descrita aqui.

## 1. Organização dos estilos

`src/app/globals.css` só importa as camadas, nesta ordem (a ordem é a cascata; `postcss-import` resolve os `@import`):

| # | Arquivo | Conteúdo |
|---|---|---|
| 1 | `src/styles/tokens.css` | Variáveis: cores (claro e escuro), tipografia, espaços, raios, sombras, transições, camadas |
| 2 | `tailwindcss/base` + `src/styles/base.css` | Preflight do Tailwind e estilos de elemento (corpo, títulos, foco, `prefers-reduced-motion`) |
| 3 | `src/styles/layout.css` | `skip-link`, `app-header`, `app-layout`, `app-nav`, `page` |
| 4 | `src/styles/components/*.css` | Blocos reutilizáveis (seção 4) |
| 5 | `src/styles/pages/*.css` | Só o que é de uma tela: `login`, `map-view`, `rule-card` |
| 6 | `tailwindcss/utilities` | Utilitários de layout pontual (vêm por último e podem ajustar um bloco) |

Os ícones MUI injetam o próprio CSS (emotion) em `@layer mui` (`AppRouterCacheProvider` com `enableCssLayer`, em
`src/app/layout.tsx`): CSS fora de layer sempre vence, então as classes do projeto prevalecem sem `!important`.

## 2. Regras

- **Cor só por token.** O `tailwind.config.ts` **substitui** a paleta padrão: `bg-blue-600` e afins não existem. As cores
  disponíveis no Tailwind são aliases dos tokens (`text-muted`, `text-fg`, `bg-surface`, `border-line`, `text-primary`…).
  Tamanhos de fonte (`text-xs` … `text-xl`) também apontam para os tokens.
- **BEM nas classes próprias**: `bloco`, `bloco__elemento`, `bloco--modificador`, `bloco__elemento--modificador`.
  Um elemento pode misturar blocos (ex.: `tabs__panel card`). Estados de acessibilidade usam o atributo, não uma classe
  extra, quando ele já existe (`[aria-invalid="true"]` em `.control`).
- **Tailwind só para layout pontual** (`flex`, `gap-*`, `grid`, `min-w-0`, `my-2`, `sr-only`, `font-mono`, `text-muted`).
  Aparência de componente (bordas, fundos, estados) fica no bloco BEM.
- **Exceção documentada**: em `.data-table`, as células são estilizadas por descendência (`.data-table th, td`), porque
  toda célula é `th`/`td`; variações usam modificadores (`data-table__cell--num`, `--wrap`, `--center`, `--actions`).
- Não há estilo global de `button`/`input`/`select`: cada controle recebe `.button` ou `.control`.
- Sem cor em linha. O único estilo em linha restante é a altura do mapa (é dado de uso, não tema).

## 3. Paleta e contraste

Base: [Homework (Lospec)](https://lospec.com/palette-list/homework) — `#E1D8D4`, `#878C9D`, `#45568D`, `#12121B`.
Tema **claro é o padrão**; `html[data-t="d"]` liga o escuro (botão "Tema escuro" no cabeçalho, salvo em `localStorage`,
chave `farol-tema`; o script em `src/app/layout.tsx` aplica antes da primeira pintura).

| Papel (token) | Claro | Escuro | Por quê |
|---|---|---|---|
| Fundo da página `--color-bg` | `#F4F0EE` (tint de E1D8D4) | `#12121B` (Homework) | |
| Superfície `--color-surface` | `#FFFFFF` | `#1C1C28` | cards, tabelas, cabeçalho |
| Superfície alternativa / afundada | `#ECE6E3` / `#E1D8D4` (Homework) | `#262636` / `#171722` | cabeçalho de tabela, hover, grupos |
| Texto `--color-text` | `#12121B` (16,4:1) | `#E1D8D4` (13,3:1) | Homework |
| Texto de apoio `--color-text-muted` | `#585C6C` (5,9:1) | `#9A9FB0` (7,1:1) | `#878C9D` sobre o claro tem só 2,4:1 → tom derivado |
| Primária `--color-primary` | `#45568D` (6,3:1; branco sobre ela 7,1:1) | `#8E9FD6` (7,2:1; `#12121B` sobre ela 7,2:1) | `#45568D` sobre o escuro tem só 2,6:1 → tom derivado |
| Contorno de controle `--color-border-strong` | `#6B7080` (≥ 4,4:1) | `#878C9D` (Homework, ≥ 5,0:1) | componente de interface: mínimo 3:1 |
| Divisória `--color-border-subtle` / contorno de card `--color-border` | `#DDD5D1` / `#878C9D` | `#2E2F40` / `#4A4D60` | decorativo |

Semânticas (texto sobre o fundo da própria variante, ≥ 4,5:1 nos dois temas): `--color-danger*`, `--color-warning*`,
`--color-success*`, `--color-info*`, cada uma com `-bg` e `-border`.

**Prioridade** (convenção funcional preservada do protótipo; a etiqueta sempre mostra o nome do código, nunca só a cor):

| Código | Token | Claro (texto branco) | Escuro (texto `#12121B`) |
|---|---|---|---|
| Emergente | `--color-priority-emergente` | `#C4005F` (6,0:1) | `#FF3D8B` (5,6:1) |
| Urgente | `--color-priority-urgente` | `#C93A14` (5,1:1) | `#FF5A3C` (6,0:1) |
| Alta | `--color-priority-alta` | `#9A6A00` (4,7:1) | `#F2A900` (9,3:1) |
| Média | `--color-priority-media` | `#1F64C8` (5,7:1) | `#4F9CFF` (6,7:1) |
| Baixa | `--color-priority-baixa` | `#4C675A` (6,2:1) | `#7D9A8C` (6,1:1) |

O mapa (`src/components/mapa-leaflet.tsx`) lê esses tokens em runtime (o Leaflet não resolve `var()` em SVG) e relê
quando o tema muda. Se renomear um token de prioridade ou de mapa, atualize a lista `TELA` desse arquivo.

`npm run check:contrast` (`scripts/contraste.mjs`) confere todos os pares acima nos dois temas e falha abaixo do mínimo.

**Demais tokens**: fonte do sistema (`--font-sans`, `--font-mono`), tamanhos 12/13/14/16/18/22 px (base 14 px), espaços em
múltiplos de 4 px (`--space-1` … `--space-10`), raios 4/6/8 px e `--radius-full`, sombras `sm/md/lg`, transições
`--transition-fast/base`. Breakpoints: `sm` 640, `md` 768 (navegação vira barra horizontal), `lg` 1024 (mapa e painel
empilham) — os mesmos no `tailwind.config.ts` e nos `@media` dos CSS.

## 4. Componentes

| Bloco CSS | Componente React (`src/components`) | Uso |
|---|---|---|
| `page-header` | `CabecalhoPagina` | Único `h1` da tela, descrição, ações; `antes` para o link de voltar |
| `alert--error/warning/success/info` | `Alerta`, `ErroApi`, `ErroAcao` | Mensagens de estado com ícone e título; `ErroApi` trata 403/404 e oferece "Tentar novamente" |
| `loading`, `empty-state` | `Carregando`, `EstadoVazio`, `EstadoConsulta`, `SemCidade` | `EstadoConsulta` = carregando → erro → dados, igual em todas as telas |
| `data-table` | `Tabela` | Tabela com `caption` (sr-only) e área rolável focável: a página nunca rola de lado |
| `form-field`, `control`, `form-grid`, `form-group` | `CampoFormulario`, `CampoCheckbox` | Rótulo visível, dica e erro ligados por `aria-describedby`; obrigatório com `*` e texto para leitor de tela |
| `tabs` | `Abas` | Abas ARIA com setas, Home e End (roving tabindex) |
| `badge--<código>` | `Pill` (`prioridade.tsx`) | Etiqueta de prioridade |
| `link`, `link--chip`, `link--mono`, `link--back` | `LinkExterno` | Link de nova aba com ícone e aviso "(abre em nova aba)" |
| `button`, `--primary`, `--ghost`, `--danger`, `--sm`, `--selected`; `button-group` | — | Ações; uma primária por grupo. Motivo de botão desabilitado em texto visível (`button-group__note` + `aria-describedby`), não em `title` |
| `dialog` | `JustificativaDialog` | `<dialog>` nativo com justificativa obrigatória |
| `card`, `summary`, `timeline` | — | Agrupamento, pares rótulo/valor (`<dl>`), trilha de eventos (`<ol>`) |
| `icon` | `Icone` | Ícone Material decorativo (`aria-hidden`) ou com nome (`rotulo`) |

## 5. Ícones

`@mui/icons-material` (com `@mui/material` e emotion, dependências exigidas pelo pacote), importados por caminho
(`import Logout from "@mui/icons-material/Logout"`) e sempre via `<Icone de={…} />`. **Nenhum outro componente MUI** é usado.
Na versão 9, as variantes "outline" têm o sufixo `Outlined` (ex.: `ErrorOutlineOutlined`).

| Onde | Ícones |
|---|---|
| Navegação | Fila `FormatListNumbered`, Nova `AddCircleOutlineOutlined`, Pontuação `Tune`, Precedência `Rule`, Mapa `MapOutlined` |
| Cabeçalho | `PersonOutlineOutlined`, `LocationCityOutlined`, `DarkModeOutlined`/`LightModeOutlined`, `Logout` |
| Estados | `ErrorOutlineOutlined`, `WarningAmber`, `CheckCircleOutlineOutlined`, `InfoOutlined`, `Inbox` (vazio) |
| Ações | `Send`, `SaveOutlined`, `FactCheckOutlined`, `Publish`, `Restore`, `Undo`, `DeleteOutlineOutlined`, `Add`, `Refresh`, `AssignmentInd`, `PersonRemoveOutlined`, `PlayArrow`, `VisibilityOutlined`, `DirectionsOutlined`, `OpenInNew`, `ArrowBack`, `ArrowForward`, `Replay`, `Link` |

Texto sempre acompanha as ações; botão só com ícone precisa de `aria-label`.

## 6. Acessibilidade — o que já está garantido

- `lang="pt-BR"`, link "Pular para o conteúdo", um `h1` por tela e hierarquia h1 → h2 → h3.
- Item de navegação atual com `aria-current="page"`; abas com `aria-selected`; botão de tema com `aria-pressed`.
- Foco visível em tudo (`:focus-visible` com o token `--color-focus`); áreas de toque de 30–40 px.
- Formulários: rótulos visíveis, erro junto do campo (`aria-invalid` + `aria-describedby`), resumo de erros com links
  para os campos e foco no primeiro campo inválido (Nova solicitação, que agora é um `<form>`: Enter envia).
- Botões repetidos em tabelas com nome contextual ("Designar a equipe BH-A", "Restaurar a v2…").
- Informação nunca só por cor: prioridade com nome, seleção no mapa com ícone + `aria-pressed`, alertas com ícone e título.
- Movimento reduzido respeitado (`prefers-reduced-motion`).
