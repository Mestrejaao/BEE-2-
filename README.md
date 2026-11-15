> **Migração em andamento:** a entrada Vercel está preparada em `api/[...path].js`, mas login e chat permanecem bloqueados com HTTP 503 até existir rate limiting durável, funcional e aprovado sem cobrança. Não configure nem publique a Vercel antes dessa validação. A configuração Cloudflare abaixo foi mantida intacta como fallback e referência; ela não foi removida nem substituída.

# BEE

Assistente pessoal com frontend estático e API modular em Cloudflare Workers.

## Estrutura

- `docs/index.html`: interface oficial publicada pelo GitHub Pages (fonte única da UI).
- `docs/bee-config.js`: configuração pública centralizada do endereço da API Worker.
- `frontend/index.html`: redirecionamento para a interface canônica em `docs/` (evita manter duas cópias da UI).
- `src/index.js`: rotas HTTP, autenticação e orquestração.
- `src/security/session.js`: sessões HMAC com validade de 12 horas.
- `src/security/upstash-rate-limit.js`: adaptador Vercel para limitadores duráveis Upstash, sem cache em memória.
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
- No Worker Cloudflare, o limite de chat continua usando a identidade `bee-user:chat`, preservando o comportamento anterior. Na Function Vercel, cada sessão autenticada recebe uma chave SHA-256 do token; o token original nunca é enviado ao Redis.
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


## Migração planejada para Vercel (não publicada)

- A Function Node.js de `api/[...path].js` encaminha as requisições para o handler compartilhado em `src/index.js`.
- `GET /api/health` pode ser validado sem secrets ou chamadas a provedores.
- Login e chat usam `@upstash/ratelimit` + `@upstash/redis`, com janelas deslizantes separadas: 5 tentativas/60 s por IP no login e 20 chamadas/60 s por sessão no chat. O IP é aceito somente pelo `X-Forwarded-For` que a Vercel sobrescreve, e apenas quando contém um único endereço IP válido. Sem credenciais ou limitador, a Function retorna HTTP 503.
- O cache `ephemeralCache` está explicitamente desativado. Respostas de timeout do SDK (que normalmente podem permitir a requisição) são convertidas em resultado inconclusivo e retornam HTTP 503. Erros, respostas malformadas e indisponibilidade também falham fechados.
- As rotas antigas do Worker e seus testes continuam disponíveis. `wrangler.jsonc`, a dependência Wrangler e as configurações Cloudflare foram preservados para permitir rollback até a nova arquitetura ser validada.
- Para Vercel, as variáveis server-side esperadas são `BEE_ACCESS_CODE`, `SESSION_SECRET`, `OPENAI_API_KEY` e/ou `ANTHROPIC_API_KEY`, além de `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`. Nenhum segredo foi configurado nesta implementação; não crie recursos nem cadastre credenciais sem avaliar antes o plano e os custos do Upstash.
- O Vercel Firewall/WAF pode oferecer rate limiting conforme o plano e a franquia de uso. A documentação pública informa franquia de requisições permitidas e preço por excedente; portanto, não foi ativado nem considerado garantidamente sem custo. A regra também precisa ser criada e validada no projeto antes de liberar as rotas protegidas.
- Não use armazenamento em memória, variáveis locais de processo ou arquivos temporários como contador de requisições em Functions serverless.
- A URL em `docs/bee-config.js` permanece inalterada até que a arquitetura Vercel, a proteção e o endpoint real sejam validados. O frontend continua no GitHub Pages.

### Verificações locais

- `npm test`: executa testes com mocks, sem chamadas reais à OpenAI ou Anthropic.
- `npm run dev:vercel`: inicia o ambiente local Vercel quando o CLI estiver disponível e autorizado na máquina. Não faz deploy.
- A rota de saúde é esperada em `/api/health`. Os testes simulam Redis e rate limiter: não fazem chamadas reais à Upstash. Sem as duas variáveis Upstash, login/chat permanecem indisponíveis (503).
