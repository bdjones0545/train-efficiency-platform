import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/authToken";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Calendar, Clock, X, Users, MapPin, CheckCircle, Shield, Bell, MessageSquare, Mail } from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { AddSessionDialog } from "@/components/add-session-dialog";
import type { BookingWithDetails, ParticipantWithUser } from "@/lib/types";
import type { UserProfile } from "@shared/schema";

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

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  CONFIRMED: "bg-green-500/15 text-green-700 dark:text-green-400",
  CANCELLED: "bg-red-500/15 text-red-700 dark:text-red-400",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  NO_SHOW: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

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

export default function MyBookingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [localPrefs, setLocalPrefs] = useState<NotificationPreferences | null>(null);
  const [localPhone, setLocalPhone] = useState<string>("");
  const [localSmsOptIn, setLocalSmsOptIn] = useState<boolean>(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const { data: bookings, isLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/bookings"],
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
  });

  const { data: prefsData, isLoading: prefsLoading } = useQuery<PrefsResponse>({
    queryKey: ["/api/notification-preferences"],
  });

  useEffect(() => {
    if (prefsData && localPrefs === null) {
      setLocalPhone(prefsData.phone || "");
      setLocalSmsOptIn(prefsData.smsOptIn ?? false);
    }
  }, [prefsData, localPrefs]);

  const [phoneError, setPhoneError] = useState<string | null>(null);

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

  const isCoach = profile?.role === "COACH" || profile?.role === "ADMIN";

  const cancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiRequest("PATCH", `/api/bookings/${bookingId}/status`, { status: "CANCELLED" });
      return res.json();
    },
    onSuccess: () => {
      setCancellingId(null);
      toast({ title: "Booking Cancelled" });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions/open"] });
    },
    onError: (error: Error) => {
      setCancellingId(null);
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const upcoming = (bookings?.filter(
    (b) => ["CONFIRMED", "PENDING"].includes(b.status) && !isPast(parseISO(b.startAt as unknown as string))
  ) || []).sort((a, b) =>
    parseISO(a.startAt as unknown as string).getTime() - parseISO(b.startAt as unknown as string).getTime()
  );

  const past = (bookings?.filter(
    (b) => !["CONFIRMED", "PENDING"].includes(b.status) || isPast(parseISO(b.startAt as unknown as string))
  ) || []).sort((a, b) =>
    parseISO(b.startAt as unknown as string).getTime() - parseISO(a.startAt as unknown as string).getTime()
  );

  const renderBooking = (booking: BookingWithDetails, showCancel = false) => (
    <Card key={booking.id} className="p-4" data-testid={`card-booking-${booking.id}`}>
      <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{booking.service?.name || "Session"}</h3>
            <Badge className={`text-xs ${statusColors[booking.status] || ""}`}>
              {booking.status}
            </Badge>
            {booking.maxParticipants && (
              <Badge variant="secondary" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                Group
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            {format(parseISO(booking.startAt as unknown as string), "EEEE, MMM d, yyyy")}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {format(parseISO(booking.startAt as unknown as string), "h:mm a")} —{" "}
            {format(parseISO(booking.endAt as unknown as string), "h:mm a")}
          </div>
          {booking.coach?.user && (
            <p className="text-sm text-muted-foreground">
              Coach: {booking.coach.user.firstName} {booking.coach.user.lastName}
            </p>
          )}
          {booking.location && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`text-location-${booking.id}`}>
              <MapPin className="h-3.5 w-3.5" />
              {booking.location}
            </div>
          )}
          {booking.maxParticipants && booking.groupDescription && (
            <p className="text-sm text-muted-foreground">{booking.groupDescription}</p>
          )}
        </div>
        {showCancel && booking.status === "CONFIRMED" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={cancelMutation.isPending && cancellingId === booking.id}
                data-testid={`button-cancel-booking-${booking.id}`}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. Your session will be cancelled.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid={`button-keep-booking-${booking.id}`}>
                  Keep Booking
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid={`button-confirm-cancel-${booking.id}`}
                  onClick={() => {
                    setCancellingId(booking.id);
                    cancelMutation.mutate(booking.id);
                  }}
                >
                  Yes, Cancel Session
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </Card>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold" data-testid="text-bookings-title">My Bookings</h1>
          <p className="text-muted-foreground mt-1">Manage your training sessions</p>
        </div>
        {isCoach && <AddSessionDialog />}
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming" data-testid="tab-upcoming">
            Upcoming ({upcoming.length})
          </TabsTrigger>
          <TabsTrigger value="past" data-testid="tab-past">
            Past ({past.length})
          </TabsTrigger>
          <TabsTrigger value="preferences" data-testid="tab-preferences">
            <Bell className="h-3.5 w-3.5 mr-1.5" />
            Notifications
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="space-y-3 mt-4">
          {upcoming.length === 0 ? (
            <Card className="p-8 text-center">
              <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No upcoming sessions</p>
              <Button variant="outline" className="mt-3" onClick={() => navigate("/coaches")}>
                Browse Coaches
              </Button>
            </Card>
          ) : (
            upcoming.map((b) => renderBooking(b, true))
          )}
        </TabsContent>
        <TabsContent value="past" className="space-y-3 mt-4">
          {past.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No past sessions</p>
            </Card>
          ) : (
            past.map((b) => renderBooking(b))
          )}
        </TabsContent>
        <TabsContent value="preferences" className="mt-4 space-y-4">
          {prefsLoading ? (
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
                  data-testid="button-save-email-preferences"
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
                <p className="text-sm text-muted-foreground">Unable to load preferences.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
