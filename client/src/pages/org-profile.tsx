import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { logoutAllSessions } from "@/lib/logout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { OrgAuthModal } from "@/components/pr-tracker/OrgAuthModal";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { getAuthHeaders } from "@/lib/authToken";
import {
  User,
  LogOut,
  ArrowLeft,
  Shield,
  Bell,
  Users,
  LayoutDashboard,
  CalendarCheck,
  CalendarPlus,
  Trophy,
  ChevronRight,
  Lock,
  Monitor,
  Clock,
  CheckCircle2,
  Edit2,
  Save,
  X,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const roleConfig: Record<string, { label: string; className: string }> = {
  coach: { label: "Coach", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  athlete: { label: "Athlete", className: "bg-green-500/10 text-green-400 border-green-500/20" },
  owner: { label: "Owner", className: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  parent: { label: "Parent", className: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
};

function RoleBadge({ role }: { role: string }) {
  const c = roleConfig[role] ?? roleConfig.athlete;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>
      {c.label}
    </span>
  );
}

function timeAgo(date: string | Date) {
  const now = Date.now();
  const d = new Date(date).getTime();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function orgFetch(method: string, path: string, token: string | null, body?: any) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  if (token) headers["X-Org-Auth-Token"] = token;
  return fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const editProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    newPassword: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type EditProfileData = z.infer<typeof editProfileSchema>;
type ChangePasswordData = z.infer<typeof changePasswordSchema>;

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <div className="space-y-4 pt-6 px-4 max-w-2xl mx-auto">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

// ─── Section heading helper ────────────────────────────────────────────────────

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</h2>
    </div>
  );
}

// ─── Notification Toggle Row ───────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onToggle} disabled={disabled} />
    </div>
  );
}

// ─── Main Profile Page ────────────────────────────────────────────────────────

export default function OrgProfilePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Org
  const { data: org, isLoading: orgLoading } = useQuery<any>({
    queryKey: ["/api/organizations", slug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${slug}`);
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
  });

  const orgId = org?.id;

  // Permissions — resolves via OIDC session, Bearer token, or org-specific token
  const { hasAccess, isHydrating } = usePermissions(slug);

  // Token (org-portal login path — not required when user is already authenticated via platform)
  const [orgToken, setOrgToken] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    const token = localStorage.getItem(`orgToken_${orgId}`);
    if (!token) return;
    fetch("/api/org-auth/me", { headers: { "X-Org-Auth-Token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => setOrgToken(token))
      .catch(() => {
        localStorage.removeItem(`orgToken_${orgId}`);
      });
  }, [orgId]);

  // Whether the current user can access org management pages
  const canLoad = !!orgId && (!!orgToken || hasAccess);

  // Profile data
  const { data: profileData, isLoading: profileLoading } = useQuery<any>({
    queryKey: ["/api/org/profile", orgId, orgToken],
    queryFn: async () => {
      const headers: Record<string, string> = { ...getAuthHeaders() };
      if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
      const res = await fetch("/api/org/profile", { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: canLoad,
  });

  // Sessions
  const { data: sessionsData, refetch: refetchSessions } = useQuery<any>({
    queryKey: ["/api/org/profile/sessions", orgId, orgToken],
    queryFn: async () => {
      const headers: Record<string, string> = { ...getAuthHeaders() };
      if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
      const res = await fetch("/api/org/profile/sessions", { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
    enabled: canLoad,
  });

  // Notifications
  const { data: notifData, isLoading: notifLoading } = useQuery<any>({
    queryKey: ["/api/org/profile/notifications", orgId, orgToken],
    queryFn: async () => {
      const headers: Record<string, string> = { ...getAuthHeaders() };
      if (orgToken) headers["X-Org-Auth-Token"] = orgToken;
      const res = await fetch("/api/org/profile/notifications", { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load notifications");
      return res.json();
    },
    enabled: canLoad,
  });

  // Edit profile form
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const profileForm = useForm<EditProfileData>({
    resolver: zodResolver(editProfileSchema),
    defaultValues: { name: "", email: "" },
  });

  useEffect(() => {
    if (profileData?.user) {
      profileForm.reset({ name: profileData.user.name, email: profileData.user.email });
    }
  }, [profileData]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: EditProfileData) => {
      const res = await orgFetch("PATCH", "/api/org/profile", orgToken!, data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update profile");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/profile", orgId, orgToken] });
      setIsEditingProfile(false);
      toast({ title: "Profile updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Change password form
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const passwordForm = useForm<ChangePasswordData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: ChangePasswordData) => {
      const res = await orgFetch("PATCH", "/api/org/profile/password", orgToken!, data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      setShowPasswordForm(false);
      passwordForm.reset();
      toast({ title: "Password changed successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Logout all sessions
  const logoutAllMutation = useMutation({
    mutationFn: async (includeCurrentSession: boolean) => {
      const res = await orgFetch("POST", "/api/org/profile/logout-all", orgToken!, { includeCurrentSession });
      if (!res.ok) throw new Error("Failed to logout");
      return res.json();
    },
    onSuccess: (_, includeCurrentSession) => {
      if (includeCurrentSession) {
        if (orgId) localStorage.removeItem(`orgToken_${orgId}`);
        setOrgToken(null);
        window.location.href = `/org/${slug}/portal`;
      } else {
        refetchSessions();
        toast({ title: "Other sessions logged out" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Notification preferences
  const [localPrefs, setLocalPrefs] = useState<any>(null);

  useEffect(() => {
    if (notifData?.preferences) setLocalPrefs(notifData.preferences);
  }, [notifData]);

  const updateNotifMutation = useMutation({
    mutationFn: async (prefs: any) => {
      const res = await orgFetch("PATCH", "/api/org/profile/notifications", orgToken!, prefs);
      if (!res.ok) throw new Error("Failed to save preferences");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/profile/notifications", orgId, orgToken] });
    },
    onError: () => {
      toast({ title: "Error saving preferences", variant: "destructive" });
    },
  });

  function togglePref(key: string, value: boolean) {
    const updated = { ...localPrefs, [key]: value };
    setLocalPrefs(updated);
    updateNotifMutation.mutate({ [key]: value });
  }

  function handleLogout() {
    logoutAllSessions(`/org/${slug}/portal`);
  }

  function handleAuthenticated(token: string) {
    if (orgId) localStorage.setItem(`orgToken_${orgId}`, token);
    setOrgToken(token);
    setShowAuth(false);
  }

  // ── Guards ──────────────────────────────────────────────────────────────
  if (orgLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (!orgToken && !hasAccess && !isHydrating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center space-y-6">
        {org?.logoUrl && <img src={org.logoUrl} alt={org.name} className="h-14 w-auto rounded-xl" />}
        <div>
          <h1 className="text-2xl font-bold">{org?.name}</h1>
          <p className="text-muted-foreground mt-1">Log in to manage your profile</p>
        </div>
        <Button size="lg" onClick={() => setShowAuth(true)} data-testid="button-profile-login">
          <User className="h-4 w-4 mr-2" /> Log In
        </Button>
        {showAuth && (
          <OrgAuthModal
            orgId={orgId || ""}
            programName={org?.name || ""}
            onAuthenticated={handleAuthenticated}
            onClose={() => setShowAuth(false)}
          />
        )}
      </div>
    );
  }

  const { user, membership, stats, teams, programs, coachTeams, athleteCount } = profileData || {};
  const isCoach = membership?.role === "coach" || membership?.role === "owner";
  const prTrackerPrograms = programs?.filter((p: any) => p.type === "pr_tracker") || [];
  const schedulingPrograms = programs?.filter((p: any) => p.type !== "pr_tracker") || [];
  const prUrl = prTrackerPrograms[0] ? `/org/${slug}/programs/${prTrackerPrograms[0].slug}` : null;

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Sticky Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <a href={`/org/${slug}/portal`} data-testid="link-back-portal">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Portal
              </Button>
            </a>
          </div>
          <span className="font-semibold text-sm">My Profile</span>
          <Button size="sm" variant="ghost" onClick={handleLogout} data-testid="button-nav-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </nav>

      {profileLoading || !profileData ? (
        <ProfileSkeleton />
      ) : (
        <div className="max-w-2xl mx-auto px-4 space-y-6 pt-6">

          {/* ── Profile Header ─────────────────────────────────────────── */}
          <Card className="p-5 space-y-4" data-testid="card-profile-header">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xl font-bold" data-testid="avatar-initials">
                  {getInitials(user?.name || "?")}
                </div>
                <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-green-500 border-2 border-background" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-bold truncate" data-testid="text-profile-name">{user?.name}</h1>
                <p className="text-sm text-muted-foreground truncate" data-testid="text-profile-email">{user?.email}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <RoleBadge role={membership?.role || "athlete"} />
                  {org?.name && (
                    <span className="text-xs text-muted-foreground">{org.name}</span>
                  )}
                </div>
              </div>

              {/* Edit button */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsEditingProfile(!isEditingProfile)}
                data-testid="button-edit-profile"
              >
                {isEditingProfile ? <X className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
              </Button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 border-t pt-4">
              <div className="text-center">
                <p className="text-lg font-bold" data-testid="stat-upcoming-bookings">{stats?.upcomingBookings ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Upcoming</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold" data-testid="stat-pr-entries">{stats?.prEntries ?? "—"}</p>
                <p className="text-xs text-muted-foreground">PR Entries</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold" data-testid="stat-teams">{stats?.teams ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Teams</p>
              </div>
            </div>

            {/* Member since */}
            {membership?.createdAt && (
              <p className="text-xs text-muted-foreground border-t pt-3">
                Member since {format(new Date(membership.createdAt), "MMMM yyyy")}
              </p>
            )}
          </Card>

          {/* ── Edit Profile ───────────────────────────────────────────── */}
          {isEditingProfile && (
            <Card className="p-5" data-testid="card-edit-profile">
              <SectionHeading icon={<Edit2 className="h-4 w-4" />} label="Edit Profile" />
              <Form {...profileForm}>
                <form onSubmit={profileForm.handleSubmit((d) => updateProfileMutation.mutate(d))} className="space-y-4">
                  <FormField
                    control={profileForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-profile-name" placeholder="Your full name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={profileForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" data-testid="input-profile-email" placeholder="you@example.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Future-ready placeholder fields */}
                  <div className="rounded-lg border border-dashed p-3 space-y-1 opacity-50">
                    <p className="text-xs font-medium text-muted-foreground">Coming soon</p>
                    <p className="text-xs text-muted-foreground">Phone · Birthday · Sport · Position</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button type="submit" size="sm" disabled={updateProfileMutation.isPending} className="flex-1" data-testid="button-save-profile">
                      <Save className="h-4 w-4 mr-1.5" />
                      {updateProfileMutation.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => { setIsEditingProfile(false); profileForm.reset({ name: user?.name, email: user?.email }); }}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </Card>
          )}

          {/* ── Security ───────────────────────────────────────────────── */}
          <Card className="p-5 space-y-4" data-testid="card-security">
            <SectionHeading icon={<Shield className="h-4 w-4" />} label="Password & Security" />

            {/* Change Password */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Password</p>
                  <p className="text-xs text-muted-foreground">Last changed: unknown</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowPasswordForm(!showPasswordForm)}
                  data-testid="button-toggle-password"
                >
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  Change
                </Button>
              </div>

              {showPasswordForm && (
                <Form {...passwordForm}>
                  <form onSubmit={passwordForm.handleSubmit((d) => changePasswordMutation.mutate(d))} className="space-y-3 pt-2 border-t">
                    <FormField
                      control={passwordForm.control}
                      name="currentPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Current Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" data-testid="input-current-password" placeholder="Current password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={passwordForm.control}
                      name="newPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>New Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" data-testid="input-new-password" placeholder="Min 8 characters" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={passwordForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm New Password</FormLabel>
                          <FormControl>
                            <Input {...field} type="password" data-testid="input-confirm-password" placeholder="Repeat new password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={changePasswordMutation.isPending} className="flex-1" data-testid="button-save-password">
                        {changePasswordMutation.isPending ? "Updating…" : "Update Password"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => { setShowPasswordForm(false); passwordForm.reset(); }}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </Form>
              )}
            </div>

            {/* Active Sessions */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Monitor className="h-4 w-4 text-muted-foreground" /> Active Sessions
                </p>
                {sessionsData?.sessions?.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-destructive hover:text-destructive"
                    onClick={() => logoutAllMutation.mutate(false)}
                    disabled={logoutAllMutation.isPending}
                    data-testid="button-logout-others"
                  >
                    Log out others
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {sessionsData?.sessions?.map((s: any) => (
                  <div key={s.id} className={`flex items-center gap-3 p-3 rounded-lg border ${s.isCurrent ? "border-primary/30 bg-primary/5" : "border-border"}`} data-testid={`session-${s.id}`}>
                    <Monitor className={`h-4 w-4 flex-shrink-0 ${s.isCurrent ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{s.isCurrent ? "Current session" : "Session"}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Active {timeAgo(s.lastUsedAt)} · {s.keepLoggedIn ? "Keep me logged in" : "Session"}
                      </p>
                    </div>
                    {s.isCurrent && <Badge variant="outline" className="text-xs flex-shrink-0">Current</Badge>}
                  </div>
                ))}
                {!sessionsData?.sessions?.length && (
                  <p className="text-sm text-muted-foreground">No active sessions found.</p>
                )}
              </div>

              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                onClick={() => logoutAllMutation.mutate(true)}
                disabled={logoutAllMutation.isPending}
                data-testid="button-logout-all"
              >
                <LogOut className="h-4 w-4 mr-1.5" />
                {logoutAllMutation.isPending ? "Logging out…" : "Log Out All Sessions"}
              </Button>
            </div>
          </Card>

          {/* ── Notification Preferences ───────────────────────────────── */}
          <Card className="p-5" data-testid="card-notifications">
            <SectionHeading icon={<Bell className="h-4 w-4" />} label="Notification Preferences" />
            {notifLoading || !localPrefs ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div>
                <div className="mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Channels</p>
                  <ToggleRow label="Email notifications" description="Receive updates via email" checked={localPrefs.emailEnabled} onToggle={(v) => togglePref("emailEnabled", v)} />
                  <ToggleRow label="SMS notifications" description="Text message alerts (coming soon)" checked={localPrefs.smsEnabled} onToggle={(v) => togglePref("smsEnabled", v)} disabled />
                </div>
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Topics</p>
                  <ToggleRow label="Booking reminders" description="Reminders before your training sessions" checked={localPrefs.bookingReminders} onToggle={(v) => togglePref("bookingReminders", v)} />
                  <ToggleRow label="PR updates" description="When your personal records are updated" checked={localPrefs.prUpdates} onToggle={(v) => togglePref("prUpdates", v)} />
                  <ToggleRow label="Team announcements" description="Updates from your coach and team" checked={localPrefs.teamAnnouncements} onToggle={(v) => togglePref("teamAnnouncements", v)} />
                  <ToggleRow label="Marketing emails" description="News, tips, and platform updates" checked={localPrefs.marketingEmails} onToggle={(v) => togglePref("marketingEmails", v)} />
                </div>
              </div>
            )}
          </Card>

          {/* ── Membership Info ────────────────────────────────────────── */}
          <Card className="p-5 space-y-4" data-testid="card-membership">
            <SectionHeading icon={<CheckCircle2 className="h-4 w-4" />} label="Membership" />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Organization</p>
                <p className="font-medium">{org?.name}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Role</p>
                <RoleBadge role={membership?.role || "athlete"} />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={membership?.status === "active" ? "default" : "secondary"} className="text-xs capitalize">
                  {membership?.status}
                </Badge>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Member Since</p>
                <p className="font-medium">{membership?.createdAt ? format(new Date(membership.createdAt), "MMM yyyy") : "—"}</p>
              </div>
            </div>

            {/* Teams */}
            {teams && teams.length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{isCoach ? "Teams I Coach" : "My Teams"}</p>
                {(isCoach ? coachTeams : teams).map((t: any) => (
                  <div key={t.teamId || t.id} className="flex items-center gap-2 text-sm" data-testid={`membership-team-${t.teamId || t.id}`}>
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span>{t.teamName || t.name}</span>
                    {!isCoach && <span className="text-xs text-muted-foreground">({t.role})</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Coach stats */}
            {isCoach && (
              <div className="border-t pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className="text-lg font-bold" data-testid="stat-coach-athletes">{athleteCount}</p>
                    <p className="text-xs text-muted-foreground">Athletes</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className="text-lg font-bold" data-testid="stat-coach-teams">{coachTeams?.length ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Teams</p>
                  </div>
                </div>
              </div>
            )}

            {/* Programs */}
            {programs && programs.length > 0 && (
              <div className="border-t pt-3 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Available Programs</p>
                {programs.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-sm" data-testid={`membership-program-${p.id}`}>
                    <span className="flex items-center gap-2">
                      {p.type === "pr_tracker" ? <Trophy className="h-4 w-4 text-amber-400" /> : <CalendarPlus className="h-4 w-4 text-primary" />}
                      {p.name}
                    </span>
                    <Badge variant="outline" className="text-xs">{p.type === "pr_tracker" ? "PR Tracker" : "Schedule"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ── Quick Links ────────────────────────────────────────────── */}
          <Card className="p-5" data-testid="card-quick-links">
            <SectionHeading icon={<ChevronRight className="h-4 w-4" />} label="Quick Links" />
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: <LayoutDashboard className="h-5 w-5 text-primary" />, label: "Portal Home", href: `/org/${slug}/portal` },
                { icon: <CalendarCheck className="h-5 w-5 text-primary" />, label: "My Schedule", href: `/org/${slug}/my-schedule` },
                { icon: <CalendarPlus className="h-5 w-5 text-primary" />, label: "Book Session", href: `/org/${slug}/athletic` },
                ...(prUrl ? [{ icon: <Trophy className="h-5 w-5 text-amber-400" />, label: "PR Tracker", href: prUrl }] : []),
                ...(isCoach && prUrl ? [{ icon: <Users className="h-5 w-5 text-blue-400" />, label: "Coach Dashboard", href: prUrl }] : []),
              ].map((link) => (
                <a key={link.href} href={link.href} data-testid={`link-quick-${link.label.replace(/\s+/g, "-").toLowerCase()}`}>
                  <div className="flex items-center gap-2.5 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer">
                    {link.icon}
                    <span className="text-sm font-medium">{link.label}</span>
                  </div>
                </a>
              ))}
            </div>
          </Card>

          {/* ── Future Ready Placeholder ───────────────────────────────── */}
          <Card className="p-4 border-dashed opacity-50" data-testid="card-future-features">
            <p className="text-xs text-muted-foreground text-center uppercase tracking-widest mb-3">Coming Soon</p>
            <div className="grid grid-cols-3 gap-2">
              {["Billing", "Workout History", "AI Coaching", "Readiness", "Wearables", "Parent Accounts"].map((f) => (
                <div key={f} className="rounded-lg bg-muted/30 p-2 text-center">
                  <p className="text-xs text-muted-foreground">{f}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* ── Logout ─────────────────────────────────────────────────── */}
          <Button variant="outline" size="sm" onClick={handleLogout} className="w-full" data-testid="button-logout-bottom">
            <LogOut className="h-4 w-4 mr-1.5" /> Log Out
          </Button>

        </div>
      )}
    </div>
  );
}
