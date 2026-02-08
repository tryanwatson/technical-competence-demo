"use client";

import { useState, useCallback } from "react";
import { PhoneInput } from "./PhoneInput";
import { ChatWindow } from "./ChatWindow";
import type {
  Message,
  MessageRole,
  ChatPhase,
  ChatResponse,
} from "@/app/lib/types";

export function SupportChat() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [chatPhase, setChatPhase] = useState<ChatPhase>("phone-entry");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isAgentTyping, setIsAgentTyping] = useState(false);

  const addMessage = useCallback(
    (role: MessageRole, content: string): Message => {
      const msg: Message = {
        id: crypto.randomUUID(),
        role,
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      return msg;
    },
    []
  );

  const callChatAPI = async (
    phase: "ivr" | "l1" | "l2",
    currentMessages: Message[],
    hasIvrContext: boolean = true
  ): Promise<ChatResponse> => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phase,
        messages: currentMessages,
        phoneNumber,
        hasIvrContext,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    return response.json();
  };

  const handlePhoneSubmit = async () => {
    if (!phoneNumber.trim()) return;
    setIsAgentTyping(true);

    try {
      // Check DB for existing competence rating
      const lookupRes = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const lookupData = await lookupRes.json();

      if (lookupData.found) {
        // Known user: skip IVR, route directly
        const nextPhase = lookupData.techCompetence ? "l2" : "l1";
        const tierLabel =
          nextPhase === "l2" ? "Level 2 (Advanced)" : "Level 1 (General)";

        setChatPhase(nextPhase);
        addMessage(
          "system",
          `Welcome back! Routing you directly to ${tierLabel} support...`
        );

        const data = await callChatAPI(nextPhase, [], false);
        addMessage("agent", data.agentMessage);
      } else {
        // Unknown user: normal IVR flow
        setChatPhase("ivr");
        const data = await callChatAPI("ivr", []);
        addMessage("agent", data.agentMessage);
      }
    } catch (error) {
      addMessage("system", "Connection error. Please try again.");
      console.error(error);
    } finally {
      setIsAgentTyping(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isAgentTyping) return;
    if (chatPhase === "phone-entry") return;

    const userMsg = addMessage("user", inputValue.trim());
    setInputValue("");
    setIsAgentTyping(true);

    try {
      const phase = chatPhase as "ivr" | "l1" | "l2";
      const updatedMessages = [...messages, userMsg];

      const data = await callChatAPI(phase, updatedMessages);

      if (data.transition) {
        // IVR is done — add final IVR message, show routing, switch to L1/L2
        const ivrMsg = addMessage("agent", data.agentMessage);
        const tierLabel =
          data.transition.nextPhase === "l2"
            ? "Level 2 (Advanced)"
            : "Level 1 (General)";
        const systemMsg = addMessage(
          "system",
          `Routing to ${tierLabel} support based on your technical profile...`
        );
        setChatPhase(data.transition.nextPhase);

        // Get the L1/L2 agent's opening greeting
        const greetingMessages = [...updatedMessages, ivrMsg, systemMsg];
        const greetingData = await callChatAPI(
          data.transition.nextPhase,
          greetingMessages
        );
        addMessage("agent", greetingData.agentMessage);
      } else {
        addMessage("agent", data.agentMessage);
      }
    } catch (error) {
      addMessage("system", "Sorry, something went wrong. Please try again.");
      console.error(error);
    } finally {
      setIsAgentTyping(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Tech Support</h1>
        <p className="text-sm text-gray-500">Technical assistance portal</p>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        <PhoneInput
          phoneNumber={phoneNumber}
          onPhoneNumberChange={setPhoneNumber}
          onSubmit={handlePhoneSubmit}
          isSubmitted={chatPhase !== "phone-entry"}
        />
        <ChatWindow
          messages={messages}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSendMessage={handleSendMessage}
          isLocked={chatPhase === "phone-entry"}
          isAgentTyping={isAgentTyping}
        />
      </main>
    </div>
  );
}
