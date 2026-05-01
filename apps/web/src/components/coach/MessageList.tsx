"use client";

import MessageBubble from "./MessageBubble";
import type { ComposerMessage } from "./useCoachThread";

export default function MessageList({ messages }: { messages: ComposerMessage[] }) {
  return (
    <>
      {messages.map((message, index) => (
        <MessageBubble key={index} msg={message} />
      ))}
    </>
  );
}
