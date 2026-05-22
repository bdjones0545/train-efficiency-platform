import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/authToken";

interface Message {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  chunks?: string[];
}

function StreamingBubble({ content, isStreaming, showThinking }: {
  content: string;
  isStreaming: boolean;
  showThinking: boolean;
}) {
  const prevLenRef = useRef(0);
  const chunksRef = useRef<{ text: string; key: number }[]>([]);
  const keyRef = useRef(0);

  if (content.length > prevLenRef.current) {
    const newText = content.slice(prevLenRef.current);
    chunksRef.current = [...chunksRef.current, { text: newText, key: keyRef.current++ }];
    prevLenRef.current = content.length;
  }

  if (!content && !showThinking && isStreaming) {
    return <span className="chat-cursor" aria-hidden="true" />;
  }

  if (!content && showThinking) {
    return (
      <span className="text-muted-foreground/70 text-xs italic">
        Thinking…
        {isStreaming && <span className="chat-cursor ml-1" aria-hidden="true" />}
      </span>
    );
  }

  return (
    <>
      {chunksRef.current.map((chunk) => (
        <span key={chunk.key} className="chat-token">
          {chunk.text}
        </span>
      ))}
      {isStreaming && <span className="chat-cursor" aria-hidden="true" />}
    </>
  );
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    };
  }, []);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);
    setShowThinking(false);

    const assistantIndex = updatedMessages.length;
    const assistantMessage: Message = { role: "assistant", content: "", isStreaming: true };
    setMessages(prev => [...prev, assistantMessage]);
    setStreamingIndex(assistantIndex);

    thinkingTimerRef.current = setTimeout(() => {
      setShowThinking(true);
    }, 700);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to get response");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let hasStarted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith("data: ")) {
            const data = trimmedLine.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                if (!hasStarted) {
                  hasStarted = true;
                  if (thinkingTimerRef.current) {
                    clearTimeout(thinkingTimerRef.current);
                    thinkingTimerRef.current = null;
                  }
                  setShowThinking(false);
                }
                accumulated += parsed.content;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: accumulated,
                    isStreaming: true,
                  };
                  return updated;
                });
              }
              if (parsed.error) {
                accumulated += `\n\nError: ${parsed.error}`;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[assistantIndex] = {
                    role: "assistant",
                    content: accumulated,
                    isStreaming: true,
                  };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }

      if (!accumulated) {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: "assistant",
            content: "I'm sorry, I couldn't process that request. Please try again.",
            isStreaming: false,
          };
          return updated;
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: "assistant",
            content: accumulated,
            isStreaming: false,
          };
          return updated;
        });
      }
    } catch (error: any) {
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = {
          role: "assistant",
          content: `Sorry, something went wrong: ${error.message}. Please try again.`,
          isStreaming: false,
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
      setStreamingIndex(null);
      setShowThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {isOpen && (
        <div
          data-testid="chat-widget-panel"
          className="fixed left-4 right-4 sm:left-auto sm:w-[380px] z-[9999] flex flex-col h-[520px] max-h-[80vh] rounded-md border bg-background shadow-[0_4px_24px_rgba(0,0,0,0.25)]"
          style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex items-center justify-between gap-2 p-3 border-b bg-primary rounded-t-md">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary-foreground" />
              <span className="font-semibold text-primary-foreground text-sm">
                EST Scheduling Assistant
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-primary-foreground hover:text-primary-foreground/80 no-default-hover-elevate"
              onClick={() => setIsOpen(false)}
              data-testid="button-close-chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <Bot className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-1">
                  Hi! I'm the EST scheduling assistant.
                </p>
                <p className="text-xs text-muted-foreground">
                  I can help you find available sessions, book appointments, check your schedule, and more. What would you like to do?
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              const isActiveStream = msg.isStreaming && streamingIndex === i;
              return (
                <div
                  key={i}
                  className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid={`chat-message-${msg.role}-${i}`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center mt-0.5">
                      <Bot className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed transition-shadow duration-300 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : isActiveStream
                          ? "bg-muted text-foreground chat-bubble-streaming"
                          : "bg-muted text-foreground"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      isActiveStream ? (
                        <StreamingBubble
                          content={msg.content}
                          isStreaming={true}
                          showThinking={showThinking}
                        />
                      ) : (
                        msg.content || <span className="text-muted-foreground/60 text-xs italic">—</span>
                      )
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center mt-0.5">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 border-t">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about sessions, availability..."
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[38px] max-h-[100px]"
                rows={1}
                disabled={isLoading}
                data-testid="input-chat-message"
              />
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                data-testid="button-send-chat"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {isLoading && (
              <p className="text-[10px] text-muted-foreground/60 mt-1.5 pl-0.5 tracking-wide">
                Generating…
              </p>
            )}
          </div>
        </div>
      )}

      <button
        className="fixed right-5 z-[9999] flex items-center justify-center h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-primary text-primary-foreground shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:scale-105 active:scale-95 transition-transform"
        style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={() => setIsOpen(prev => !prev)}
        data-testid="button-toggle-chat"
      >
        {isOpen ? (
          <X className="h-6 w-6 sm:h-7 sm:w-7" />
        ) : (
          <MessageCircle className="h-6 w-6 sm:h-7 sm:w-7" />
        )}
      </button>
    </>
  );
}
