export async function askAnthropic(messages, env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("Anthropic provider is not configured.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 2048,
      system: "Você é a BEE, um assistente pessoal útil, claro e cuidadoso. Responda em português brasileiro quando o usuário escrever em português.",
      messages: messages.map(({ role, content }) => ({ role, content }))
    }),
    signal: AbortSignal.timeout(45000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Anthropic request failed (${response.status}).`);

  const answer = (data.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!answer) throw new Error("Anthropic returned an empty response.");
  return answer;
}
