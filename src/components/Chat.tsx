"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Trash2 } from "lucide-react";
import clsx from "clsx";
import CodeBlock from "./CodeBlock";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  error?: boolean;
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

function newMessage(role: Role, content: string, error = false): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now(), error };
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    sessionStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = newMessage("user", text);
    // Error bubbles are UI-only; never send them to the model.
    const history = [...messages, userMsg]
      .filter((m) => !m.error)
      .map(({ role, content }) => ({ role, content }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = typeof body?.detail === "string" ? body.detail : "";
        throw new Error(`Request failed (${res.status}) ${detail}`.trim());
      }
      const data: { reply: string } = await res.json();
      setMessages((prev) => [...prev, newMessage("assistant", data.reply)]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        newMessage("assistant", `Sorry, I couldn't reach the server. ${reason}`, true),
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
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
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Mossy" width={32} height={32} priority />
          <span className="text-base font-semibold tracking-tight">Mossy</span>
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
            onClick={() => setMessages([])}
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
            m.role === "user" ? (
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

          {loading && (
            <div className="flex items-start gap-3">
              <Image src="/logo.png" alt="Mossy" width={28} height={28} className="mt-1 shrink-0" />
              <div className="flex gap-1 rounded-2xl rounded-tl-sm bg-surface px-4 py-4">
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
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="border-t border-border bg-surface px-4 py-3">
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
