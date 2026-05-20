import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trophy } from "lucide-react";

interface OrgAuthModalProps {
  orgId: string;
  programId?: string;
  programName: string;
  onAuthenticated: (token: string, user: any, membership: any, mainAppToken?: string) => void;
  onClose?: () => void;
}

export function OrgAuthModal({ orgId, programId = "", programName, onAuthenticated, onClose }: OrgAuthModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);

  // Login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);

  // Signup
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [signupRole, setSignupRole] = useState<"athlete" | "coach">("athlete");
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
      toast({ title: "Account created! Welcome." });
      onAuthenticated(data.token, data.user, data.membership);
    } catch (err: any) {
      toast({ title: "Signup failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open modal onOpenChange={(open) => { if (!open && onClose) onClose(); }}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => { if (!onClose) e.preventDefault(); }}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="h-5 w-5 text-primary" />
            <DialogTitle className="text-base">{programName}</DialogTitle>
          </div>
          <p className="text-xs text-muted-foreground">Sign in to your {programName} account</p>
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
                {(["athlete", "coach"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSignupRole(r)}
                    className={`flex-1 py-2 text-sm font-medium rounded-md border transition-colors ${
                      signupRole === r
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                    data-testid={`button-role-${r}`}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Team Join Code (optional)</Label>
              <Input
                placeholder="e.g., A1B2C3"
                value={signupJoinCode}
                onChange={(e) => setSignupJoinCode(e.target.value)}
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
