"use client";

import { type RefObject } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { type ComposerMessage, formatToolProgressLabel } from "@/components/coach/useChatSend";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
function toRoman(n: number): string {
  return ROMAN[n % ROMAN.length] ?? String(n + 1);
}

function renderMarkdownWithLede(content: string): string {
  const html = DOMPurify.sanitize(marked.parse(content) as string);
  return html.replace(/^(\s*<p>)/, '<p class="lede">');
}

function isoDate(iso: string): string {
  try {
    return iso.slice(0, 10);
  } catch {
    return "";
  }
}

function formatTime(iso: string): string {
  try {
    return iso.slice(11, 16);
  } catch {
    return "";
  }
}

function DayMarker({ label, roman }: { label: string; roman: string }) {
  return (
    <div className="atelier-day-marker">
      <span className="atelier-day-roman">{roman}</span>
      <span>{label}</span>
    </div>
  );
}

type Props = {
  messages: ComposerMessage[];
  bottomRef: RefObject<HTMLDivElement | null>;
  threadLabel?: string;
};

export default function ChatStream({ messages, bottomRef, threadLabel = "Coach" }: Props) {
  let aiIndex = 0;
  let lastDate = "";

  return (
    <div className="atelier-chat-stream">
      {messages.length === 0 && (
        <div className="atelier-chat-empty">
          <span className="atelier-chat-empty-mark">Coach</span>
          <div className="atelier-chat-empty-title">Ask anything about your health data</div>
        </div>
      )}
      {messages.map((msg, i) => {
        const ts = (msg as ComposerMessage & { created_at?: string }).created_at ?? "";
        const date = ts ? isoDate(ts) : "";
        const showDay = date && date !== lastDate;
        if (date) lastDate = date;

        if (msg.role === "user") {
          return (
            <div key={i}>
              {showDay && <DayMarker label={date} roman={toRoman(i)} />}
              <div className="atelier-msg user">
                <div className="atelier-msg-who">
                  {ts && <span className="atelier-msg-ts">{formatTime(ts)}</span>}
                  <span>You</span>
                  <span className="atelier-msg-plate">MSG. {i + 1}</span>
                </div>
                <div className="atelier-bubble">{msg.content}</div>
              </div>
            </div>
          );
        }

        const idx = aiIndex++;
        const progressLabel = formatToolProgressLabel(msg.progress);

        return (
          <div key={i}>
            {showDay && <DayMarker label={date} roman={toRoman(i)} />}
            <div className="atelier-msg ai">
              <article className="atelier-ed-card">
                <span className="bk-bl" />
                <span className="bk-br" />
                <div className="atelier-plate-strip">
                  <div className="atelier-plate-strip-left">
                    <span className="atelier-plate-roman">{toRoman(idx)}</span>
                    <span>FIG. {idx + 1} / {threadLabel}</span>
                  </div>
                  <span className="atelier-plate-author">Coach · Sonnet 4.6</span>
                </div>
                {msg.streaming && msg.content === "" && progressLabel ? (
                  <div className="atelier-tool-progress running">
                    <span className="atelier-tool-dot" />
                    <span>{progressLabel}</span>
                  </div>
                ) : msg.streaming && msg.content === "" ? (
                  <div className="atelier-thinking">Composing reply...</div>
                ) : (
                  <>
                    <div
                      className="atelier-ed-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownWithLede(msg.content) }}
                    />
                    {msg.streaming && progressLabel && (
                      <div className="atelier-tool-progress running">
                        <span className="atelier-tool-dot" />
                        <span>{progressLabel}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="atelier-ann">
                  <span className="atelier-fin">— fin.</span>
                </div>
              </article>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
