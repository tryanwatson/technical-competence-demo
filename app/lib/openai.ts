import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function getCompletion(
  systemPrompt: string,
  conversationMessages: LLMMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationMessages,
    ],
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 300,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }
  return content.trim();
}
