export type MessageRole = "user" | "agent" | "system";

export type ChatPhase = "phone-entry" | "ivr" | "l1" | "l2";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface ChatRequest {
  phase: "ivr" | "l1" | "l2";
  messages: Message[];
  phoneNumber: string;
  hasIvrContext?: boolean;
}

export interface ChatResponse {
  agentMessage: string;
  transition?: {
    category: "technical" | "non-technical";
    nextPhase: "l1" | "l2";
  };
}

export interface LookupResponse {
  found: boolean;
  techCompetence?: boolean;
}
