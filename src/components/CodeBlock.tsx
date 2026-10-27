"use client";

import { useState } from "react";
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  language: string;
  code: string;
  dark: boolean;
}

export default function CodeBlock({ language, code, dark }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-bg px-3 py-1.5 text-xs text-muted">
        <span className="font-mono">{language || "text"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="flex items-center gap-1 transition-colors hover:text-text"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={dark ? oneDark : oneLight}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: "0.85em", padding: "0.75rem" }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
