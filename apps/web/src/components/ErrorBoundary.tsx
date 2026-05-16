"use client";

import { Component, type ReactNode } from "react";
import { clog } from "@/lib/clog";

// Issue #389 — React render error boundary. Surfaces a minimal fallback UI
// and pipes the error + componentStack to client_logs via clog.error so the
// /logs page picks it up.

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown, info: { componentStack?: string | null }): void {
    clog.error(err instanceof Error ? err.message : String(err), {
      stack: err instanceof Error ? err.stack : undefined,
      componentStack: info.componentStack ?? null,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          padding: "32px",
          color: "#f8fafc",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h2 style={{ marginBottom: "8px" }}>Something broke.</h2>
        <p style={{ opacity: 0.7, marginBottom: "16px" }}>
          {this.state.message ?? "An unexpected error occurred."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1px solid #334155",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
