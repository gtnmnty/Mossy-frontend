"use client";

import dynamic from "next/dynamic";

// Chat reads sessionStorage on first render, so it must only render in the browser.
const Chat = dynamic(() => import("./Chat"), { ssr: false });

export default function ChatLoader() {
  return <Chat />;
}
