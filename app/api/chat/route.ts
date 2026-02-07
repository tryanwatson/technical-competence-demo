import { NextRequest, NextResponse } from "next/server";
import { getCompletion, type LLMMessage } from "@/app/lib/openai";
import {
  IVR_SYSTEM_PROMPT,
  CATEGORIZATION_PROMPT,
  L1_SYSTEM_PROMPT,
  L2_SYSTEM_PROMPT,
} from "@/app/lib/agents";
import type { ChatRequest, ChatResponse, Message } from "@/app/lib/types";

const READY_MARKER = "[READY_TO_ROUTE]";

function toOpenAIMessages(messages: Message[]): LLMMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));
}

function getSystemPrompt(phase: string): string {
  switch (phase) {
    case "ivr":
      return IVR_SYSTEM_PROMPT;
    case "l1":
      return L1_SYSTEM_PROMPT;
    case "l2":
      return L2_SYSTEM_PROMPT;
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { phase, messages } = body;

    if (!phase || !messages) {
      return NextResponse.json(
        { error: "Missing required fields: phase, messages" },
        { status: 400 }
      );
    }

    const openaiMessages = toOpenAIMessages(messages);
    const systemPrompt = getSystemPrompt(phase);

    let agentReply = await getCompletion(systemPrompt, openaiMessages);

    // IVR completion check
    if (phase === "ivr" && agentReply.includes(READY_MARKER)) {
      agentReply = agentReply.replace(READY_MARKER, "").trim();

      // Build conversation summary for categorization
      const conversationSummary = messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");

      const categoryRaw = await getCompletion(
        CATEGORIZATION_PROMPT,
        [{ role: "user", content: conversationSummary }],
        { temperature: 0.1, maxTokens: 10 }
      );

      const normalized = categoryRaw.toLowerCase().trim();
      const isTechnical =
        normalized === "technical" || normalized === '"technical"';

      const response: ChatResponse = {
        agentMessage: agentReply,
        transition: {
          category: isTechnical ? "technical" : "non-technical",
          nextPhase: isTechnical ? "l2" : "l1",
        },
      };

      return NextResponse.json(response);
    }

    const response: ChatResponse = { agentMessage: agentReply };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Chat API error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
