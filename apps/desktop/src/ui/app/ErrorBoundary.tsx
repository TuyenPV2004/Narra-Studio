import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      "Source renderer component failure",
      error,
      info.componentStack,
    );
  }
  render() {
    if (this.state.error) {
      return (
        <main className="source-error" role="alert">
          <h1>Không thể hiển thị giao diện</h1>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Tải lại
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
