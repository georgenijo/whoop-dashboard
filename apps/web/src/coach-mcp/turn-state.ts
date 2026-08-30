import { readFile } from "node:fs/promises";
import {
  newToolTurnState,
  type ToolTurnState,
} from "@/lib/coach/tool-turn-state";

/**
 * Keeps write guards scoped to a Coach turn even when Cursor keeps this MCP
 * process alive for an entire ACP session. The epoch file is written by the
 * parent app and is never supplied by model-authored tool input.
 */
export class CoachMcpTurnState {
  private epoch: string | null = null;
  private state: ToolTurnState = newToolTurnState();
  private refreshTail = Promise.resolve();

  constructor(private readonly epochPath: string) {}

  async current(): Promise<ToolTurnState> {
    return (await this.currentContext()).state;
  }

  async currentContext(): Promise<{
    epoch: string;
    state: ToolTurnState;
  }> {
    const previous = this.refreshTail;
    let release: (() => void) | undefined;
    this.refreshTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const state = await this.currentUnlocked();
      return { epoch: this.epoch ?? "unscoped", state };
    } finally {
      release?.();
    }
  }

  private async currentUnlocked(): Promise<ToolTurnState> {
    if (!this.epochPath) return this.state;

    const nextEpoch = (await readFile(this.epochPath, "utf8")).trim();
    if (!nextEpoch || nextEpoch.length > 200) {
      throw new Error("Coach turn epoch is missing or invalid");
    }
    if (nextEpoch !== this.epoch) {
      this.epoch = nextEpoch;
      this.state = newToolTurnState();
    }
    return this.state;
  }
}
