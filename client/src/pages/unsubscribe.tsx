import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Mail, MessageSquare, AlertCircle, Shield } from "lucide-react";

interface ChannelPrefs {
  bookingConfirmations: boolean;
  cancellations: boolean;
  reschedules: boolean;
  reminders: boolean;
  outreach: boolean;
  marketing: boolean;
}

interface Preferences {
  email: ChannelPrefs;
  sms: ChannelPrefs;
}

const PREF_META: { key: keyof ChannelPrefs; label: string; emailDesc: string; smsDesc: string; essential?: boolean }[] = [
  {
    key: "bookingConfirmations",
    label: "Booking Confirmations",
    emailDesc: "Receive an email when a session is booked for you.",
    smsDesc: "Receive a text when a session is booked for you.",
    essential: true,
  },
  {
    key: "cancellations",
    label: "Cancellations",
    emailDesc: "Receive an email when a session is cancelled.",
    smsDesc: "Receive a text when a session is cancelled.",
    essential: true,
  },
  {
    key: "reschedules",
    label: "Reschedule Notices",
    emailDesc: "Receive an email when a session is rescheduled.",
    smsDesc: "Receive a text when a session is rescheduled.",
    essential: true,
  },
  {
    key: "reminders",
    label: "Session Reminders",
    emailDesc: "Get a reminder before your upcoming training sessions.",
    smsDesc: "Get a text reminder before your upcoming training sessions.",
  },
  {
    key: "outreach",
    label: "Coach Outreach",
    emailDesc: "Allow your coach to send you personalized messages and offers.",
    smsDesc: "Allow your coach to send you personalized texts and offers.",
  },
  {
    key: "marketing",
    label: "Marketing & Promotions",
    emailDesc: "Receive promotional emails and feature announcements.",
    smsDesc: "Receive promotional texts and feature announcements.",
  },
];

const DEFAULT_EMAIL_PREFS: ChannelPrefs = {
  bookingConfirmations: true,
  cancellations: true,
  reschedules: true,
  reminders: true,
  outreach: true,
  marketing: false,
};

const DEFAULT_SMS_PREFS: ChannelPrefs = {
  bookingConfirmations: false,
  cancellations: false,
  reschedules: false,
  reminders: false,
  outreach: false,
  marketing: false,
};

export default function UnsubscribePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [email, setEmail] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [hasSms, setHasSms] = useState(false);
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
        const raw = data.preferences;
        if (raw?.email || raw?.sms) {
          setPrefs({
            email: { ...DEFAULT_EMAIL_PREFS, ...(raw.email || {}) },
            sms: { ...DEFAULT_SMS_PREFS, ...(raw.sms || {}) },
          });
          const smsVals = Object.values({ ...DEFAULT_SMS_PREFS, ...(raw.sms || {}) });
          setHasSms(smsVals.some(Boolean));
        } else {
          setPrefs({
            email: { ...DEFAULT_EMAIL_PREFS, ...(raw || {}) },
            sms: { ...DEFAULT_SMS_PREFS },
          });
          setHasSms(false);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "Something went wrong");
        setLoading(false);
      });
  }, [token]);

  const toggleEmail = (key: keyof ChannelPrefs) => {
    if (!prefs) return;
    setSaved(false);
    setPrefs({ ...prefs, email: { ...prefs.email, [key]: !prefs.email[key] } });
  };

  const toggleSms = (key: keyof ChannelPrefs) => {
    if (!prefs) return;
    setSaved(false);
    setPrefs({ ...prefs, sms: { ...prefs.sms, [key]: !prefs.sms[key] } });
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

  const renderPrefRows = (
    channel: "email" | "sms",
    toggleFn: (key: keyof ChannelPrefs) => void
  ) => {
    if (!prefs) return null;
    return PREF_META.map(({ key, label, emailDesc, smsDesc, essential }) => (
      <div key={key} className="flex items-start justify-between gap-4" data-testid={`pref-row-${channel}-${key}`}>
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
          <p className="text-xs text-muted-foreground mt-0.5">
            {channel === "email" ? emailDesc : smsDesc}
          </p>
        </div>
        <Switch
          checked={prefs[channel][key]}
          onCheckedChange={() => toggleFn(key)}
          data-testid={`switch-${channel}-${key}`}
        />
      </div>
    ));
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-unsubscribe">
            Notification Preferences
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage what messages you receive from TrainEfficiency
          </p>
          {email && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-email-address">
              Managing preferences for <strong>{email}</strong>
            </p>
          )}
        </div>

        {loading ? (
          <Card>
            <CardContent className="pt-6 space-y-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-6 w-11 rounded-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8" data-testid="text-error">
                <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
                <p className="font-medium text-destructive">{error}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  This link may be invalid or expired. Contact your coach for help.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : prefs ? (
          <>
            {/* Email preferences */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Mail className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Email Notifications</h2>
                </div>
                <div className="space-y-5">
                  {renderPrefRows("email", toggleEmail)}
                </div>
              </CardContent>
            </Card>

            {/* SMS preferences — only show if they have SMS prefs stored */}
            {hasSms && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">SMS Notifications</h2>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    You can also reply STOP to any text message to unsubscribe instantly.
                  </p>
                  <div className="space-y-5">
                    {renderPrefRows("sms", toggleSms)}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}

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
          Essential notifications (booking confirmations, cancellations) help keep your schedule accurate.
          You can disable them but we recommend keeping them on.
        </p>
      </div>
    </div>
  );
}
