import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Mail, AlertCircle, Shield } from "lucide-react";

interface Preferences {
  bookingConfirmations: boolean;
  cancellations: boolean;
  reschedules: boolean;
  reminders: boolean;
  outreach: boolean;
  marketing: boolean;
}

const PREF_META: { key: keyof Preferences; label: string; description: string; essential?: boolean }[] = [
  {
    key: "bookingConfirmations",
    label: "Booking Confirmations",
    description: "Receive an email when a session is booked for you.",
    essential: true,
  },
  {
    key: "cancellations",
    label: "Cancellations",
    description: "Receive an email when a session is cancelled.",
    essential: true,
  },
  {
    key: "reschedules",
    label: "Reschedule Notices",
    description: "Receive an email when a session is rescheduled.",
    essential: true,
  },
  {
    key: "reminders",
    label: "Session Reminders",
    description: "Get a reminder before your upcoming training sessions.",
  },
  {
    key: "outreach",
    label: "Coach Outreach",
    description: "Allow your coach to send you personalized messages and offers.",
  },
  {
    key: "marketing",
    label: "Marketing & Promotions",
    description: "Receive promotional emails and feature announcements.",
  },
];

export default function UnsubscribePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [email, setEmail] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/unsubscribe/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.message || "Invalid link");
        }
        return r.json();
      })
      .then((data) => {
        setEmail(data.email);
        setPrefs(data.preferences);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Something went wrong");
        setLoading(false);
      });
  }, [token]);

  const toggle = (key: keyof Preferences) => {
    if (!prefs) return;
    setSaved(false);
    setPrefs({ ...prefs, [key]: !prefs[key] });
  };

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch(`/api/unsubscribe/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs }),
      });
      if (!r.ok) throw new Error("Failed to save");
      setSaved(true);
    } catch {
      setError("Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-unsubscribe">
            Email Preferences
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage what emails you receive from TrainEfficiency
          </p>
          {email && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-email-address">
              Managing preferences for <strong>{email}</strong>
            </p>
          )}
        </div>

        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <Skeleton className="h-6 w-11 rounded-full" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-8" data-testid="text-error">
                <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
                <p className="font-medium text-destructive">{error}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  This link may be invalid or expired. Contact your coach for help.
                </p>
              </div>
            ) : prefs ? (
              <div className="space-y-5">
                {PREF_META.map(({ key, label, description, essential }) => (
                  <div key={key} className="flex items-start justify-between gap-4" data-testid={`pref-row-${key}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        {essential && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                            <Shield className="h-3 w-3" />
                            Essential
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                    <Switch
                      checked={prefs[key]}
                      onCheckedChange={() => toggle(key)}
                      data-testid={`switch-${key}`}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {prefs && !error && (
          <div className="flex flex-col gap-2">
            <Button onClick={save} disabled={saving || loading} className="w-full" data-testid="button-save-preferences">
              {saving ? "Saving..." : "Save Preferences"}
            </Button>
            {saved && (
              <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400" data-testid="text-saved-confirmation">
                <CheckCircle className="h-4 w-4" />
                Preferences saved successfully
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground">
          Essential emails (booking confirmations, cancellations) help keep your schedule accurate.
          You can disable them but we recommend keeping them on.
        </p>
      </div>
    </div>
  );
}
