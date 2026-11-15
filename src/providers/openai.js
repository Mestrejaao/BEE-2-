export async function askOpenAI(messages, env) {
  if (!env.OPENAI_API_KEY) throw new Error("OpenAI provider is not configured.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-6-astra",
      instructions: "Você é a BEE, um assistente pessoal útil, claro e cuidadoso. Responda em português brasileiro quando o usuário escrever em português.",
      input: messages.map(({ role, content }) => ({ role, content }))
    }),
    signal: AbortSignal.timeout(45000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `OpenAI request failed (${response.status}).`);

  const answer = (data.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();

  if (!answer) throw new Error("OpenAI returned an empty response.");
  return answer;
}
