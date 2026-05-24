/**
 * Workspace Mode Toggle — Phase 7
 * Renders a compact toggle for switching between Simplified and Advanced modes.
 */

import { useWorkspaceMode } from "@/lib/workspace-mode";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sliders, Sparkles } from "lucide-react";

export function WorkspaceModeToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useWorkspaceMode();

  return (
    <TooltipProvider>
      <div className={`flex items-center bg-muted rounded-lg p-0.5 ${className}`} data-testid="workspace-mode-toggle">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2.5 rounded-md text-xs font-medium gap-1.5 transition-all ${
                mode === "simplified"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode("simplified")}
              data-testid="button-mode-simplified"
            >
              <Sparkles className="h-3 w-3" />
              Simplified
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[200px]">
            Focus on outcomes and recommendations. Hides technical details.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2.5 rounded-md text-xs font-medium gap-1.5 transition-all ${
                mode === "advanced"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode("advanced")}
              data-testid="button-mode-advanced"
            >
              <Sliders className="h-3 w-3" />
              Advanced
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[200px]">
            Full operational visibility: workflows, governance, execution graphs.
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
