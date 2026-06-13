import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import { MessageSquare, Send, Users, User, Megaphone, Loader2 } from "lucide-react";

type ComposerMode = "direct" | "team_announcement";

interface OrgMessageComposerProps {
  orgToken: string;
  orgId: string;
  defaultRecipientUserId?: string;
  defaultTeamId?: string;
  defaultMode?: ComposerMode;
  onSent?: () => void;
  trigger?: React.ReactNode;
  compact?: boolean;
}

export function OrgMessageComposer({
  orgToken,
  orgId,
  defaultRecipientUserId,
  defaultTeamId,
  defaultMode = "direct",
  onSent,
  trigger,
  compact = false,
}: OrgMessageComposerProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ComposerMode>(defaultMode);
  const [recipientUserId, setRecipientUserId] = useState(defaultRecipientUserId ?? "");
  const [teamId, setTeamId] = useState(defaultTeamId ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // Fetch athletes for recipient selector
  const { data: athletes = [] } = useQuery<any[]>({
    queryKey: ["/api/org/bootstrap-athletes", orgId],
    queryFn: () =>
      fetchJson<any>(`/api/org/workout-builder/bootstrap`, { headers: { "X-Org-Auth-Token": orgToken } })
        .then((d) => d.athletes ?? []),
    enabled: open && mode === "direct",
  });

  // Fetch teams for team selector
  const { data: teams = [] } = useQuery<any[]>({
    queryKey: ["/api/org/bootstrap-teams", orgId],
    queryFn: () =>
      fetchJson<any>(`/api/org/workout-builder/bootstrap`, { headers: { "X-Org-Auth-Token": orgToken } })
        .then((d) => d.teams ?? []),
    enabled: open && mode === "team_announcement",
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        messageType: mode,
        subject: subject || undefined,
        body,
        ...(mode === "direct" ? { recipientUserId } : { teamId }),
      };
      const res = await fetch("/api/org/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Org-Auth-Token": orgToken },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Message sent" });
      setOpen(false);
      setSubject("");
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/org/messages"] });
      onSent?.();
    },
    onError: (e: any) => toast({ title: e.message ?? "Failed to send", variant: "destructive" }),
  });

  function canSend() {
    if (!body.trim()) return false;
    if (mode === "direct" && !recipientUserId) return false;
    if (mode === "team_announcement" && !teamId) return false;
    return true;
  }

  const triggerEl = trigger ?? (
    <Button size="sm" variant="outline" className="gap-1.5" data-testid="button-open-composer">
      <MessageSquare className="h-3.5 w-3.5" /> Message
    </Button>
  );

  return (
    <>
      <div onClick={() => setOpen(true)} className="cursor-pointer inline-flex">{triggerEl}</div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Compose Message
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              {([
                { key: "direct", label: "Direct Message", icon: User },
                { key: "team_announcement", label: "Team Announcement", icon: Megaphone },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium flex-1 justify-center transition-colors ${mode === key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`composer-mode-${key}`}
                >
                  <Icon className="h-3 w-3" /> {label}
                </button>
              ))}
            </div>

            {/* Recipient */}
            {mode === "direct" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Recipient</Label>
                {defaultRecipientUserId ? (
                  <p className="text-sm text-muted-foreground">Pre-selected athlete</p>
                ) : (
                  <Select value={recipientUserId} onValueChange={setRecipientUserId}>
                    <SelectTrigger className="h-9 text-sm" data-testid="select-recipient">
                      <SelectValue placeholder="Select athlete…" />
                    </SelectTrigger>
                    <SelectContent>
                      {athletes.map((a: any) => (
                        <SelectItem key={a.userId} value={a.userId}>
                          {a.firstName ?? ""} {a.lastName ?? ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {mode === "team_announcement" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Team</Label>
                {defaultTeamId ? (
                  <p className="text-sm text-muted-foreground">Pre-selected team</p>
                ) : (
                  <Select value={teamId} onValueChange={setTeamId}>
                    <SelectTrigger className="h-9 text-sm" data-testid="select-team">
                      <SelectValue placeholder="Select team…" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name ?? t.teamName ?? t.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Subject */}
            <div className="space-y-1.5">
              <Label className="text-xs">Subject (optional)</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="E.g. Practice update"
                className="h-9 text-sm"
                data-testid="input-message-subject"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={mode === "team_announcement" ? "Write your team announcement…" : "Write your message…"}
                data-testid="input-message-body"
              />
              <p className="text-xs text-muted-foreground text-right">{body.length} chars</p>
            </div>

            <Button
              className="w-full"
              onClick={() => sendMutation.mutate()}
              disabled={!canSend() || sendMutation.isPending}
              data-testid="button-send-message"
            >
              {sendMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Sending…</> : <><Send className="h-4 w-4 mr-1.5" /> Send Message</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
