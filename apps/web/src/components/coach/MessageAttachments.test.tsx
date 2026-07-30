import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MessageList from "./MessageList";
import type { ComposerMessage } from "./useChatSend";

const messages: ComposerMessage[] = [
  {
    role: "user",
    content: "",
    attachments: [
      {
        id: "first",
        url: "/api/chat/attachments/first",
        mime_type: "image/jpeg",
        width: 800,
        height: 600,
        size_bytes: 100,
      },
      {
        id: "second",
        url: "/api/chat/attachments/second",
        mime_type: "image/jpeg",
        width: 600,
        height: 800,
        size_bytes: 120,
      },
    ],
  },
];

describe("Coach message attachments", () => {
  it("renders authenticated thumbnails in an accessible shared lightbox", () => {
    render(<MessageList messages={messages} />);
    const secondThumbnail = screen.getByRole("button", {
      name: "Open attached image 2 of 2",
    });

    fireEvent.click(secondThumbnail);
    expect(
      screen.getByRole("dialog", { name: "Attached image 2 of 2" }),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Attachment 2 of 2")).toHaveAttribute(
      "src",
      "/api/chat/attachments/second",
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(
      screen.getByRole("dialog", { name: "Attached image 1 of 2" }),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Attachment 1 of 2")).toHaveAttribute(
      "src",
      "/api/chat/attachments/first",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(secondThumbnail).toHaveFocus();
  });
});
