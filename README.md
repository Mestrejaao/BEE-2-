# BEE

Assistente pessoal com frontend estático e API modular em Cloudflare Workers.

## Estrutura

- `frontend/`: interface principal (texto e modo voz em preparação).
- `docs/`: versão publicada/documentação da interface, preservando a tela de identificação.
- `src/index.js`: rotas HTTP, autenticação e orquestração.
- `src/security/session.js`: sessões HMAC com validade de 12 horas.
- `src/router/selector.js`: seleção automática de provedor e fallback.
- `src/providers/`: adaptadores oficiais OpenAI Responses API e Anthropic Messages API.
- `tests/`: testes unitários do seletor.

## Desenvolvimento local

Requer Node.js 20+.

1. Instale as dependências: `npm install`.
2. Crie `.dev.vars` na raiz (não versionar):
   ```dotenv
   BEE_ACCESS_CODE="escolha-um-codigo-forte"
   SESSION_SECRET="gere-um-segredo-aleatorio-com-pelo-menos-32-bytes"
   OPENAI_API_KEY=""
   ANTHROPIC_API_KEY=""
   ```
   Configure ao menos uma chave de provedor para conversar com a IA.
3. Inicie o Worker: `npm run dev`.
4. Em outro terminal, sirva a pasta `frontend` ou `docs` em `http://localhost:8787` (ou ajuste a porta/origem permitida em `ALLOWED_ORIGINS`). Para usar a API em outra origem, defina `window.BEE_API_BASE = "https://URL-DO-WORKER"` antes de carregar `app.js` no HTML.
5. Faça login usando o código definido em `BEE_ACCESS_CODE`.

## Configuração no Cloudflare

Configure os seguintes **secrets** no Worker (não em `vars`, HTML, JavaScript do navegador ou Git):

- `BEE_ACCESS_CODE`: código que autoriza o acesso à interface.
- `SESSION_SECRET`: segredo aleatório forte usado para assinar sessões.
- `OPENAI_API_KEY`: chave da plataforma OpenAI (opcional se Anthropic estiver configurada).
- `ANTHROPIC_API_KEY`: chave da Claude API (opcional se OpenAI estiver configurada).

Comandos para cadastrar secrets (cada comando solicita o valor no terminal):

```bash
npx wrangler secret put BEE_ACCESS_CODE
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

Defina `ALLOWED_ORIGINS` como variável não secreta com a origem exata do site que hospeda a interface, por exemplo `https://SEU-USUARIO.github.io`. Não inclua caminhos como `/BEE-2-/docs`. Para desenvolvimento, as origens localhost já estão configuradas no `wrangler.jsonc`.

Ajuste opcionalmente `OPENAI_MODEL` e `ANTHROPIC_MODEL` como variáveis não secretas para selecionar modelos habilitados na sua conta.

**Atenção:** `wrangler secret put` cria uma nova versão/deploy do Worker. Não execute esses comandos até autorizar o deploy. Nenhum secret foi criado nesta implementação.

## Seleção automática

O seletor envia prompts curtos e comuns primeiro para OpenAI; pedidos longos ou com sinais de análise/planejamento vão primeiro para Claude. Se o provedor preferido falhar, o backend tenta o outro quando uma chave estiver configurada. A regra é simples e isolada em `src/router/selector.js`, pronta para evoluir com métricas e políticas de custo.

## Integração futura

Novos provedores podem implementar o contrato dos adaptadores em `src/providers/` e ser adicionados ao roteador. Lovable fica como integração futura via API/conector oficial compatível, não como um modelo de chat presumido; nenhum endpoint não documentado foi inventado.

## Segurança e limites

- Chaves e código de acesso nunca são enviados ao navegador.
- Login validado no Worker; token HMAC expira em 12 horas e fica em `sessionStorage`.
- CORS permite apenas origens configuradas.
- O endpoint de chat exige sessão e limita histórico, tamanho de mensagem e corpo.
- O histórico de conversa fica no navegador; não há banco de dados nem persistência server-side nesta etapa.
- O modo voz permanece como estava: interface preservada, integração de voz ainda não implementada.

## Verificações

Execute `npm test` para os testes unitários do seletor. `npm run dev` inicia o Worker localmente. Nenhuma implantação é executada por estes comandos.
