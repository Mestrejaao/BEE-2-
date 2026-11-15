# BEE

Assistente pessoal com frontend estático e API modular em Cloudflare Workers.

## Estrutura

- `frontend/`: interface principal (texto e modo voz em preparação).
- `docs/`: versão publicada/documentação da interface, preservando a tela de identificação.
- `src/index.js`: rotas HTTP, autenticação e orquestração.
- `src/security/session.js`: sessões HMAC com validade de 12 horas.
- `src/router/selector.js`: seleção automática de provedor e fallback.
- `src/providers/`: adaptadores oficiais OpenAI Responses API e Anthropic Messages API.
- `tests/`: testes automatizados do seletor, sessões, rotas HTTP e rate limiting.

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
4. O Wrangler serve automaticamente a pasta `frontend/` junto com o Worker. Execute `npm run dev` e abra a URL local mostrada no terminal (normalmente `http://localhost:8787`). Para hospedar `docs/` separadamente, adicione antes de `app.js` em `docs/index.html`: `<script>window.BEE_API_BASE = "https://URL-DO-WORKER";</script>` e inclua a origem do site em `ALLOWED_ORIGINS`.
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

## Integração futura: Lovable

Lovable não é um provedor de inferência de texto equivalente a OpenAI/Claude. A Lovable oferece um servidor MCP oficial, mas atualmente a autenticação documentada é OAuth e os clientes suportados são específicos; não há uma API key genérica para o Worker usar como se fosse um endpoint de chat. Portanto, não foi inventado um endpoint privado nem adicionada uma integração que falharia em produção. A arquitetura deixa os adaptadores de IA separados para que uma integração MCP/OAuth seja feita quando houver um fluxo de autorização compatível com a BEE.

## Segurança e limites

- Chaves e código de acesso nunca são enviados ao navegador.
- Login validado no Worker; token HMAC expira em 12 horas e fica em `sessionStorage`.
- CORS permite apenas origens configuradas.
- O Worker usa os bindings nativos `LOGIN_RATE_LIMITER` e `CHAT_RATE_LIMITER` do Cloudflare Workers: login permite até 5 tentativas por 60 segundos por IP; chat permite até 20 chamadas por 60 segundos por conta BEE autenticada. Os limites são definidos em `wrangler.jsonc` e não exigem secrets adicionais nem regras manuais no painel.
- O IP do login é obtido exclusivamente do cabeçalho `CF-Connecting-IP`, definido pela infraestrutura Cloudflare. Cabeçalhos controláveis pelo cliente, como `X-Forwarded-For` e `X-Real-IP`, são ignorados. Se o IP confiável ou o binding não estiver disponível, o endpoint falha fechado com HTTP 503 em vez de desativar a proteção.
- Quando o limite é excedido, a API retorna HTTP 429 e `Retry-After: 60`. Erros de infraestrutura do rate limiter também falham fechados com HTTP 503.
- O limite de chat usa a identidade `bee-user:chat` validada pela sessão, agregando todas as sessões do código BEE atual. Para separar usuários no futuro, use um identificador estável e validado por usuário na chave.
- **Limitação do Rate Limiting API:** os contadores são aproximados e independentes por localização Cloudflare; pode haver excesso temporário e não existe uma quota global estrita. Isso é adequado como proteção inicial de abuso. Se a BEE precisar de limite global estrito entre regiões, migre o contador para Durable Objects com uma instância por identidade.
- O histórico de conversa fica no navegador; não há banco de dados nem persistência server-side nesta etapa.
- O Worker serve a interface de `frontend/` e encaminha somente `/api/*` ao código do Worker. A pasta `docs/` é uma publicação alternativa estática e precisa apontar para a URL do Worker.
- O modo voz permanece como estava: interface preservada, integração de voz ainda não implementada.

## Rate limiting (Cloudflare Workers)

Os bindings já estão declarados em `wrangler.jsonc` e usam namespaces distintos (`2001` para login e `2002` para chat). Os valores padrão podem ser ajustados ali:

| Binding | Chave de contagem | Limite |
| --- | --- | --- |
| `LOGIN_RATE_LIMITER` | IP confiável Cloudflare (`CF-Connecting-IP`) | 5 / 60 segundos |
| `CHAT_RATE_LIMITER` | identidade da conta autenticada `bee-user:chat` | 20 / 60 segundos |

A Rate Limiting API requer Wrangler 4.36.0 ou superior (o projeto usa Wrangler 4.50+). Para validar o Worker localmente, os testes injetam bindings simulados; eles verificam bloqueio HTTP 429, `Retry-After`, ausência de fallback para IP falsificável e comportamento fail-closed. A decisão real e os contadores são fornecidos pela Cloudflare quando o Worker é executado na infraestrutura Cloudflare.

## Verificações

Execute `npm test` para os testes automatizados. `npm run dev` inicia o Worker localmente. Nenhuma implantação é executada por estes comandos.
