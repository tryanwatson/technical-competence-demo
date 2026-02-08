import { NextRequest, NextResponse } from "next/server";
import {
  L1_SYSTEM_PROMPT,
  L2_SYSTEM_PROMPT,
  L1_DIRECT_SYSTEM_PROMPT,
  L2_DIRECT_SYSTEM_PROMPT,
} from "@/app/lib/agents";
import { IVR_VOICE_PROMPT, ROUTE_CALLER_TOOL } from "@/app/lib/voice-agents";
import { getSql } from "@/app/db";

const VOICE_MAP: Record<string, string> = {
  ivr: "ash",
  l1: "ballad",
  l2: "coral",
};

const ENGLISH_RULE =
  "IMPORTANT: You must speak only in English. Do not switch languages under any circumstances.";

function getInstructions(
  phase: string,
  hasIvrContext: boolean,
  summary?: string
): string {
  let base: string;
  switch (phase) {
    case "ivr":
      base = IVR_VOICE_PROMPT;
      break;
    case "l1":
      if (!hasIvrContext) {
        base = L1_DIRECT_SYSTEM_PROMPT;
      } else {
        base = summary
          ? `${L1_SYSTEM_PROMPT}\n\nContext from the caller's initial call: ${summary}`
          : L1_SYSTEM_PROMPT;
      }
      break;
    case "l2":
      if (!hasIvrContext) {
        base = L2_DIRECT_SYSTEM_PROMPT;
      } else {
        base = summary
          ? `${L2_SYSTEM_PROMPT}\n\nContext from the caller's initial call: ${summary}`
          : L2_SYSTEM_PROMPT;
      }
      break;
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
  return `${ENGLISH_RULE}\n\n${base}`;
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phase = searchParams.get("phase") || "ivr";
    const phoneNumber = searchParams.get("phoneNumber") || "";
    const hasIvrContext = searchParams.get("hasIvrContext") !== "false";
    const category = searchParams.get("category");
    const summary = searchParams.get("summary") || undefined;

    // If transitioning from IVR, write categorization to DB (best-effort)
    if (category && phoneNumber) {
      const isTechnical = category === "technical";
      try {
        const sql = getSql();
        await sql`
          INSERT INTO users (name, phone_number, tech_competence)
          VALUES (NULL, ${phoneNumber}, ${isTechnical})
          ON CONFLICT (phone_number) DO UPDATE SET tech_competence = ${isTechnical}
        `;
      } catch (dbError) {
        console.error("Failed to write user categorization to DB:", dbError);
      }
    }

    const instructions = getInstructions(phase, hasIvrContext, summary);
    const voice = VOICE_MAP[phase] || "ash";

    // Use ephemeral token approach: create a short-lived client secret with
    // full session config (instructions, tools, voice) baked in. The client
    // then uses this token to connect directly via WebRTC.
    const sessionConfig = {
      session: {
        type: "realtime",
        model: "gpt-realtime",
        instructions,
        audio: { output: { voice } },
        tools: phase === "ivr" ? [ROUTE_CALLER_TOOL] : [],
        tool_choice: phase === "ivr" ? "auto" : "none",
      },
    };

    const tokenResponse = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sessionConfig),
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("OpenAI client_secrets error:", errorText);
      return NextResponse.json(
        { error: "Failed to create voice session" },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    return NextResponse.json(tokenData);
  } catch (error) {
    console.error("Voice session error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
