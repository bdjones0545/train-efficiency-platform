import { Component } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface PageErrorBoundaryProps {
  children: React.ReactNode;
  pageName?: string;
}

interface PageErrorBoundaryState {
  hasError: boolean;
  errorMessage?: string;
}

export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  constructor(props: PageErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { hasError: true, errorMessage: error?.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const route = window.location.pathname;
    console.error(
      `[PageErrorBoundary] *** CRASH on route "${route}"${this.props.pageName ? ` (${this.props.pageName})` : ""}:`,
      error
    );
    console.error("[PageErrorBoundary] Full component stack:", info.componentStack);

    // POST to server so crashes are visible in the reliability dashboard
    try {
      fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: "PageErrorBoundary",
          message: error?.message ?? String(error),
          stack: (error?.stack ?? "") + "\n\n--- Component Stack ---\n" + (info?.componentStack ?? ""),
          route,
          source: this.props.pageName ?? route,
          userAgent: navigator.userAgent,
        }),
      }).catch(() => {});
    } catch {
      // never throw from error boundary
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center space-y-4"
          data-testid="page-error-boundary"
        >
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="h-9 w-9 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-foreground">
              Something went wrong loading this page.
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              A rendering error occurred. Try reloading — if the problem persists, return to the home screen.
            </p>
            {this.state.errorMessage && (
              <p className="text-xs font-mono text-muted-foreground/70 max-w-sm mx-auto break-words" data-testid="text-error-message">
                {this.state.errorMessage}
              </p>
            )}
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <button
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: undefined });
                window.location.reload();
              }}
              data-testid="button-error-boundary-reload"
            >
              <RefreshCw className="h-4 w-4" />
              Reload page
            </button>
            <button
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-input bg-background text-foreground text-sm font-medium hover:bg-muted transition-colors"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: undefined });
                window.location.href = "/";
              }}
              data-testid="button-error-boundary-home"
            >
              <Home className="h-4 w-4" />
              Return home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
