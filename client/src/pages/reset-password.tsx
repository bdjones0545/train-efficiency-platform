import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";

function getTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

function PasswordStrengthIndicator({ password }: { password: string }) {
  const checks = [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "Uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "Lowercase letter", valid: /[a-z]/.test(password) },
    { label: "Number", valid: /[0-9]/.test(password) },
  ];

  if (!password) return null;

  return (
    <ul className="mt-2 space-y-1" data-testid="list-password-strength">
      {checks.map((c) => (
        <li key={c.label} className={`flex items-center gap-1.5 text-xs ${c.valid ? "text-primary" : "text-muted-foreground"}`}>
          {c.valid ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <XCircle className="h-3 w-3 shrink-0 text-destructive/60" />}
          {c.label}
        </li>
      ))}
    </ul>
  );
}

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const token = getTokenFromUrl();

  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(true);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenValid(false);
      setValidating(false);
      return;
    }

    apiRequest("GET", `/api/auth/validate-reset-token?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        setTokenValid(data.valid === true);
      })
      .catch(() => setTokenValid(false))
      .finally(() => setValidating(false));
  }, [token]);

  const passwordValid =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!passwordValid) {
      setError("Password does not meet the requirements.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/reset-password", { token, password });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => setLocation("/"), 3000);
      } else {
        setError(data.message || "Something went wrong. Please try again.");
      }
    } catch (err: any) {
      try {
        const msg = err?.message || "";
        const match = msg.match(/^\d+: (.+)$/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          setError(parsed.message || "Something went wrong. Please try again.");
        } else {
          setError("Something went wrong. Please try again.");
        }
      } catch {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 text-muted-foreground" data-testid="section-validating">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>Verifying your reset link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="link-back-to-login">
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                {tokenValid === false ? (
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                ) : success ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <KeyRound className="h-5 w-5 text-primary" />
                )}
              </div>
              <CardTitle className="text-2xl" data-testid="text-reset-password-heading">
                {tokenValid === false ? "Link expired or invalid" : success ? "Password reset!" : "Set new password"}
              </CardTitle>
            </div>
            {!success && tokenValid !== false && (
              <CardDescription data-testid="text-reset-password-description">
                Choose a strong password for your account.
              </CardDescription>
            )}
          </CardHeader>

          <CardContent>
            {tokenValid === false && (
              <div className="space-y-4 text-center" data-testid="section-invalid-token">
                <p className="text-muted-foreground" data-testid="text-invalid-token-message">
                  This reset link is invalid or has expired. Please request a new one.
                </p>
                <Link href="/forgot-password">
                  <Button className="w-full" data-testid="button-request-new-link">
                    Request a new link
                  </Button>
                </Link>
                <Link href="/">
                  <Button variant="outline" className="w-full" data-testid="button-back-to-login-invalid">
                    Back to login
                  </Button>
                </Link>
              </div>
            )}

            {success && (
              <div className="space-y-4 text-center" data-testid="section-success">
                <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
                <p className="font-medium" data-testid="text-success-message">
                  Your password has been reset successfully. Please sign in.
                </p>
                <p className="text-sm text-muted-foreground">
                  Redirecting you to the login page...
                </p>
                <Link href="/">
                  <Button className="w-full" data-testid="button-go-to-login">
                    Sign in now
                  </Button>
                </Link>
              </div>
            )}

            {tokenValid === true && !success && (
              <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-reset-password">
                <div className="space-y-2">
                  <label htmlFor="new-password" className="text-sm font-medium">
                    New password
                  </label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter new password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      required
                      className="pr-10"
                      autoFocus
                      data-testid="input-new-password"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-new-password"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <PasswordStrengthIndicator password={password} />
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-sm font-medium">
                    Confirm new password
                  </label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirm ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={confirm}
                      onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                      required
                      className="pr-10"
                      data-testid="input-confirm-password"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-0 top-0 h-full px-3"
                      onClick={() => setShowConfirm(!showConfirm)}
                      data-testid="button-toggle-confirm-password"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  {confirm && password !== confirm && (
                    <p className="text-xs text-destructive" data-testid="text-password-mismatch">
                      Passwords do not match.
                    </p>
                  )}
                </div>

                {error && (
                  <p className="text-sm text-destructive" data-testid="text-reset-error">{error}</p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={isLoading || !password || !confirm || !passwordValid || password !== confirm}
                  data-testid="button-reset-submit"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating password...
                    </>
                  ) : (
                    "Set new password"
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
