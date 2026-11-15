# BEE

Assistente pessoal com frontend estático e API modular em Cloudflare Workers.

## Estrutura

- `docs/index.html`: interface oficial publicada pelo GitHub Pages (fonte única da UI).
- `docs/bee-config.js`: configuração pública centralizada do endereço da API Worker.
- `frontend/index.html`: redirecionamento para a interface canônica em `docs/` (evita manter duas cópias da UI).
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
3. Inicie somente a API Worker local: `npm run dev` (normalmente `http://localhost:8787`). O Worker não hospeda a interface.
4. Para testar a interface, abra `docs/index.html` por um servidor estático local e defina `window.BEE_API_BASE` em `docs/bee-config.js` para a URL da API local. Inclua a origem local em `ALLOWED_ORIGINS`.
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

Defina `ALLOWED_ORIGINS` como variável não secreta com as origens exatas autorizadas. A produção já está configurada para `https://mestrejaao.github.io`; as origens `http://localhost:8787` e `http://127.0.0.1:8787` ficam disponíveis para desenvolvimento. Não inclua caminho de repositório, como `/BEE-2-/`.

Depois de criar o Worker e conhecer seu endereço `*.workers.dev`, edite somente `docs/bee-config.js` e atribua a URL real a `window.BEE_API_BASE`, sem barra final. O arquivo é público: nunca coloque chaves de API nele. A interface do GitHub Pages é servida a partir de `docs/`; essa pasta contém a única cópia oficial do HTML. `frontend/index.html` apenas redireciona para ela.

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
- O Worker é exclusivamente backend: responde às rotas `/api/*` e não publica arquivos estáticos. O GitHub Pages publica a interface a partir de `docs/`; `docs/bee-config.js` é o único ponto para configurar o endereço da API.
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
