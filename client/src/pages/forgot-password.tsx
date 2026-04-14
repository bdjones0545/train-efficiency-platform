import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Mail, CheckCircle2, Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email: email.trim() });
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

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
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-2xl" data-testid="text-forgot-password-heading">
                Reset your password
              </CardTitle>
            </div>
            <CardDescription data-testid="text-forgot-password-description">
              Enter the email associated with your account and we'll send you a password reset link.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {submitted ? (
              <div className="text-center space-y-4 py-4" data-testid="section-submitted">
                <div className="flex justify-center">
                  <CheckCircle2 className="h-12 w-12 text-primary" />
                </div>
                <p className="font-medium text-base" data-testid="text-submitted-message">
                  If an account exists for that email, a password reset link has been sent.
                </p>
                <p className="text-sm text-muted-foreground">
                  Check your inbox and spam folder. The link expires in 1 hour.
                </p>
                <div className="pt-2">
                  <Link href="/">
                    <Button variant="outline" className="w-full" data-testid="button-back-to-login-after-submit">
                      Back to login
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="forgot-email" className="text-sm font-medium">
                    Email address
                  </label>
                  <Input
                    id="forgot-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    required
                    autoFocus
                    data-testid="input-forgot-email"
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive" data-testid="text-forgot-error">{error}</p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={isLoading || !email.trim()}
                  data-testid="button-forgot-submit"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send reset link"
                  )}
                </Button>

                <div className="text-center">
                  <Link href="/">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                      data-testid="link-back-to-login-inline"
                    >
                      Back to login
                    </button>
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
