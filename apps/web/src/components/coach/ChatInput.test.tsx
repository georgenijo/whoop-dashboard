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
    preparingImages: false,
    pendingImages: [],
    attachmentError: null,
    progressLabel: null,
    inputRef: createRef<HTMLTextAreaElement>(),
    onAddImages: vi.fn(),
    onRemoveImage: vi.fn(),
    onSubmit: vi.fn(),
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

  it("blocks composer actions while the model preference is changing", () => {
    renderInput({
      input: "How did I sleep?",
      modelChanging: true,
    });

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attach images" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.getByText("Switching model…")).toBeInTheDocument();
  });
});
