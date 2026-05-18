import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ShieldCheck, Plus, Users, Loader2, Mail,
  CheckCircle, Clock, XCircle, Trash2, Settings, Send,
  Copy, AlertTriangle, Eye, EyeOff,
} from "lucide-react";

const STORAGE_KEY = (slug: string) => `orgToken_${slug}`;

const RELATIONSHIP_TYPES = [
  { value: "mother", label: "Mother" },
  { value: "father", label: "Father" },
  { value: "guardian", label: "Guardian" },
  { value: "other", label: "Other" },
];

const DEFAULT_PERMISSIONS = {
  schedule: true,
  attendance: true,
  education: true,
  prMilestones: true,
  workoutCompletion: true,
  announcements: true,
};

const PERMISSION_LABELS: Record<string, string> = {
  schedule: "Schedule & Upcoming Sessions",
  attendance: "Attendance History",
  education: "Education Progress",
  prMilestones: "PR Milestones",
  workoutCompletion: "Workout Completion",
  announcements: "Coach Announcements",
};

function statusBadge(status: string) {
  if (status === "active") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs gap-1"><CheckCircle className="h-3 w-3" />Active</Badge>;
  if (status === "pending") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
  return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 text-xs gap-1"><XCircle className="h-3 w-3" />Revoked</Badge>;
}

export default function CoachGuardianManagementPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const orgToken = localStorage.getItem(STORAGE_KEY(slug)) ?? "";
  const headers = { "X-Org-Auth-Token": orgToken };

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAthleteId, setInviteAthleteId] = useState("");
  const [inviteRelationship, setInviteRelationship] = useState("guardian");
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<Record<string, boolean>>(DEFAULT_PERMISSIONS);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: guardiansData, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/org/guardians", slug],
    queryFn: () => fetch("/api/org/guardians", { headers }).then((r) => r.json()),
  });
  const links: any[] = guardiansData?.links ?? [];

  // Get unique athletes for selector
  const athleteMap: Record<string, any> = {};
  links.forEach((l: any) => {
    if (l.athleteProfile) athleteMap[l.athleteUserId] = l.athleteProfile;
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const inviteMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/org/guardians/invite", data, { headers }),
    onSuccess: (data: any) => {
      refetch();
      setShowInviteForm(false);
      setInviteEmail(""); setInviteAthleteId(""); setInviteRelationship("guardian");
      toast({
        title: "Invite sent",
        description: data?.message ?? "Guardian invite created successfully",
      });
    },
    onError: () => toast({ title: "Error", description: "Failed to send invite", variant: "destructive" }),
  });

  const updateLinkMut = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/org/guardians/link/${id}`, data, { headers }),
    onSuccess: () => { refetch(); setEditingLinkId(null); toast({ title: "Updated" }); },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/org/guardians/link/${id}`, {}, { headers }),
    onSuccess: () => { refetch(); toast({ title: "Guardian access revoked" }); },
  });

  // ── Filter links ──────────────────────────────────────────────────────────
  const filteredLinks = links.filter((l: any) => {
    if (filterStatus !== "all" && l.status !== filterStatus) return false;
    if (searchTerm) {
      const email = l.inviteEmail?.toLowerCase() ?? "";
      const name = `${l.guardianProfile?.firstName ?? ""} ${l.guardianProfile?.lastName ?? ""}`.toLowerCase();
      const athleteName = `${l.athleteProfile?.firstName ?? ""} ${l.athleteProfile?.lastName ?? ""}`.toLowerCase();
      if (!email.includes(searchTerm.toLowerCase()) && !name.includes(searchTerm.toLowerCase()) && !athleteName.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  });

  const activeCount = links.filter((l: any) => l.status === "active").length;
  const pendingCount = links.filter((l: any) => l.status === "pending").length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/50 bg-card/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => setLocation(`/org/${slug}/portal`)} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h1 className="font-semibold text-sm flex-1">Guardian Management</h1>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowInviteForm(true)}>
          <Plus className="h-3.5 w-3.5" />Invite
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center">
            <p className="text-xl font-bold">{links.length}</p>
            <p className="text-xs text-muted-foreground">Total Links</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-xl font-bold text-emerald-400">{activeCount}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-xl font-bold text-amber-400">{pendingCount}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </Card>
        </div>

        {/* Invite Form */}
        {showInviteForm && (
          <Card className="p-4 border-primary/20 bg-primary/5 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />Invite Guardian
            </p>
            <Input
              placeholder="Guardian email address"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="h-9 text-sm"
              data-testid="input-guardian-email"
            />
            <Input
              placeholder="Athlete user ID (optional — leave blank if inviting for yourself)"
              value={inviteAthleteId}
              onChange={(e) => setInviteAthleteId(e.target.value)}
              className="h-9 text-sm"
              data-testid="input-athlete-id"
            />
            <Select value={inviteRelationship} onValueChange={setInviteRelationship}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_TYPES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The guardian will receive an invite. Once accepted, they can view their athlete's schedule,
              education progress, and key milestones — but not private coaching data.
            </p>
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-xs flex-1 gap-1.5"
                onClick={() => inviteMut.mutate({ inviteEmail, athleteUserId: inviteAthleteId || undefined, relationshipType: inviteRelationship })}
                disabled={inviteMut.isPending || !inviteEmail}>
                {inviteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send Invite
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowInviteForm(false)}>Cancel</Button>
            </div>
          </Card>
        )}

        {/* Search + Filter */}
        <div className="flex gap-2">
          <Input
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 text-sm flex-1"
          />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 text-sm w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Guardian Links List */}
        {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

        <div className="space-y-3">
          {filteredLinks.map((l: any) => {
            const guardName = l.guardianProfile
              ? `${l.guardianProfile.firstName ?? ""} ${l.guardianProfile.lastName ?? ""}`.trim() || l.guardianProfile.username
              : null;
            const athleteName = l.athleteProfile
              ? `${l.athleteProfile.firstName ?? ""} ${l.athleteProfile.lastName ?? ""}`.trim() || l.athleteProfile.username
              : l.athleteUserId;
            const isEditing = editingLinkId === l.id;

            return (
              <Card key={l.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {statusBadge(l.status)}
                      {l.inviteEmail && <span className="text-xs text-muted-foreground">{l.inviteEmail}</span>}
                    </div>
                    {guardName && <p className="text-sm font-medium">{guardName}</p>}
                    <p className="text-xs text-muted-foreground capitalize">{(l.relationshipType ?? "guardian").replace(/_/g, " ")} of {athleteName}</p>
                    {l.activatedAt && <p className="text-xs text-muted-foreground">Linked {new Date(l.activatedAt).toLocaleDateString()}</p>}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => {
                        setEditingLinkId(isEditing ? null : l.id);
                        setEditingPermissions(l.permissions ?? DEFAULT_PERMISSIONS);
                      }}>
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                    {l.status !== "revoked" && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive/60 hover:text-destructive"
                        onClick={() => revokeMut.mutate(l.id)} disabled={revokeMut.isPending}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {l.status === "revoked" && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-primary"
                        onClick={() => updateLinkMut.mutate({ id: l.id, status: "active" })}>
                        Restore
                      </Button>
                    )}
                  </div>
                </div>

                {/* Invite token copy (pending) */}
                {l.status === "pending" && l.inviteToken && (
                  <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-muted-foreground flex-1 truncate">Invite token: {l.inviteToken.slice(0, 12)}…</p>
                    <button onClick={() => {
                      navigator.clipboard.writeText(l.inviteToken);
                      toast({ title: "Token copied" });
                    }}>
                      <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                )}

                {/* Permission Editor */}
                {isEditing && (
                  <div className="border-t border-border/30 pt-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Visibility Permissions</p>
                    {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2">
                          {editingPermissions[key] ? <Eye className="h-3.5 w-3.5 text-emerald-400" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground/40" />}
                          <p className="text-xs">{label}</p>
                        </div>
                        <Switch
                          checked={editingPermissions[key] ?? true}
                          onCheckedChange={(v) => setEditingPermissions((p) => ({ ...p, [key]: v }))}
                        />
                      </div>
                    ))}
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" className="h-7 text-xs flex-1"
                        onClick={() => updateLinkMut.mutate({ id: l.id, permissions: editingPermissions })}
                        disabled={updateLinkMut.isPending}>
                        {updateLinkMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Permissions"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingLinkId(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}

          {!isLoading && filteredLinks.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{links.length === 0 ? "No guardians invited yet" : "No results match your filter"}</p>
              <p className="text-xs mt-1">Invite guardians to give families visibility into athlete progress</p>
            </div>
          )}
        </div>

        {/* Info Card */}
        <Card className="p-4 border-border/30 bg-card/30 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">What Guardians Can See</p>
          <div className="space-y-1.5">
            {Object.values(PERMISSION_LABELS).map((label) => (
              <div key={label} className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border/30 pt-2 space-y-1.5">
            <p className="text-xs text-muted-foreground font-medium">Guardians cannot see:</p>
            {["Private coach notes", "Readiness & wellness scores", "AI intelligence data", "Other athletes"].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <XCircle className="h-3.5 w-3.5 text-rose-400/60 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
