import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/authToken";
import { useActiveOrg } from "@/hooks/use-active-org";
import { Settings, CheckCircle, Shield, MessageSquare, Mail } from "lucide-react";

interface ChannelPrefs {
  bookingConfirmations: boolean;
  cancellations: boolean;
  reschedules: boolean;
  reminders: boolean;
  outreach: boolean;
  marketing: boolean;
}

interface NotificationPreferences {
  email: ChannelPrefs;
  sms: ChannelPrefs;
}

interface PrefsResponse {
  preferences: NotificationPreferences;
  phone: string | null;
  smsOptIn: boolean | null;
  smsOptInAt: string | null;
}

const PREF_META: { key: keyof ChannelPrefs; label: string; emailDesc: string; smsDesc: string; essential?: boolean }[] = [
  { key: "bookingConfirmations", label: "Booking Confirmations", emailDesc: "Receive an email when a session is booked for you.", smsDesc: "Receive a text when a session is booked for you.", essential: true },
  { key: "cancellations", label: "Cancellations", emailDesc: "Receive an email when a session is cancelled.", smsDesc: "Receive a text when a session is cancelled.", essential: true },
  { key: "reschedules", label: "Reschedule Notices", emailDesc: "Receive an email when a session is rescheduled.", smsDesc: "Receive a text when a session is rescheduled.", essential: true },
  { key: "reminders", label: "Session Reminders", emailDesc: "Get a reminder email before your upcoming sessions.", smsDesc: "Get a reminder text before your upcoming sessions." },
  { key: "outreach", label: "Coach Outreach", emailDesc: "Allow your coach to send you personalized emails and offers.", smsDesc: "Allow your coach to send you personalized texts and offers." },
  { key: "marketing", label: "Marketing & Promotions", emailDesc: "Receive promotional emails and feature announcements.", smsDesc: "Receive promotional texts and feature announcements." },
];

const DEFAULT_CHANNEL_PREFS: ChannelPrefs = {
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

export default function SettingsPage() {
  const { toast } = useToast();
  const [localPrefs, setLocalPrefs] = useState<NotificationPreferences | null>(null);
  const [localPhone, setLocalPhone] = useState<string>("");
  const [localSmsOptIn, setLocalSmsOptIn] = useState<boolean>(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const { orgId, isLoading: orgLoading } = useActiveOrg();

  const prefsUrl = orgId
    ? `/api/notification-preferences?orgId=${orgId}`
    : "/api/notification-preferences";

  const {
    data: prefsData,
    isLoading: prefsLoading,
    error: prefsError,
  } = useQuery<PrefsResponse>({
    queryKey: ["/api/notification-preferences", orgId],
    queryFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(prefsUrl, {
        credentials: "include",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("Failed to load preferences");
      return res.json();
    },
    // Only fetch once orgId is confirmed — avoids firing with null orgId
    enabled: !!orgId && !orgLoading,
  });

  useEffect(() => {
    if (prefsData && localPrefs === null) {
      setLocalPhone(prefsData.phone || "");
      setLocalSmsOptIn(prefsData.smsOptIn ?? false);
    }
  }, [prefsData, localPrefs]);

  const prefsMutation = useMutation({
    mutationFn: async (payload: { preferences: NotificationPreferences; phone: string; smsOptIn: boolean }) => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save preferences");
      return data;
    },
    onSuccess: () => {
      setPhoneError(null);
      // Invalidate with orgId so the correct cache entry is refreshed
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences", orgId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      setPrefsSaved(true);
      toast({ title: "Preferences saved" });
    },
    onError: (err: Error) => {
      const msg = err.message || "Failed to save preferences";
      if (msg.toLowerCase().includes("phone") || msg.toLowerCase().includes("number")) {
        setPhoneError(msg);
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    },
  });

  const currentPrefs = localPrefs ?? (prefsData ? {
    email: { ...DEFAULT_CHANNEL_PREFS, ...prefsData.preferences.email },
    sms: { ...DEFAULT_SMS_PREFS, ...prefsData.preferences.sms },
  } : null);

  const toggleEmailPref = (key: keyof ChannelPrefs) => {
    if (!currentPrefs) return;
    setPrefsSaved(false);
    setLocalPrefs({ ...currentPrefs, email: { ...currentPrefs.email, [key]: !currentPrefs.email[key] } });
  };

  const toggleSmsPref = (key: keyof ChannelPrefs) => {
    if (!currentPrefs) return;
    setPrefsSaved(false);
    setLocalPrefs({ ...currentPrefs, sms: { ...currentPrefs.sms, [key]: !currentPrefs.sms[key] } });
  };

  const savePrefs = () => {
    if (!currentPrefs) return;
    prefsMutation.mutate({ preferences: currentPrefs, phone: localPhone, smsOptIn: localSmsOptIn });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-settings-title">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your notification preferences</p>
        </div>
      </div>

      {orgLoading || prefsLoading ? (
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
      ) : !orgId ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground" data-testid="text-no-org">
              No organization found for this account. Contact your coach or administrator to get connected.
            </p>
          </CardContent>
        </Card>
      ) : currentPrefs ? (
        <>
          {/* Phone & SMS Opt-in */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold" data-testid="heading-sms-settings">SMS Settings</h2>
              </div>
              <p className="text-sm text-muted-foreground -mt-2">
                Add your phone number and opt in to receive text message notifications.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="phone-input">Mobile Phone Number</Label>
                <Input
                  id="phone-input"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={localPhone}
                  onChange={(e) => { setLocalPhone(e.target.value); setPrefsSaved(false); setPhoneError(null); }}
                  className={phoneError ? "border-destructive" : ""}
                  data-testid="input-phone"
                />
                {phoneError && (
                  <p className="text-xs text-destructive" data-testid="text-phone-error">{phoneError}</p>
                )}
                {!localPhone && !prefsLoading && (
                  <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-phone-nudge">
                    Add your phone number to enable SMS reminders.
                  </p>
                )}
              </div>
              <div className="flex items-start justify-between gap-4 pt-1" data-testid="row-sms-opt-in">
                <div className="flex-1">
                  <span className="text-sm font-medium">Enable SMS Notifications</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Opt in to receive text message notifications. Reply STOP at any time to unsubscribe.
                  </p>
                </div>
                <Switch
                  checked={localSmsOptIn}
                  onCheckedChange={(val) => { setLocalSmsOptIn(val); setPrefsSaved(false); }}
                  data-testid="switch-sms-opt-in"
                />
              </div>
            </CardContent>
          </Card>

          {/* Email Preferences */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-1">
                <Mail className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold" data-testid="heading-email-preferences">Email Notifications</h2>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 mb-5">
                Choose which emails you receive from TrainEfficiency.
              </p>
              <div className="space-y-5">
                {PREF_META.map(({ key, label, emailDesc, essential }) => (
                  <div key={key} className="flex items-start justify-between gap-4" data-testid={`pref-row-email-${key}`}>
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
                      <p className="text-xs text-muted-foreground mt-0.5">{emailDesc}</p>
                    </div>
                    <Switch
                      checked={currentPrefs.email[key]}
                      onCheckedChange={() => toggleEmailPref(key)}
                      data-testid={`switch-pref-email-${key}`}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* SMS Preferences */}
          {localSmsOptIn && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold" data-testid="heading-sms-preferences">SMS Notifications</h2>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 mb-5">
                  Choose which text messages you receive. You can always reply STOP to unsubscribe.
                </p>
                <div className="space-y-5">
                  {PREF_META.map(({ key, label, smsDesc, essential }) => (
                    <div key={key} className="flex items-start justify-between gap-4" data-testid={`pref-row-sms-${key}`}>
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
                        <p className="text-xs text-muted-foreground mt-0.5">{smsDesc}</p>
                      </div>
                      <Switch
                        checked={currentPrefs.sms[key]}
                        onCheckedChange={() => toggleSmsPref(key)}
                        data-testid={`switch-pref-sms-${key}`}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Save button */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={savePrefs}
              disabled={prefsMutation.isPending}
              data-testid="button-save-preferences"
            >
              {prefsMutation.isPending ? "Saving..." : "Save Preferences"}
            </Button>
            {prefsSaved && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400" data-testid="text-preferences-saved">
                <CheckCircle className="h-4 w-4" />
                Preferences saved successfully
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Essential notifications (booking confirmations, cancellations, reschedule notices) help keep your schedule accurate.
            You can disable them, but we recommend keeping them on.
          </p>
        </>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground" data-testid="text-prefs-error">
              {prefsError instanceof Error ? prefsError.message : "Unable to load preferences. Please refresh the page."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
