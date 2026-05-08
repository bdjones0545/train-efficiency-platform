import { useState, useRef, useCallback, useEffect } from "react";
import { voiceSoundCues } from "@/lib/voice-sound-cues";

export type VoiceState = "idle" | "listening" | "push-to-talk" | "error";

const WORD_TO_NUMBER: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
};

function normalizeSpokenNumbers(text: string): string {
  return text.replace(/\b([a-z]+)\b/gi, (match) => {
    const lower = match.toLowerCase();
    return WORD_TO_NUMBER[lower] ?? match;
  });
}

function getSpeechRecognition(): SpeechRecognition | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  return new SR() as SpeechRecognition;
}

export interface UseBusinessAgentVoiceOptions {
  onSubmit: (message: string) => void;
  isAgentResponding: boolean;
  disabled?: boolean;
}

export interface UseBusinessAgentVoiceReturn {
  voiceState: VoiceState;
  voiceError: string | null;
  transcript: string;
  isSupported: boolean;
  handleMicClick: () => void;
  handleMicPointerDown: (e: React.PointerEvent) => void;
  handleMicPointerUp: (e: React.PointerEvent) => void;
  handleMicPointerLeave: (e: React.PointerEvent) => void;
  stopListening: () => void;
}

export function useBusinessAgentVoice({
  onSubmit,
  isAgentResponding,
  disabled = false,
}: UseBusinessAgentVoiceOptions): UseBusinessAgentVoiceReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPttActiveRef = useRef(false);
  const currentTranscriptRef = useRef("");
  const isMountedRef = useRef(true);
  const isListeningRef = useRef(false);

  const isSupported = !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopListening();
    };
  }, []);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    isPttActiveRef.current = false;
    if (pttTimerRef.current) {
      clearTimeout(pttTimerRef.current);
      pttTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    if (isMountedRef.current) {
      setVoiceState("idle");
      setTranscript("");
      currentTranscriptRef.current = "";
    }
    voiceSoundCues.stop();
  }, []);

  const startListening = useCallback((mode: "tap" | "ptt") => {
    if (disabled || isAgentResponding || !isSupported) return;

    const rec = getSpeechRecognition();
    if (!rec) {
      setVoiceError("Speech recognition is not supported in this browser.");
      setVoiceState("error");
      voiceSoundCues.error();
      return;
    }

    recognitionRef.current = rec;
    rec.continuous = mode === "tap";
    rec.interimResults = true;
    rec.lang = "en-US";
    isListeningRef.current = true;
    currentTranscriptRef.current = "";

    rec.onstart = () => {
      if (!isMountedRef.current) return;
      setVoiceState(mode === "ptt" ? "push-to-talk" : "listening");
      setVoiceError(null);
      voiceSoundCues.start();
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      if (!isMountedRef.current) return;
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          final += res[0].transcript;
        } else {
          interim += res[0].transcript;
        }
      }
      if (final) {
        currentTranscriptRef.current += final;
      }
      const display = normalizeSpokenNumbers(currentTranscriptRef.current + interim);
      setTranscript(display);
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (!isMountedRef.current) return;
      isListeningRef.current = false;
      if (event.error === "aborted") {
        setVoiceState("idle");
        setTranscript("");
        currentTranscriptRef.current = "";
        return;
      }
      let msg = "Voice recognition error.";
      if (event.error === "not-allowed" || event.error === "permission-denied") {
        msg = "Microphone permission denied. Please allow access and try again.";
      } else if (event.error === "no-speech") {
        msg = "No speech detected. Please try again.";
      } else if (event.error === "network") {
        msg = "Network error during voice recognition.";
      }
      setVoiceError(msg);
      setVoiceState("error");
      setTranscript("");
      currentTranscriptRef.current = "";
      voiceSoundCues.error();
    };

    rec.onend = () => {
      if (!isMountedRef.current) return;
      if (isPttActiveRef.current && isListeningRef.current) {
        const text = normalizeSpokenNumbers(currentTranscriptRef.current.trim());
        if (text && !isAgentResponding) {
          console.log("[TrainEfficiency Voice Agent Submit]", {
            source: "push-to-talk",
            message: text,
            mode: "ptt",
            route: "/api/scheduling-agent/chat",
          });
          voiceSoundCues.submit();
          isListeningRef.current = false;
          isPttActiveRef.current = false;
          setVoiceState("idle");
          setTranscript("");
          currentTranscriptRef.current = "";
          onSubmit(text);
        } else {
          setVoiceState("idle");
          setTranscript("");
          currentTranscriptRef.current = "";
        }
      } else if (isListeningRef.current) {
        setVoiceState("idle");
      }
    };

    try {
      rec.start();
    } catch {
      setVoiceError("Could not start voice recognition.");
      setVoiceState("error");
      voiceSoundCues.error();
    }
  }, [disabled, isAgentResponding, isSupported, onSubmit]);

  const handleMicClick = useCallback(() => {
    if (disabled || isAgentResponding || !isSupported) return;
    if (voiceState === "listening") {
      const text = normalizeSpokenNumbers(currentTranscriptRef.current.trim());
      stopListening();
      if (text) {
        console.log("[TrainEfficiency Voice Agent Submit]", {
          source: "tap-to-dictate",
          message: text,
          mode: "tap",
          route: "/api/scheduling-agent/chat",
        });
        voiceSoundCues.submit();
        onSubmit(text);
      }
      return;
    }
    if (voiceState === "idle" || voiceState === "error") {
      setVoiceError(null);
      startListening("tap");
    }
  }, [disabled, isAgentResponding, isSupported, voiceState, stopListening, startListening, onSubmit]);

  const handleMicPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || isAgentResponding || !isSupported) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pttTimerRef.current = setTimeout(() => {
      isPttActiveRef.current = true;
      stopListening();
      setTimeout(() => startListening("ptt"), 50);
    }, 350);
  }, [disabled, isAgentResponding, isSupported, stopListening, startListening]);

  const handleMicPointerUp = useCallback((_e: React.PointerEvent) => {
    if (pttTimerRef.current) {
      clearTimeout(pttTimerRef.current);
      pttTimerRef.current = null;
    }
    if (isPttActiveRef.current) {
      if (recognitionRef.current && isListeningRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      } else {
        isPttActiveRef.current = false;
        setVoiceState("idle");
      }
    }
  }, []);

  const handleMicPointerLeave = useCallback((_e: React.PointerEvent) => {
    if (pttTimerRef.current) {
      clearTimeout(pttTimerRef.current);
      pttTimerRef.current = null;
    }
    if (isPttActiveRef.current) {
      if (recognitionRef.current && isListeningRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      } else {
        isPttActiveRef.current = false;
        setVoiceState("idle");
      }
    }
  }, []);

  return {
    voiceState,
    voiceError,
    transcript,
    isSupported,
    handleMicClick,
    handleMicPointerDown,
    handleMicPointerUp,
    handleMicPointerLeave,
    stopListening,
  };
}
