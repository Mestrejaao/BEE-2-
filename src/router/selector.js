const COMPLEXITY_HINTS = [
  "analise", "análise", "compare", "comparar", "estrategia", "estratégia",
  "arquitetura", "debug", "depurar", "planejamento", "planejar",
  "passo a passo", "raciocine", "raciocínio", "complexo", "detalhado"
];

export function chooseProvider(messages = []) {
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const normalized = latest.toLocaleLowerCase("pt-BR");
  const complexByLength = latest.length > 1200;
  const complexByIntent = COMPLEXITY_HINTS.some((hint) => normalized.includes(hint));
  // Preserve the existing primary routing policy: simple -> OpenAI, complex -> Claude.
  return complexByLength || complexByIntent ? "anthropic" : "openai";
}

export function getProviderOrder(preferred, env = {}) {
  const available = {
    openai: Boolean(env.OPENAI_API_KEY),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY)
  };
  const alternatives = preferred === "anthropic"
    ? ["openai", "gemini"]
    : preferred === "gemini"
      ? ["openai", "anthropic"]
      : ["anthropic", "gemini"];
  const order = [preferred, ...alternatives];
  return order.filter((provider, index) =>
    available[provider] && order.indexOf(provider) === index
  );
}
