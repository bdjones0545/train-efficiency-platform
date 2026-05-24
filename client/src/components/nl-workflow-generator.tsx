/**
 * Natural Language Workflow Generator — Phase 7
 *
 * Allows operators to describe a workflow in plain English.
 * AI generates a draft graph definition — never auto-published.
 * Operators review, edit, then publish manually.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles, AlertTriangle, CheckCircle, ArrowRight, ShieldAlert,
  Cpu, GitBranch, Loader2, Zap,
} from "lucide-react";

const EXAMPLES = [
  "When a new lead signs up, send a welcome email and notify me in Slack.",
  "If an athlete misses 2 sessions, trigger a retention workflow.",
  "When a parent replies negatively, escalate to an admin for review.",
  "Every Monday, generate a business summary and post it to Slack.",
  "When a booking is cancelled, wait 2 days and send a win-back offer.",
];

interface NLWorkflowGeneratorProps {
  open: boolean;
  onClose: () => void;
  onLoadDraft: (graph: any, name: string) => void;
}

export function NLWorkflowGenerator({ open, onClose, onLoadDraft }: NLWorkflowGeneratorProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<any | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workflow-graphs/generate-from-prompt", { prompt });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
    },
    onError: () => toast({ title: "Generation failed — please try again", variant: "destructive" }),
  });

  const handleLoad = () => {
    if (!result?.graphDefinition) return;
    onLoadDraft(result.graphDefinition, result.name ?? prompt.slice(0, 40));
    onClose();
    setResult(null);
    setPrompt("");
  };

  const handleReset = () => {
    setResult(null);
    setPrompt("");
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Describe Your Workflow
          </DialogTitle>
          <DialogDescription className="text-xs">
            Write in plain English — AI will draft the workflow for you to review. Nothing publishes automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!result ? (
            <>
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe what you want to automate…"
                className="min-h-[100px] text-sm resize-none"
                data-testid="input-nl-prompt"
              />

              {/* Examples */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Examples:</p>
                <div className="flex flex-col gap-1.5">
                  {EXAMPLES.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setPrompt(ex)}
                      className="text-xs text-left px-2.5 py-1.5 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`example-prompt-${i}`}
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3 text-amber-500" />
                  Generated workflows are drafts only — review before enabling
                </p>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => generateMutation.mutate()}
                  disabled={!prompt.trim() || generateMutation.isPending}
                  data-testid="button-generate-workflow"
                >
                  {generateMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
                    : <><Sparkles className="h-3.5 w-3.5" />Generate Draft</>
                  }
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* Generated summary */}
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Draft generated</p>
                </div>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">"{prompt}"</p>
              </div>

              {/* Name */}
              {result.name && (
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">{result.name}</p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-lg font-bold">{(result.graphDefinition?.nodes ?? []).length}</p>
                    <p className="text-[10px] text-muted-foreground">Nodes</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className={`text-lg font-bold ${result.riskLevel === "low" ? "text-green-600" : result.riskLevel === "medium" ? "text-amber-600" : "text-red-600"}`}>
                      {result.riskLevel}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Risk</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-lg font-bold">{result.requiresApproval ? "Yes" : "Auto"}</p>
                    <p className="text-[10px] text-muted-foreground">Approval</p>
                  </CardContent>
                </Card>
              </div>

              {/* Suggested agents */}
              {result.suggestedAgents?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Suggested Agents</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.suggestedAgents.map((a: string) => (
                      <Badge key={a} variant="secondary" className="text-xs gap-1">
                        <Cpu className="h-2.5 w-2.5" />{a}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Integrations needed */}
              {result.suggestedIntegrations?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Integrations Required</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.suggestedIntegrations.map((i: string) => (
                      <Badge key={i} variant="outline" className="text-xs">{i}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Governance warnings */}
              {result.governanceWarnings?.length > 0 && (
                <div className="space-y-1.5">
                  {result.governanceWarnings.map((w: string, i: number) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{w}
                    </div>
                  ))}
                </div>
              )}

              {/* Node preview */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Workflow steps</p>
                <div className="space-y-1">
                  {(result.graphDefinition?.nodes ?? []).map((n: any, i: number) => (
                    <div key={n.id} className="flex items-center gap-2 text-xs">
                      <span className="h-4 w-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold shrink-0">{i + 1}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        n.data?.category === "trigger" ? "bg-green-100 text-green-700" :
                        n.data?.category === "agent_action" ? "bg-blue-100 text-blue-700" :
                        n.data?.category === "human" ? "bg-amber-100 text-amber-700" :
                        n.data?.category === "outcome" ? "bg-emerald-100 text-emerald-700" :
                        "bg-muted text-muted-foreground"
                      }`}>{n.data?.category}</span>
                      <span className="text-muted-foreground truncate">{n.data?.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <Button variant="outline" size="sm" onClick={handleReset}>
                  Try different prompt
                </Button>
                <Button size="sm" className="gap-1.5" onClick={handleLoad} data-testid="button-load-draft">
                  Load in Builder <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
