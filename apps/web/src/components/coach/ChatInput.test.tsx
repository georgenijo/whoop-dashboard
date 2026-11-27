import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatInput from "./ChatInput";
import type { PendingChatImage } from "./useChatSend";

afterEach(cleanup);

function pendingImage(index: number): PendingChatImage {
  return {
    id: `pending-${index}`,
    file: new File([String(index)], `${index}.jpg`, { type: "image/jpeg" }),
    previewUrl: `blob:preview-${index}`,
  };
}

function renderInput(
  overrides: Partial<ComponentProps<typeof ChatInput>> = {},
) {
  const props: ComponentProps<typeof ChatInput> = {
    input: "",
    setInput: vi.fn(),
    loading: false,
    modelChanging: false,
    modelPicker: <button type="button">Model picker</button>,
    preparingImages: false,
    pendingImages: [],
    attachmentError: null,
    progressLabel: null,
    inputRef: createRef<HTMLTextAreaElement>(),
    onAddImages: vi.fn(),
    onRemoveImage: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    onKeyDown: vi.fn(),
    ...overrides,
  };
  const rendered = render(<ChatInput {...props} />);
  return { ...rendered, props };
}

describe("ChatInput image attachments", () => {
  it("accepts selected, pasted, and dropped image files", () => {
    const { container, props } = renderInput();
    const selected = new File(["jpeg"], "selected.jpg", {
      type: "image/jpeg",
    });
    const pasted = new File(["png"], "pasted.png", { type: "image/png" });
    const dropped = new File(["webp"], "dropped.webp", {
      type: "image/webp",
    });
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [selected] } });
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => pasted,
          },
        ],
      },
    });
    fireEvent.drop(container.querySelector(".coach-composer")!, {
      dataTransfer: { files: [dropped] },
    });

    expect(props.onAddImages).toHaveBeenNthCalledWith(1, [selected]);
    expect(props.onAddImages).toHaveBeenNthCalledWith(2, [pasted]);
    expect(props.onAddImages).toHaveBeenNthCalledWith(3, [dropped]);
  });

  it("renders previews, removes them accessibly, and enables image-only send", () => {
    const images = [pendingImage(1), pendingImage(2), pendingImage(3)];
    const { props } = renderInput({ pendingImages: images });

    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Attach images" })).toBeDisabled();
    expect(screen.getByText("3 image limit reached")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Images are stored with this thread and sent to your selected Coach provider.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Image analysis can be wrong and isn’t a medical diagnosis.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove selected image 2" }),
    );
    expect(props.onRemoveImage).toHaveBeenCalledWith("pending-2");
  });

  it("shows preparation and validation feedback", () => {
    renderInput({
      loading: true,
      preparingImages: true,
      pendingImages: [pendingImage(1)],
      attachmentError: "You can attach up to 3 images.",
    });

    expect(screen.getByText("Preparing images…")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You can attach up to 3 images.",
    );
  });

  it("keeps the draft editable and turns Send into Stop during an active turn", () => {
    const { props } = renderInput({
      input: "Draft the follow-up",
      loading: true,
    });
    const textbox = screen.getByRole("textbox");

    expect(textbox).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

    fireEvent.change(textbox, { target: { value: "Next question" } });
    expect(props.setInput).toHaveBeenCalledWith("Next question");

    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(props.onKeyDown).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stop reply" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("stops a streaming reply with Escape", () => {
    const { props } = renderInput({ input: "", loading: true });

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(props.onKeyDown).not.toHaveBeenCalled();
  });

  it("stops with Escape while focus is on the Stop button", () => {
    const { props } = renderInput({ loading: true });
    const stop = screen.getByRole("button", { name: "Stop reply" });
    stop.focus();

    fireEvent.keyDown(stop, { key: "Escape" });

    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone and keeps Enter/Shift+Enter behaviour when idle", () => {
    const { props } = renderInput({ input: "How did I sleep?" });
    const textbox = screen.getByRole("textbox");

    fireEvent.keyDown(textbox, { key: "Escape" });
    expect(props.onStop).not.toHaveBeenCalled();

    fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(props.onKeyDown).toHaveBeenCalledTimes(3);
    expect(props.onKeyDown).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ key: "Enter", shiftKey: true }),
    );
  });

  it("never disables the textarea while a model preference saves", () => {
    const { props } = renderInput({
      input: "How did I sleep?",
      modelChanging: true,
    });
    const textbox = screen.getByRole("textbox");

    expect(textbox).toBeEnabled();
    fireEvent.change(textbox, { target: { value: "How did I sleep last night?" } });
    expect(props.setInput).toHaveBeenCalledWith("How did I sleep last night?");
    expect(screen.queryByText("Switching model…")).toBeNull();
    // Sending waits for the save to land so the turn uses the new model.
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("shows live Coach progress without duplicating the work activity mark", () => {
    const { container } = renderInput({
      loading: true,
      progressLabel: "Querying recovery…",
    });

    expect(screen.getByRole("status")).toHaveTextContent("Querying recovery…");
    expect(container.querySelector(".coach-activity-mark")).toBeNull();
  });
});
