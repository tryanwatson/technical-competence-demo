"use client";

import { useState, useRef, useCallback } from "react";

type CallStatus = "idle" | "connecting" | "connected" | "routing" | "ended";
type AgentPhase = "ivr" | "l1" | "l2";

interface ConnectOptions {
  hasIvrContext?: boolean;
  category?: string;
  summary?: string;
}

const AGENT_LABELS: Record<AgentPhase, string> = {
  ivr: "IVR",
  l1: "Jim - Level 1",
  l2: "Kat - Level 2",
};

export function VoiceSupport() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [currentAgent, setCurrentAgent] = useState<AgentPhase | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routingLabel, setRoutingLabel] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringbackRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    dcRef.current = null;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, []);

  const connectSession = useCallback(
    async (phase: AgentPhase, options: ConnectOptions = {}) => {
      // Clean up any existing connection
      cleanup();

      // Get microphone
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError(
          "Microphone access is required for voice support. Please allow microphone access and try again."
        );
        setCallStatus("idle");
        return;
      }
      localStreamRef.current = stream;

      // Create peer connection with STUN server for NAT traversal
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      // Connection logging for debugging
      pc.onconnectionstatechange = () =>
        console.log("pc state:", pc.connectionState);
      pc.oniceconnectionstatechange = () =>
        console.log("ice state:", pc.iceConnectionState);

      // Set up remote audio playback via DOM-attached element
      pc.ontrack = (e) => {
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
        }
      };

      // Add local audio track
      pc.addTrack(stream.getTracks()[0], stream);

      // Apply mute state
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !isMuted;
      });

      // Create data channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener("open", () => {
        // If muted, disable VAD on the new session so silence doesn't
        // get interpreted as speech input
        if (isMuted) {
          dc.send(
            JSON.stringify({ type: "input_audio_buffer.clear" })
          );
          dc.send(
            JSON.stringify({
              type: "session.update",
              session: { turn_detection: null },
            })
          );
        }
        // Trigger the model to speak first (generate initial greeting)
        dc.send(JSON.stringify({ type: "response.create" }));
      });

      dc.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data);
          handleDataChannelMessage(event);
        } catch {
          // ignore non-JSON messages
        }
      });

      // Create SDP offer and wait for ICE gathering to complete
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const onState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", onState);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", onState);
      });

      const sdpOffer = pc.localDescription!.sdp;

      // Build query params
      const params = new URLSearchParams({ phase, phoneNumber });
      if (options.hasIvrContext === false) {
        params.set("hasIvrContext", "false");
      }
      if (options.category) {
        params.set("category", options.category);
      }
      if (options.summary) {
        params.set("summary", options.summary);
      }

      // 1. Get ephemeral token from our server (session config baked in)
      const tokenResponse = await fetch(
        `/api/voice/session?${params.toString()}`,
        { method: "POST" }
      );

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Session creation failed: ${tokenResponse.status}`
        );
      }

      const tokenData = await tokenResponse.json();
      const ephemeralKey =
        tokenData.value ?? tokenData.client_secret?.value;
      if (!ephemeralKey) {
        throw new Error("Failed to get ephemeral key");
      }

      // 2. Connect directly to OpenAI with the ephemeral token
      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          body: sdpOffer,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        }
      );

      if (!sdpResponse.ok) {
        throw new Error(`WebRTC connection failed: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setCurrentAgent(phase);
      setCallStatus("connected");
      setError(null);
    },
    [phoneNumber, isMuted, cleanup]
  );

  const handleTransition = useCallback(
    async (category: string, summary: string) => {
      const nextPhase: AgentPhase = category === "technical" ? "l2" : "l1";
      const tierLabel =
        nextPhase === "l2" ? "Level 2 (Advanced)" : "Level 1 (General)";

      setCallStatus("routing");
      setRoutingLabel(tierLabel);
      cleanup();

      // Brief pause so user sees the routing message
      await new Promise((resolve) => setTimeout(resolve, 1500));

      try {
        await connectSession(nextPhase, {
          hasIvrContext: true,
          category,
          summary,
        });
      } catch (err) {
        console.error("Transition error:", err);
        setError("Failed to connect to support agent. Please try again.");
        setCallStatus("ended");
      }
    },
    [cleanup, connectSession]
  );

  const handleDataChannelMessage = useCallback(
    (event: { type: string; name?: string; arguments?: string; call_id?: string }) => {
      if (
        event.type === "response.function_call_arguments.done" &&
        event.name === "route_caller"
      ) {
        try {
          const args = JSON.parse(event.arguments || "{}");
          handleTransition(
            args.category || "non-technical",
            args.summary || ""
          );
        } catch {
          handleTransition("non-technical", "");
        }
      }
    },
    [handleTransition]
  );

  const handleCall = async () => {
    if (!phoneNumber.trim()) return;
    setCallStatus("connecting");
    setError(null);

    try {
      // Check DB for existing competence rating
      const lookupRes = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const lookupData = await lookupRes.json();

      if (lookupData.found) {
        const nextPhase: AgentPhase = lookupData.techCompetence ? "l2" : "l1";
        const tierLabel =
          nextPhase === "l2" ? "Level 2 (Advanced)" : "Level 1 (General)";
        setRoutingLabel(tierLabel);
        setCallStatus("routing");

        // Brief pause to show "Welcome back" message
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await connectSession(nextPhase, { hasIvrContext: false });
      } else {
        await connectSession("ivr");
      }
    } catch (err) {
      console.error("Call error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to start call. Please try again."
      );
      setCallStatus("idle");
    }
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !newMuted;
    });

    // Disable/enable server-side VAD to prevent silence frames from
    // being interpreted as speech attempts and interrupting the bot.
    if (dcRef.current?.readyState === "open") {
      if (newMuted) {
        dcRef.current.send(
          JSON.stringify({ type: "input_audio_buffer.clear" })
        );
        dcRef.current.send(
          JSON.stringify({
            type: "session.update",
            session: { turn_detection: null },
          })
        );
      } else {
        dcRef.current.send(
          JSON.stringify({
            type: "session.update",
            session: { turn_detection: { type: "server_vad" } },
          })
        );
      }
    }
  };

  const handleHangUp = () => {
    cleanup();
    setCallStatus("ended");
    setCurrentAgent(null);
  };

  const handleNewCall = () => {
    setCallStatus("idle");
    setPhoneNumber("");
    setCurrentAgent(null);
    setError(null);
    setRoutingLabel("");
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">Tech Support</h1>
        <p className="text-sm text-gray-500">Voice assistance portal</p>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        {/* Phone Input */}
        {callStatus === "idle" && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Enter your phone number to begin
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCall();
              }}
              className="flex gap-3"
            >
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="(555) 123-4567"
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="submit"
                disabled={!phoneNumber.trim()}
                className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Call
              </button>
            </form>
          </div>
        )}

        {/* Connected phone display */}
        {callStatus !== "idle" && callStatus !== "ended" && (
          <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 text-green-600"
              >
                <path
                  fillRule="evenodd"
                  d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-800">In Call</p>
              <p className="text-xs text-green-600">{phoneNumber}</p>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Call status card */}
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {callStatus === "idle" && !error && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-8 w-8 text-gray-400"
                >
                  <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
                  <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">
                Enter your phone number above and click Call to start a voice
                support session.
              </p>
            </div>
          )}

          {callStatus === "connecting" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
                <svg
                  className="h-8 w-8 animate-spin text-blue-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">
                Connecting...
              </p>
            </div>
          )}

          {callStatus === "routing" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
                <svg
                  className="h-8 w-8 animate-spin text-blue-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">
                Routing to {routingLabel} support...
              </p>
            </div>
          )}

          {callStatus === "connected" && currentAgent && (
            <div className="flex w-full flex-col items-center gap-6">
              {/* Pulsing indicator */}
              <div className="relative">
                <div className="absolute inset-0 animate-ping rounded-full bg-green-400 opacity-20" />
                <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-10 w-10 text-green-600"
                  >
                    <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
                    <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
                  </svg>
                </div>
              </div>

              {/* Agent label */}
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">
                  {AGENT_LABELS[currentAgent]}
                </p>
                <p className="text-sm text-gray-500">
                  {currentAgent === "ivr"
                    ? "Gathering information"
                    : "Technical support"}
                </p>
              </div>

              {/* Controls */}
              <div className="flex gap-4">
                <button
                  onClick={toggleMute}
                  className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                    isMuted
                      ? "bg-red-100 text-red-600 hover:bg-red-200"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-6 w-6"
                    >
                      <path d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l18 18a.75.75 0 1 0 1.06-1.06l-18-18ZM20.57 16.476c.223-.264.16-.656-.126-.85a11.842 11.842 0 0 0-2.37-1.393c-.3-.13-.637-.017-.831.238a7.464 7.464 0 0 1-1.676 1.709L20.57 16.476ZM6.269 9.269l1.26 1.26a3.75 3.75 0 0 0 4.94 4.94l1.26 1.26a5.25 5.25 0 0 1-7.46-7.46Z" />
                      <path d="M8.25 4.5a3.75 3.75 0 0 1 7.5 0v4.402L8.25 1.05V4.5Z" />
                      <path d="M17.25 11.25a.75.75 0 0 1 .75.75v.75a6.75 6.75 0 0 1-.553 2.678l-1.17-1.17c.144-.423.223-.88.223-1.358V12a.75.75 0 0 1 .75-.75ZM6.75 12a.75.75 0 0 0-1.5 0v.75a8.25 8.25 0 0 0 7.5 8.218V22.5h-3a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5h-3v-1.532a8.25 8.25 0 0 0 4.835-2.349l-1.065-1.065A6.75 6.75 0 0 1 6.75 12.75V12Z" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-6 w-6"
                    >
                      <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" />
                      <path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={handleHangUp}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"
                  title="End call"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-6 w-6"
                  >
                    <path
                      fillRule="evenodd"
                      d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 0 0 6.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {callStatus === "ended" && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-8 w-8 text-gray-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 0 0 6.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <p className="mb-4 text-sm font-medium text-gray-700">
                Call ended
              </p>
              <button
                onClick={handleNewCall}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                New Call
              </button>
            </div>
          )}
        </div>
      </main>
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </div>
  );
}
