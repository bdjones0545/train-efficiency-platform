import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QueryErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function QueryErrorState({
  title = "Something went wrong loading this page.",
  message = "An error occurred while fetching data. Please try again.",
  onRetry,
}: QueryErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-6 text-center space-y-4"
      data-testid="query-error-state"
    >
      <div className="rounded-full bg-destructive/10 p-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      </div>
      <div className="flex gap-3 flex-wrap justify-center">
        {onRetry && (
          <Button variant="default" size="sm" onClick={onRetry} data-testid="button-retry-query">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => (window.location.href = "/")}
          data-testid="button-return-home-query"
        >
          <Home className="h-4 w-4 mr-2" />
          Return Home
        </Button>
      </div>
    </div>
  );
}
