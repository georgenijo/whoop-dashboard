import "server-only";
import type { RunAnthropicOptions } from "./loop";
import { chatLogToolSummaries, type ToolDetail } from "./tools";
import type { CoachToolActivity, CoachWorkLog } from "./work-log-types";

export class CoachWorkLogCollector {
  private textBuffer = "";
  private readonly notes: string[] = [];
  private readonly startedTools: Array<{
    id: string;
    name: string;
    input: unknown;
    stage?: string;
    stage_message?: string;
  }> = [];

  wrap(options: RunAnthropicOptions): RunAnthropicOptions {
    return {
      ...options,
      onTextDelta: (text) => {
        this.textBuffer += text;
        options.onTextDelta?.(text);
      },
      onToolUseStart: (event) => {
        this.flushNote();
        if (!this.startedTools.some((tool) => tool.id === event.id)) {
          this.startedTools.push(event);
        }
        options.onToolUseStart?.(event);
      },
      onToolUseEnd: (event) => options.onToolUseEnd?.(event),
      onToolProgress: (event) => {
        const tool = this.startedTools.find((candidate) => candidate.id === event.id);
        if (tool) {
          tool.stage = event.stage;
          tool.stage_message = event.message;
        }
        options.onToolProgress?.(event);
      },
    };
  }

  complete(durationMs: number, toolDetails: ToolDetail[]): CoachWorkLog {
    const summaries = chatLogToolSummaries(toolDetails);
    const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));
    const orderedIds = [
      ...this.startedTools.map((tool) => tool.id),
      ...summaries
        .map((summary) => summary.id)
        .filter((id) => !this.startedTools.some((tool) => tool.id === id)),
    ];
    const tools = orderedIds.flatMap((id): CoachToolActivity[] => {
      const summary = summaryById.get(id);
      const started = this.startedTools.find((tool) => tool.id === id);
      if (!summary) return [];
      return [
        {
          id: summary.id,
          name: summary.name,
          input: summary.input ?? started?.input ?? {},
          state: "complete",
          status: summary.status,
          duration_ms: summary.duration_ms,
          rows: summary.rows,
          ...(started?.stage ? { stage: started.stage } : {}),
          ...(started?.stage_message
            ? { stage_message: started.stage_message }
            : {}),
          ...(summary.error ? { error: summary.error } : {}),
          ...(summary.response === undefined
            ? {}
            : { response: summary.response }),
        },
      ];
    });
    // The remaining text buffer is the final answer. It deliberately does not
    // become a work-log note.
    return {
      version: 1,
      status: "complete",
      duration_ms: durationMs,
      notes: [...this.notes],
      tools,
    };
  }

  private flushNote(): void {
    const note = this.textBuffer.trim();
    this.textBuffer = "";
    if (!note) return;
    this.notes.push(note);
  }
}
