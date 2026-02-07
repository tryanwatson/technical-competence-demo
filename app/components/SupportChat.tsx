"use client";

import { useState } from "react";
import { PhoneInput } from "./PhoneInput";
import { ChatWindow } from "./ChatWindow";

type MessageRole = "user" | "agent" | "system";
type ChatPhase = "phone-entry" | "active" | "resolved";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
}

export function SupportChat() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [chatPhase, setChatPhase] = useState<ChatPhase>("phone-entry");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");

  const addMessage = (role: MessageRole, content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role,
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const handlePhoneSubmit = () => {
    if (!phoneNumber.trim()) return;
    setChatPhase("active");
    addMessage(
      "agent",
      "Hello! Welcome to Tech Support. How can I help you today? Please describe your issue and what you've already tried."
    );
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;
    addMessage("user", inputValue.trim());
    setInputValue("");
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
        />
      </main>
    </div>
  );
}
