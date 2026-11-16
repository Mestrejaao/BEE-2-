const DEFAULT_SYSTEM_INSTRUCTION = "Você é a BEE, um assistente pessoal útil, claro e cuidadoso. Responda em português brasileiro quando o usuário escrever em português.";

/**
 * Converts the BEE chat history into Gemini generateContent format.
 * System messages are collected into systemInstruction; assistant messages
 * become model turns. Adjacent turns with the same role are merged.
 */
export function toGeminiContents(messages = []) {
  const contents = [];
  for (const message of messages) {
    if (!message || typeof message.content !== "string" || !message.content.trim()) continue;
    if (message.role === "system") continue;
    const role = message.role === "assistant" || message.role === "model" ? "model" :
      message.role === "user" ? "user" : null;
    if (!role) continue;
    const previous = contents[contents.length - 1];
    if (previous?.role === role) {
      previous.parts[0].text += "\n\n" + message.content;
    } else {
      contents.push({ role, parts: [{ text: message.content }] });
    }
  }
  return contents;
}

export function toGeminiSystemInstruction(messages = []) {
  const supplied = messages
    .filter((message) => message?.role === "system" && typeof message.content === "string")
    .map((message) => message.content.trim())
    .filter(Boolean);
  return [DEFAULT_SYSTEM_INSTRUCTION, ...supplied].join("\n\n");
}

export async function askGemini(messages, env) {
  if (!env.GEMINI_API_KEY) throw new Error("Google Gemini provider is not configured.");

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: toGeminiSystemInstruction(messages) }]
      },
      contents: toGeminiContents(messages),
      generationConfig: { maxOutputTokens: 2048 }
    }),
    signal: AbortSignal.timeout(45000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Google Gemini request failed (${response.status}).`);
  }

  const answer = (data.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!answer) {
    const reason = data.promptFeedback?.blockReason;
    throw new Error(reason
      ? `Google Gemini blocked the prompt (${reason}).`
      : "Google Gemini returned an empty response.");
  }
  return answer;
}
