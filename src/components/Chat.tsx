"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Brain, Trash2 } from "lucide-react";
import clsx from "clsx";
import CodeBlock from "./CodeBlock";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  error?: boolean;
  // Feature 7: Mossy's reasoning before the answer, shown collapsed. Never sent back to the
  // backend — streamChat only ever reads {role, content} off a message.
  thinking?: string;
}

type Theme = "dark" | "light" | "ocean" | "shore";

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "ocean", label: "Deep Ocean" },
  { value: "shore", label: "Shoreline" },
];

const MESSAGES_KEY = "mossy:messages";
const THEME_KEY = "mossy:theme";
const TITLE_KEY = "mossy:title"; // Feature 8
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function loadMessages(): Message[] {
  try {
    return JSON.parse(sessionStorage.getItem(MESSAGES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function loadTheme(): Theme {
  const saved = sessionStorage.getItem(THEME_KEY) as Theme | null;
  return THEMES.some((t) => t.value === saved) ? saved! : "dark";
}

function loadTitle(): string | null {
  return sessionStorage.getItem(TITLE_KEY);
}

function newMessage(role: Role, content: string, error = false): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now(), error };
}

// Feature 5: Tools: friendly text shown while Mossy waits for a tool result.
const TOOL_LABELS: Record<string, string> = {
  get_current_time: "Checking the time",
  get_marine_weather: "Checking the waves",
};

// Feature 3 + Feature 7: Streaming: POSTs the history and reads the SSE response as it
// arrives, calling onThinking for reasoning chunks (only sent when think is true), onDelta
// for answer text chunks, and onTool when Mossy starts using a tool.
// (EventSource can't be used: it only supports GET.)
async function streamChat(
  history: { role: Role; content: string }[],
  think: boolean,
  on: { thinking: (text: string) => void; delta: (text: string) => void; tool: (name: string) => void },
) {
  const res = await fetch(`${API_URL}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history, think }),
  });
  // Validation errors (422) etc. come back as a normal JSON response before any streaming.
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : "";
    throw new Error(`Request failed (${res.status}) ${detail}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ""; // text received but not yet split into complete events

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    // { stream: true } keeps multi-byte characters that were split across chunks intact.
    buf += decoder.decode(value, { stream: true });
    // sse-starlette ends lines with \r\n; normalise so we can split on a blank line ("\n\n").
    buf = buf.replace(/\r\n/g, "\n");

    // A network chunk can hold several events or half of one: split on the blank line
    // between events and keep the last (possibly incomplete) piece for the next read.
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";

    for (const ev of events) {
      const name = /^event: (.*)$/m.exec(ev)?.[1]?.trim();
      const data = /^data: (.*)$/m.exec(ev)?.[1];
      if (!data) continue; // keep-alive pings have no data line

      // Feature 7: reasoning arrives before the answer, as its own event type.
      if (name === "thinking") on.thinking(JSON.parse(data).text);
      else if (name === "delta") on.delta(JSON.parse(data).text);
      // Feature 5: the server sends "tool" with the tool's name before running it.
      else if (name === "tool") on.tool(JSON.parse(data).name);
      // The server reports mid-stream failures as an event, not an HTTP status.
      else if (name === "error") throw new Error(JSON.parse(data).message);
      // "done" carries token usage; nothing to do with it yet.
    }
  }
}

// Feature 8: Structured outputs (title and follow-ups)
interface ChatMeta {
  title: string;
  followups: string[];
}

// A small side call made after a reply finishes, never while it streams. If it fails for
// any reason (network, a non-200), this just returns null and the UI keeps whatever title
// and follow-ups it already had — a broken title call should never break the chat.
async function fetchMeta(history: { role: Role; content: string }[]): Promise<ChatMeta | null> {
  try {
    const res = await fetch(`${API_URL}/chat/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    return res.ok ? ((await res.json()) as ChatMeta) : null;
  } catch {
    return null;
  }
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [think, setThink] = useState(false); // Feature 7: "Think harder" toggle
  const [title, setTitle] = useState<string | null>(loadTitle); // Feature 8
  const [followups, setFollowups] = useState<string[]>([]); // Feature 8
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Save only when no reply is streaming, so a half-written answer is never stored.
    if (!loading) sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    sessionStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Feature 8: keeps the title in session storage and the browser tab in sync.
  useEffect(() => {
    if (title) sessionStorage.setItem(TITLE_KEY, title);
    document.title = title ? `${title} · Mossy` : "Mossy";
  }, [title]);

  function clearChat() {
    setMessages([]);
    setTitle(null);
    setFollowups([]);
    sessionStorage.removeItem(TITLE_KEY);
  }

  // Shared by the form submit and by clicking a follow-up suggestion.
  async function sendText(text: string) {
    if (!text || loading) return;
    setFollowups([]); // this turn's suggestions are about to be replaced

    const userMsg = newMessage("user", text);
    // Feature 1: Multi-turn history: Claude has no memory, so the whole chat is sent each time.
    // Error bubbles are UI-only, and empty ones would fail the backend's min_length check.
    const history = [...messages, userMsg]
      .filter((m) => !m.error && m.content)
      .map(({ role, content }) => ({ role, content }));

    // Push an empty assistant bubble now; each streamed chunk is appended to it by id.
    const botMsg = newMessage("assistant", "");
    setMessages((prev) => [...prev, userMsg, botMsg]);
    setLoading(true);

    let replyText = ""; // mirrors botMsg.content locally, since state updates are async

    try {
      await streamChat(history, think, {
        thinking: (chunk) => {
          setToolStatus(null);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMsg.id ? { ...m, thinking: (m.thinking ?? "") + chunk } : m,
            ),
          );
        },
        delta: (chunk) => {
          setToolStatus(null);
          replyText += chunk;
          // Immutable update: copy the array and replace only the streaming message.
          setMessages((prev) =>
            prev.map((m) => (m.id === botMsg.id ? { ...m, content: m.content + chunk } : m)),
          );
        },
        tool: (name) => setToolStatus(TOOL_LABELS[name] ?? `Using ${name}`),
      });

      // Feature 8: fire-and-forget. Never awaited, so a slow or failed title call can't
      // delay re-enabling the input below. Title is set only once per conversation;
      // follow-ups are replaced after every reply.
      if (replyText) {
        fetchMeta([...history, { role: "assistant", content: replyText }]).then((meta) => {
          if (!meta) return;
          setTitle((prev) => prev ?? meta.title);
          setFollowups(meta.followups ?? []);
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      // Fill the existing bubble (keeping any partial text) instead of adding a second one.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMsg.id
            ? {
                ...m,
                error: true,
                content: `${m.content}${m.content ? "\n\n" : ""}Sorry, I couldn't reach the server. ${reason}`,
              }
            : m,
        ),
      );
    } finally {
      setLoading(false);
      setToolStatus(null);
      inputRef.current?.focus();
    }
  }

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return; // guard here too, so a draft isn't cleared while busy
    setInput("");
    sendText(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-bg text-text">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Image src="/logo.png" alt="Mossy" width={32} height={32} priority className="shrink-0" />
          <span className="shrink-0 text-base font-semibold tracking-tight">Mossy</span>
          {/* Feature 8: the conversation's title, once Claude has made one. */}
          {title && <span className="truncate text-sm text-muted">· {title}</span>}
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={clearChat}
            disabled={messages.length === 0}
            aria-label="Clear chat"
            title="Clear chat"
            className="rounded-md p-2 text-muted transition-colors hover:text-text disabled:opacity-40"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
          {messages.length === 0 && !loading && (
            <div className="mt-[18vh] flex flex-col items-center gap-3 text-center">
              <Image src="/logo.png" alt="" width={88} height={88} />
              <h1 className="text-xl font-semibold">Hi, I&apos;m Mossy</h1>
              <p className="text-sm text-muted">Ask me anything to get started.</p>
            </div>
          )}

          {messages.map((m) =>
            // The empty streaming bubble stays hidden until thinking or an answer arrives;
            // the typing dots below stand in for it.
            m.role === "assistant" && !m.content && !m.thinking ? null : m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-[15px] text-accent-fg">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex items-start gap-3">
                <Image src="/logo.png" alt="Mossy" width={28} height={28} className="mt-1 shrink-0" />
                <div
                  className={clsx(
                    "markdown min-w-0 max-w-[80%] rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-[15px] leading-relaxed",
                    m.error && "text-red-400",
                  )}
                >
                  {/* Feature 7: Mossy's reasoning, closed by default, above its answer. */}
                  {m.thinking && (
                    <details className="mb-2 text-sm text-muted">
                      <summary className="cursor-pointer select-none hover:text-text">
                        Mossy&apos;s thinking
                      </summary>
                      <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-2.5">
                        {m.thinking}
                      </p>
                    </details>
                  )}
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // CodeBlock renders its own wrapper, so drop the default <pre>.
                      pre: ({ children }) => <>{children}</>,
                      code: ({ className, children }) => {
                        const text = String(children).replace(/\n$/, "");
                        const language = /language-(\S+)/.exec(className ?? "")?.[1] ?? "";
                        if (!language && !text.includes("\n")) return <code>{children}</code>;
                        return (
                          <CodeBlock
                            language={language}
                            code={text}
                            dark={theme === "dark" || theme === "ocean"}
                          />
                        );
                      },
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              </div>
            ),
          )}

          {/* Typing dots before thinking or the first words arrive, and again (with a
              label) while a tool runs. */}
          {loading &&
            (toolStatus ||
              (!messages[messages.length - 1]?.content && !messages[messages.length - 1]?.thinking)) && (
            <div className="flex items-start gap-3">
              <Image src="/logo.png" alt="Mossy" width={28} height={28} className="mt-1 shrink-0" />
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-surface px-4 py-4">
                {toolStatus && <span className="mr-2 text-sm text-muted">{toolStatus}…</span>}
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Feature 8: clickable follow-up questions suggested after Mossy's last reply. */}
          {!loading && followups.length > 0 && (
            <div className="ml-10 flex flex-wrap gap-2">
              {followups.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendText(q)}
                  className="rounded-full border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-text"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="border-t border-border bg-surface px-4 py-3">
        <div className="mx-auto mb-2 flex w-full max-w-3xl">
          {/* Feature 7: toggle sent as "think" on every request. */}
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-muted hover:text-text">
            <input
              type="checkbox"
              checked={think}
              onChange={(e) => setThink(e.target.checked)}
              className="accent-accent"
            />
            <Brain size={14} />
            Think harder
          </label>
        </div>
        <form onSubmit={send} className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            autoFocus
            placeholder="Message Mossy…"
            className="field-sizing-content max-h-40 flex-1 resize-none rounded-xl border border-border bg-bg px-4 py-2.5 text-[15px] outline-none placeholder:text-muted focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp size={18} />
          </button>
        </form>
      </footer>
    </div>
  );
}
