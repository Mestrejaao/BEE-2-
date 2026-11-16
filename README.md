> **Migração em andamento:** a entrada Vercel está preparada em `api/[...path].js`, mas login e chat permanecem bloqueados com HTTP 503 até existir rate limiting durável, funcional e aprovado sem cobrança. Não configure nem publique a Vercel antes dessa validação. A configuração Cloudflare abaixo foi mantida intacta como fallback e referência; ela não foi removida nem substituída.

# BEE

Assistente pessoal com frontend estático e API modular em Cloudflare Workers.

## Estrutura

- `docs/index.html`: interface oficial publicada pelo GitHub Pages (fonte única da UI).
- `docs/bee-config.js`: configuração pública centralizada do endereço da API Worker.
- `frontend/index.html`: redirecionamento para a interface canônica em `docs/`.
- `src/index.js`: rotas HTTP, autenticação e orquestração.
- `src/security/session.js`: sessões HMAC com validade de 12 horas.
- `src/security/upstash-rate-limit.js`: adaptador Vercel para limitadores duráveis Upstash.
- `src/router/selector.js`: seleção automática e ordem de fallback.
- `src/providers/`: adaptadores oficiais OpenAI, Anthropic e Google Gemini.
- `tests/`: testes automatizados de provedores, seletor, sessões, rotas e rate limiting.

## Desenvolvimento local

Requer **Node.js 22.12.0 ou superior** (mesma versão mínima declarada em `package.json` e compatível com a versão do Wrangler fixada no lockfile).

1. Instale as dependências: `npm ci` (ou `npm install`).
2. Crie `.dev.vars` na raiz (não versionar):
   ```dotenv
   BEE_ACCESS_CODE="escolha-um-codigo-forte"
   SESSION_SECRET="gere-um-segredo-aleatorio-com-pelo-menos-32-bytes"
   OPENAI_API_KEY=""
   ANTHROPIC_API_KEY=""
   GEMINI_API_KEY=""
   ```
   Configure ao menos uma chave de provedor para conversar com a IA.
3. Inicie somente a API Worker local: `npm run dev`.
4. A interface permanece em `docs/`; não é necessário modificá-la para adicionar provedores.

## Configuração de provedores

Todas as chaves são lidas exclusivamente no backend, por secrets/variáveis de ambiente server-side. Nunca coloque chaves em HTML, JavaScript do navegador, `docs/bee-config.js`, Git ou respostas HTTP.

Secrets opcionais:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

Modelos opcionais (variáveis não secretas):
- `OPENAI_MODEL`
- `ANTHROPIC_MODEL`
- `GEMINI_MODEL` (padrão: `gemini-2.5-flash`)

O adaptador Gemini usa diretamente a API oficial `generateContent` via `fetch`, sem SDK ou dependência adicional. A chave é anexada à requisição server-side e nunca é encaminhada ao cliente.

Para Cloudflare, configure secrets no Worker somente quando decidir habilitar cada provedor. `wrangler secret put` pode publicar uma nova versão do Worker; nenhum secret foi criado nem deploy realizado nesta implementação.

## Seleção automática e fallback

A política primária existente foi preservada:
- Prompts curtos e comuns: OpenAI primeiro.
- Prompts longos ou com sinais de análise/planejamento: Anthropic primeiro.

Gemini é o terceiro provedor na ordem de fallback, sem alterar as preferências atuais:
- OpenAI preferida: OpenAI → Anthropic → Gemini.
- Anthropic preferida: Anthropic → OpenAI → Gemini.

Somente provedores com chave configurada entram na ordem. Cada provedor é tentado no máximo uma vez. Falhas HTTP, respostas vazias e timeouts acionam o próximo provedor. Se nenhum provedor estiver configurado, a API retorna HTTP 503; se todos os configurados falharem, retorna HTTP 502.

O adaptador Gemini converte mensagens `assistant` para `model`, mantém mensagens de usuário como `user` e combina instruções `system` na propriedade `systemInstruction` (incluindo a instrução-base da BEE).

## Segurança e limites

- Chaves e código de acesso nunca são enviados ao navegador.
- Autenticação, sessões, CORS e rate limiting permanecem inalterados.
- O Worker continua usando os bindings nativos Cloudflare já existentes.
- A entrada Vercel continua encaminhando apenas variáveis server-side ao handler compartilhado; credenciais Upstash e política fail-closed permanecem obrigatórias.
- O histórico permanece no navegador; não há persistência server-side nesta etapa.

## Verificações

Execute `npm ci` e `npm test` com Node.js 22.12.0 ou superior para instalar as versões exatas do lockfile e rodar os testes com mocks. Os testes não fazem chamadas reais às APIs Gemini, OpenAI ou Anthropic. `npm run dev` inicia o Worker localmente; nenhum deploy é executado.

## Migração Vercel (não publicada)

A Function `api/[...path].js` continua compartilhando o handler de `src/index.js`. Além das variáveis já documentadas, `GEMINI_API_KEY` e `GEMINI_MODEL` são lidas somente do ambiente server-side. O limitador Upstash valida a URL REST HTTPS e o token antes de inicializar; respostas incompletas, inválidas, autenticação negada e falhas de conexão permanecem fail-closed. Não configure recursos nem credenciais sem avaliar custos e autorizar explicitamente.
