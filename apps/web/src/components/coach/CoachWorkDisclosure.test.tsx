import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CoachToolActivity,
  CoachWorkLog,
} from "@/lib/coach/work-log-types";
import CoachWorkDisclosure from "./CoachWorkDisclosure";
import MessageBubble from "./MessageBubble";

afterEach(cleanup);

function tool(
  id: string,
  state: "running" | "complete" = "complete",
): CoachToolActivity {
  return {
    id,
    name: "query_recovery",
    input: { start_date: "2026-07-01" },
    state,
    status: state === "complete" ? "ok" : null,
    duration_ms: state === "complete" ? 42 : null,
    rows: state === "complete" ? 3 : null,
    response: [{ recovery_score: 72 }],
  };
}

function log(
  status: CoachWorkLog["status"],
  tools: CoachToolActivity[] = [],
): CoachWorkLog {
  return {
    version: 1,
    status,
    duration_ms: status === "running" ? null : 8400,
    notes: ["I’ll compare your recent recovery."],
    tools,
  };
}

describe("CoachWorkDisclosure", () => {
  it("starts running turns open and historical completed turns collapsed", async () => {
    const running = render(
      <CoachWorkDisclosure workLog={log("running")} startedAt={Date.now()} />,
    );
    await waitFor(() =>
      expect(running.container.querySelector("details")?.open).toBe(true),
    );
    running.unmount();

    const completed = render(<CoachWorkDisclosure workLog={log("complete")} />);
    expect(completed.container.querySelector("details")?.open).toBe(false);
  });

  it("collapses once on completion and respects a manual live collapse", async () => {
    const { container, rerender } = render(
      <CoachWorkDisclosure workLog={log("running")} startedAt={Date.now()} />,
    );
    const details = container.querySelector("details")!;
    await waitFor(() => expect(details.open).toBe(true));
    details.open = false;
    rerender(
      <CoachWorkDisclosure workLog={log("running")} startedAt={Date.now()} />,
    );
    expect(details.open).toBe(false);

    details.open = true;
    rerender(<CoachWorkDisclosure workLog={log("complete")} />);
    expect(details.open).toBe(false);
  });

  it("shows notes, tool input, and bounded result through nested disclosures", () => {
    const { container } = render(
      <CoachWorkDisclosure workLog={log("complete", [tool("one")])} />,
    );
    const disclosures = container.querySelectorAll("details");
    disclosures[0].open = true;
    expect(screen.getByText("I’ll compare your recent recovery.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Queried recovery"));
    expect(screen.getByText("query_recovery")).toBeInTheDocument();
    expect(screen.getByText(/start_date/)).toBeInTheDocument();
    expect(screen.getByText("72.0")).toBeInTheDocument();
  });

  it("compresses older completed tools while keeping every running tool visible", () => {
    const tools = [
      tool("one"),
      tool("two"),
      tool("three"),
      tool("four"),
      { ...tool("running", "running"), name: "query_sleep" },
    ];
    const { container } = render(
      <CoachWorkDisclosure workLog={log("running", tools)} />,
    );

    expect(screen.getByText("+1 previous tool calls")).toBeInTheDocument();
    expect(screen.getByText("Running query sleep…")).toBeInTheDocument();
    expect(screen.getByText("Querying sleep")).toBeInTheDocument();
    expect(container.querySelector(".coach-tool-state")).not.toBeNull();
  });

  it("uses one animated activity mark and a static current-phase marker", () => {
    const { container } = render(
      <CoachWorkDisclosure workLog={log("running")} startedAt={Date.now()} />,
    );

    expect(container.querySelector(".coach-activity-mark.is-active")).not.toBeNull();
    expect(container.querySelector(".coach-work-step.current")).not.toBeNull();
    expect(container.querySelector(".coach-work-step.running")).toBeNull();
  });

  it("reports no tools for a direct reply", () => {
    render(<CoachWorkDisclosure workLog={log("complete")} />);
    expect(screen.getByText("No tool calls")).toBeInTheDocument();
  });
});

describe("MessageBubble compatibility", () => {
  it("renders old assistant messages without adding a work disclosure", async () => {
    const { container } = render(
      <MessageBubble msg={{ role: "assistant", content: "Historical answer" }} />,
    );
    await screen.findByText("Historical answer");
    expect(container.querySelector(".coach-work-disclosure")).toBeNull();
  });

  it("keeps the final answer outside the completed work disclosure", async () => {
    const { container } = render(
      <MessageBubble
        msg={{
          role: "assistant",
          content: "Final answer",
          workLog: log("complete", [tool("one")]),
        }}
      />,
    );
    const answer = await screen.findByText("Final answer");
    expect(answer.closest("details")).toBeNull();
    expect(container.querySelector(".coach-work-disclosure")).not.toBeNull();
  });
});
