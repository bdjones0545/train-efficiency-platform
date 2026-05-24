import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trophy, ShieldCheck, User, CheckCircle2, Dumbbell, BarChart3, Users } from "lucide-react";

interface OrgAuthModalProps {
  orgId: string;
  programId?: string;
  programName: string;
  onAuthenticated: (token: string, user: any, membership: any, mainAppToken?: string) => void;
  onClose?: () => void;
}

interface SignupSuccess {
  token: string;
  user: any;
  membership: any;
  orgName: string;
  role: "athlete" | "team_coach";
}

export function OrgAuthModal({ orgId, programId = "", programName, onAuthenticated, onClose }: OrgAuthModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState<SignupSuccess | null>(null);

  // Login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);

  // Signup
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [signupRole, setSignupRole] = useState<"athlete" | "team_coach">("athlete");
  const [signupJoinCode, setSignupJoinCode] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginEmail || !loginPassword) return;
    setLoading(true);
    try {
      const r = await fetch("/api/org-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword, keepLoggedIn, orgId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Login failed");
      onAuthenticated(data.token, data.user, data.membership, data.mainAppToken ?? undefined);
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!signupName || !signupEmail || !signupPassword) return;
    setLoading(true);
    try {
      const r = await fetch("/api/org-auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: signupName,
          email: signupEmail,
          password: signupPassword,
          confirmPassword: signupConfirm,
          role: signupRole,
          orgId,
          programId,
          joinCode: signupJoinCode || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Signup failed");
      setSignupSuccess({
        token: data.token,
        user: data.user,
        membership: data.membership,
        orgName: data.orgName || programName,
        role: signupRole,
      });
    } catch (err: any) {
      toast({ title: "Signup failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function handleProceed() {
    if (!signupSuccess) return;
    onAuthenticated(signupSuccess.token, signupSuccess.user, signupSuccess.membership);
  }

  if (signupSuccess) {
    const isCoach = signupSuccess.role === "team_coach";
    const firstName = signupSuccess.user?.name?.split(" ")[0] || signupSuccess.user?.name || "there";
    return (
      <Dialog open modal onOpenChange={(open) => { if (!open && onClose) onClose(); }}>
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(e) => { if (!onClose) e.preventDefault(); }}
        >
          <div className="flex flex-col items-center text-center gap-4 py-2" data-testid="signup-success-screen">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9 text-green-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold" data-testid="text-welcome-heading">
                Welcome, {firstName}!
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Your {isCoach ? "coach" : "athlete"} account is ready on{" "}
                <span className="font-semibold text-foreground">{signupSuccess.orgName}</span>.
              </p>
            </div>

            <div className="w-full rounded-lg border border-border bg-muted/40 p-4 text-left space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                {isCoach ? "You now have access to" : "Start with any of these"}
              </p>
              {isCoach ? (
                <>
                  <div className="flex items-center gap-2 text-sm" data-testid="feature-workout-builder">
                    <Dumbbell className="h-4 w-4 text-primary shrink-0" />
                    <span>Workout Builder — create and assign programs</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm" data-testid="feature-pr-tracker">
                    <BarChart3 className="h-4 w-4 text-primary shrink-0" />
                    <span>PR Tracker management — monitor athlete records</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm" data-testid="feature-team-management">
                    <Users className="h-4 w-4 text-primary shrink-0" />
                    <span>Team management — organize your roster</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm" data-testid="feature-pr-tracker">
                    <Trophy className="h-4 w-4 text-primary shrink-0" />
                    <span>PR Tracker — log and track personal records</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm" data-testid="feature-workout-builder">
                    <Dumbbell className="h-4 w-4 text-primary shrink-0" />
                    <span>Workout Builder — view assigned workouts</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm" data-testid="feature-team">
                    <Users className="h-4 w-4 text-primary shrink-0" />
                    <span>Team boards — see your team's progress</span>
                  </div>
                </>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              A welcome email is on its way to <strong>{signupSuccess.user?.email}</strong>.
            </p>

            <Button
              className="w-full"
              onClick={handleProceed}
              data-testid="button-proceed-to-dashboard"
            >
              {isCoach ? "Open Coach Dashboard" : "Start Tracking PRs"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open modal onOpenChange={(open) => { if (!open && onClose) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => { if (!onClose) e.preventDefault(); }}
        closeLabel={onClose ? "Close and return to organization page" : undefined}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="h-5 w-5 text-primary" />
            <DialogTitle className="text-base">Sign in to {programName}</DialogTitle>
          </div>
          <p className="text-xs text-muted-foreground">Use your coach, athlete, or team account.</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Coaches can use their TrainEfficiency login. Athletes can use their team account.
          </p>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex rounded-lg bg-muted p-1 gap-1 mb-4">
          {(["login", "signup"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
              data-testid={`tab-${t}`}
            >
              {t === "login" ? "Log In" : "Sign Up"}
            </button>
          ))}
        </div>

        {tab === "login" ? (
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                data-testid="input-login-email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                data-testid="input-login-password"
                required
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="keep-logged-in"
                checked={keepLoggedIn}
                onCheckedChange={(v) => setKeepLoggedIn(!!v)}
                data-testid="checkbox-keep-logged-in"
              />
              <label htmlFor="keep-logged-in" className="text-xs text-muted-foreground cursor-pointer">
                Keep me logged in
              </label>
            </div>
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-login-submit">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log In"}
            </Button>
            <div className="flex items-center justify-center gap-2 pt-0.5">
              <Badge variant="secondary" className="text-xs gap-1 font-normal" data-testid="badge-coach-login">
                <ShieldCheck className="h-3 w-3" />
                Coach login supported
              </Badge>
              <Badge variant="secondary" className="text-xs gap-1 font-normal" data-testid="badge-athlete-login">
                <User className="h-3 w-3" />
                Athlete login supported
              </Badge>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              No account?{" "}
              <button type="button" onClick={() => setTab("signup")} className="underline">
                Sign up
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input
                placeholder="John Smith"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                data-testid="input-signup-name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                data-testid="input-signup-email"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  data-testid="input-signup-password"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Confirm Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={signupConfirm}
                  onChange={(e) => setSignupConfirm(e.target.value)}
                  data-testid="input-signup-confirm"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">I am a…</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSignupRole("athlete")}
                  className={`flex-1 py-2 text-sm font-medium rounded-md border transition-colors ${
                    signupRole === "athlete"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                  data-testid="button-role-athlete"
                >
                  Athlete
                </button>
                <button
                  type="button"
                  onClick={() => setSignupRole("team_coach")}
                  className={`flex-1 py-2 text-sm font-medium rounded-md border transition-colors ${
                    signupRole === "team_coach"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                  data-testid="button-role-team-coach"
                >
                  Team Coach
                </button>
              </div>
              {signupRole === "team_coach" && (
                <p className="text-xs text-muted-foreground leading-snug">
                  Team Coach accounts can manage their own team inside this PR Tracker. Organization admin access is controlled separately.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Team Join Code (optional)</Label>
              <Input
                placeholder="e.g., A1B2C3"
                value={signupJoinCode}
                onChange={(e) => setSignupJoinCode(e.target.value.toUpperCase())}
                data-testid="input-signup-join-code"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-signup-submit">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Account"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Have an account?{" "}
              <button type="button" onClick={() => setTab("login")} className="underline">
                Log in
              </button>
            </p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
