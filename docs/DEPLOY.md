# Farol — Deploy de demonstração

Passo a passo para publicar a demonstração (dados fictícios). Nenhum valor secreto aparece
neste arquivo — preencha-os direto no painel do Render/Vercel/Supabase.

Repositório: `https://github.com/nicoly-rsousa/Maratona.de.IA`, branch `main`.

---

## 1. GitHub

- [ ] Confirmar que o repositório remoto é `nicoly-rsousa/Maratona.de.IA` (não o antigo
      `Maratona-RPV---PRIORIZA-O`) e que a branch publicada é `main`.
- [ ] `git push origin main` (só depois de revisar o diff).

## 2. Supabase (já existente — só conferir)

- [ ] Authentication → URL Configuration: adicionar a URL da Vercel (passo 4) em *Site URL* e em
      *Redirect URLs*, mantendo `http://localhost:3000` para uso local.
- [ ] Authentication → Settings: desligar "Allow new users to sign up" (cadastro é só por
      administrador cadastrando o usuário direto no banco/painel).
- [ ] Anotar `SUPABASE_URL`, a chave `anon` (vai na Vercel) e a chave `service_role` (vai só no
      Render) — nenhuma das duas sai do painel para este arquivo.

## 3. Render (`apps/api`)

A partir de `render.yaml` na raiz do repositório (Blueprint):

- [ ] New → Blueprint → selecionar o repositório `nicoly-rsousa/Maratona.de.IA`, branch `main`.
      O Render lê `render.yaml` e cria o serviço `farol-api` (Node 22, plano `starter`,
      `npm ci && npm run build:api`, start `npm run start -w @farol/api`,
      health check `/health`).
      > Plano `starter`, não `free`: no plano grátis o serviço dorme após inatividade, e a
      > reclassificação automática de 60 s (`setInterval` em `apps/api/src/server.ts`) só volta a
      > rodar depois que uma requisição acorda o processo — ela reinicia do zero, então o primeiro
      > recálculo das OS abertas acontece só ~60 s depois do primeiro request pós-sono, não antes.
- [ ] Preencher as variáveis de ambiente marcadas `sync: false`: `SUPABASE_URL`,
      `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN` (ver passo 5 — por enquanto pode deixar só
      `http://localhost:3000` e completar depois do passo 4).
- [ ] Deploy e aguardar `GET https://<serviço>.onrender.com/health` responder `{"ok":true,...}`.

## 4. Vercel (`apps/web`)

- [ ] New Project → importar `nicoly-rsousa/Maratona.de.IA`.
- [ ] **Root Directory**: `apps/web` (monorepo com npm workspaces; o lockfile fica na raiz do
      repo, a Vercel detecta isso automaticamente ao apontar o Root Directory).
- [ ] Build command e install command: padrão do Next.js (a Vercel já roda `npm install` na raiz
      do monorepo). Nenhum comando customizado é necessário — `transpilePackages: ["@farol/shared"]`
      em `apps/web/next.config.mjs` já resolve o pacote do workspace.
- [ ] Environment Variables (Production e Preview):
      - `NEXT_PUBLIC_API_URL` — URL pública do serviço Render (passo 3), nunca `localhost`.
      - `NEXT_PUBLIC_SUPABASE_URL`
      - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — a chave **anon/public**, nunca a `service_role`.
      > Nenhuma flag de demonstração e nenhum segredo de servidor entram aqui: só os três
      > `NEXT_PUBLIC_*` acima vão para o bundle do navegador.
- [ ] Deploy. Anotar a URL final (`https://<projeto>.vercel.app`).

## 5. Fechar o CORS

- [ ] Voltar ao Render → Environment → `CORS_ORIGIN` e colocar, separado por vírgula, a URL da
      Vercel do passo 4 **e** `http://localhost:3000`, por exemplo:
      `https://<projeto>.vercel.app,http://localhost:3000`.
      Nunca usar `*` (a API já valida isso — `apps/api/src/server.ts` registra `@fastify/cors`
      com `origin: env.CORS_ORIGIN.split(",")`, sem curinga, e `methods` inclui `PUT` para o
      preflight de `PUT /pontuacao/rascunho`).
- [ ] Salvar — o Render reinicia o serviço com a variável nova automaticamente.

## 6. Teste final

- [ ] Abrir a URL da Vercel, logar com um usuário `@farol.teste` (ver
      `docs/usuarios-de-teste.sql`) e confirmar que a fila carrega.
- [ ] Criar uma OS pela tela e confirmar que ela aparece na fila com pontuação calculada.
- [ ] Checar no DevTools (aba Network) que as chamadas vão para a URL do Render, não para
      `localhost`.
- [ ] Rodar `scripts/smoke.mjs` apontando `API_URL`/`WEB_URL` para as URLs publicadas.
- [ ] Testar o preflight de CORS de uma origem diferente (ex. `curl -i -X OPTIONS
      https://<api>.onrender.com/os/fila -H "Origin: https://outra-origem.com" -H
      "Access-Control-Request-Method: PUT"`) e confirmar que a resposta **não** inclui essa
      origem em `Access-Control-Allow-Origin`.

## Como derrubar tudo

- [ ] Vercel: Project Settings → Advanced → Delete Project (ou só pausar o deploy em
      Settings → Domains, removendo os domínios).
- [ ] Render: o serviço `farol-api` → Settings → Delete Service.
- [ ] Supabase: nenhuma ação necessária para "desligar a demonstração" — basta derrubar
      Vercel/Render; os dados ficam no banco até você decidir apagá-los.
- [ ] Opcional: revogar/rotacionar a chave `service_role` no Supabase se ela tiver sido exposta
      em algum lugar fora do Render.
