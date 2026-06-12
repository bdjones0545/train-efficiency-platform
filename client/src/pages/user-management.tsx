import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { QueryErrorState } from "@/components/query-error-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Search, Pencil, Trash2, Calendar, UserPlus, ChevronLeft, Clock, MapPin, UserCog, Upload, FileSpreadsheet, CheckCircle, AlertCircle, SkipForward, RefreshCw, MessageSquare, Lock, Phone, Mail, User as UserIcon, CreditCard, MessageCircle, StickyNote } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { UserProfile, Booking, Service, Redemption } from "@shared/schema";
import type { User } from "@shared/models/auth";

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = headerLine.split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));

  const fieldMap: Record<string, string> = {};
  for (const h of headers) {
    if (h.match(/first\s*name|firstname/i)) fieldMap[h] = "firstName";
    else if (h.match(/last\s*name|lastname/i)) fieldMap[h] = "lastName";
    else if (h.match(/^name$/i)) fieldMap[h] = "fullName";
    else if (h.match(/email/i)) fieldMap[h] = "email";
    else if (h.match(/phone|mobile|cell|telephone/i)) fieldMap[h] = "phone";
    else if (h.match(/note|notes|comment|comments/i)) fieldMap[h] = "notes";
  }

  return lines.slice(1).map(line => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const mapped = fieldMap[h];
      if (mapped && idx < values.length) {
        row[mapped] = values[idx];
      }
    });

    if (row.fullName && !row.firstName) {
      const parts = row.fullName.trim().split(/\s+/);
      row.firstName = parts[0] || "";
      row.lastName = parts.slice(1).join(" ") || "";
      delete row.fullName;
    }

    return row;
  }).filter(r => r.email || r.firstName);
}

type ImportResult = {
  email: string;
  status: string;
  name?: string;
};

type ImportResponse = {
  success: boolean;
  summary: { total: number; created: number; skipped: number; errors: number };
  results: ImportResult[];
};

type UserWithProfile = User & { profile?: UserProfile };

type UserBooking = Booking & {
  service?: Service;
  coach?: { user: User } & Record<string, any>;
  redemption?: Redemption;
};

export default function UserManagementPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserWithProfile | null>(null);
  const [editUser, setEditUser] = useState<UserWithProfile | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserWithProfile | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editBooking, setEditBooking] = useState<UserBooking | null>(null);
  const [editBookingDate, setEditBookingDate] = useState("");
  const [editBookingTime, setEditBookingTime] = useState("");
  const [editBookingStatus, setEditBookingStatus] = useState("");
  const [deleteBooking, setDeleteBooking] = useState<UserBooking | null>(null);
  const [addParticipantBooking, setAddParticipantBooking] = useState<UserBooking | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");

  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<Record<string, string>[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [importResults, setImportResults] = useState<ImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [coachDialogOpen, setCoachDialogOpen] = useState(false);
  const [newCoachFirstName, setNewCoachFirstName] = useState("");
  const [newCoachLastName, setNewCoachLastName] = useState("");
  const [newCoachEmail, setNewCoachEmail] = useState("");
  const [newCoachPassword, setNewCoachPassword] = useState("");
  const [newCoachBio, setNewCoachBio] = useState("");
  const [newCoachSpecialties, setNewCoachSpecialties] = useState("");

  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [newClientFirstName, setNewClientFirstName] = useState("");
  const [newClientLastName, setNewClientLastName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientNotes, setNewClientNotes] = useState("");

  const { data: users, isLoading, isError, refetch } = useQuery<UserWithProfile[]>({
    queryKey: ["/api/coach/users"],
  });

  const { data: clientSubscriptions } = useQuery<any[]>({
    queryKey: ["/api/coach/client-subscriptions"],
  });

  const subscribedUserIds = new Set(
    (clientSubscriptions || [])
      .filter(s => s.status === "active" || s.status === "trialing")
      .map(s => s.userId)
  );

  const { data: userBookings, isLoading: bookingsLoading } = useQuery<UserBooking[]>({
    queryKey: ["/api/coach/users", selectedUser?.id, "bookings"],
    enabled: !!selectedUser,
  });

  const { data: participantSearchResults } = useQuery<User[]>({
    queryKey: ["/api/coach/clients/search", participantSearch],
    enabled: participantSearch.length >= 2,
  });

  const updateUserMutation = useMutation({
    mutationFn: async (data: { id: string; firstName: string; lastName: string; email: string }) => {
      const res = await apiRequest("PATCH", `/api/coach/users/${data.id}`, {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "User updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users"] });
      setEditUser(null);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/coach/users/${id}`);
    },
    onSuccess: () => {
      toast({ title: "User deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users"] });
      if (selectedUser?.id === deleteUser?.id) setSelectedUser(null);
      setDeleteUser(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateBookingMutation = useMutation({
    mutationFn: async (data: { id: string; startAt?: string; status?: string }) => {
      if (data.status) {
        const res = await apiRequest("PATCH", `/api/bookings/${data.id}/status`, { status: data.status });
        return res.json();
      }
      const res = await apiRequest("PATCH", `/api/coach/bookings/${data.id}`, { startAt: data.startAt });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Session updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users", selectedUser?.id, "bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      setEditBooking(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteBookingMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/coach/bookings/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Session deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users", selectedUser?.id, "bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      setDeleteBooking(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createCoachMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string; password: string; bio: string; specialties: string[] }) => {
      const res = await apiRequest("POST", "/api/admin/coaches", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coach Added", description: "Welcome email has been sent to the new coach." });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users"] });
      setCoachDialogOpen(false);
      setNewCoachFirstName("");
      setNewCoachLastName("");
      setNewCoachEmail("");
      setNewCoachPassword("");
      setNewCoachBio("");
      setNewCoachSpecialties("");
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", variant: "destructive" });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateCoach = () => {
    if (!newCoachFirstName || !newCoachLastName || !newCoachEmail || !newCoachPassword) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createCoachMutation.mutate({
      firstName: newCoachFirstName,
      lastName: newCoachLastName,
      email: newCoachEmail,
      password: newCoachPassword,
      bio: newCoachBio,
      specialties: newCoachSpecialties ? newCoachSpecialties.split(",").map(s => s.trim()).filter(Boolean) : [],
    });
  };

  const addParticipantMutation = useMutation({
    mutationFn: async (data: { bookingId: string; userId: string; participantName?: string }) => {
      const res = await apiRequest("POST", `/api/coach/bookings/${data.bookingId}/add-participant`, {
        userId: data.userId,
        participantName: data.participantName,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Participant added" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users", selectedUser?.id, "bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      setAddParticipantBooking(null);
      setParticipantSearch("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createClientMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string; phone?: string; notes?: string }) => {
      const res = await apiRequest("POST", "/api/admin/import-csv", {
        rows: [data],
      });
      return res.json() as Promise<ImportResponse>;
    },
    onSuccess: (data) => {
      const result = data.results?.[0];
      if (result?.status === "created") {
        toast({ title: "Client added", description: "Invite email sent" });
      } else if (result?.status === "already_exists") {
        toast({ title: "Client already exists", description: "This email is already registered", variant: "destructive" });
      } else {
        toast({ title: "Could not add client", description: result?.status || "Unknown error", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users"] });
      setClientDialogOpen(false);
      setNewClientFirstName("");
      setNewClientLastName("");
      setNewClientEmail("");
      setNewClientPhone("");
      setNewClientNotes("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateClient = () => {
    if (!newClientFirstName || !newClientEmail) {
      toast({ title: "First name and email are required", variant: "destructive" });
      return;
    }
    createClientMutation.mutate({
      firstName: newClientFirstName,
      lastName: newClientLastName,
      email: newClientEmail,
      phone: newClientPhone || undefined,
      notes: newClientNotes || undefined,
    });
  };

  const importCsvMutation = useMutation({
    mutationFn: async (rows: Record<string, string>[]) => {
      const res = await apiRequest("POST", "/api/admin/import-csv", { rows });
      return res.json() as Promise<ImportResponse>;
    },
    onSuccess: (data) => {
      setImportResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users"] });
      toast({ title: `Import complete: ${data.summary.created} clients added` });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const handleCsvFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    setImportResults(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setCsvPreview(parsed);
      setCsvDialogOpen(true);
    };
    reader.readAsText(file);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImportCsv = () => {
    if (csvPreview.length === 0) return;
    importCsvMutation.mutate(csvPreview);
  };

  const closeCsvDialog = () => {
    setCsvDialogOpen(false);
    setCsvPreview([]);
    setCsvFileName("");
    setImportResults(null);
  };

  const filteredUsers = users?.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (u.firstName?.toLowerCase() || "").includes(q) ||
      (u.lastName?.toLowerCase() || "").includes(q) ||
      (u.email?.toLowerCase() || "").includes(q)
    );
  }) || [];

  const openEditUser = (user: UserWithProfile) => {
    setEditFirstName(user.firstName || "");
    setEditLastName(user.lastName || "");
    setEditEmail(user.email || "");
    setEditUser(user);
  };

  const openEditBooking = (booking: UserBooking) => {
    const startDt = parseISO(booking.startAt as unknown as string);
    setEditBookingDate(format(startDt, "yyyy-MM-dd"));
    setEditBookingTime(format(startDt, "HH:mm"));
    setEditBookingStatus(booking.status);
    setEditBooking(booking);
  };

  const handleSaveBooking = async () => {
    if (!editBooking) return;
    const startDtOrig = parseISO(editBooking.startAt as unknown as string);
    const origDate = format(startDtOrig, "yyyy-MM-dd");
    const origTime = format(startDtOrig, "HH:mm");
    const dateTimeChanged = editBookingDate !== origDate || editBookingTime !== origTime;
    const statusChanged = editBookingStatus !== editBooking.status;

    try {
      if (dateTimeChanged) {
        const startAt = new Date(`${editBookingDate}T${editBookingTime}`).toISOString();
        await apiRequest("PATCH", `/api/coach/bookings/${editBooking.id}`, { startAt });
      }
      if (statusChanged) {
        await apiRequest("PATCH", `/api/bookings/${editBooking.id}/status`, { status: editBookingStatus });
      }
      toast({ title: "Session updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/users", selectedUser?.id, "bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/bookings"] });
      setEditBooking(null);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  if (selectedUser) {
    const isSubscribed = subscribedUserIds.has(selectedUser.id);
    const walletDollars = selectedUser.balanceCents != null ? (selectedUser.balanceCents / 100).toFixed(2) : null;

    return (
      <div className="space-y-4">
        {/* Header row */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" onClick={() => setSelectedUser(null)} data-testid="button-back-to-users">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Avatar className="h-9 w-9">
              <AvatarImage src={selectedUser.profileImageUrl || undefined} />
              <AvatarFallback className="text-sm bg-primary/10 text-primary">
                {(selectedUser.firstName?.[0] || "U").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate" data-testid="text-selected-user-name">
                {selectedUser.firstName} {selectedUser.lastName}
              </h2>
              {selectedUser.email && (
                <p className="text-sm text-muted-foreground truncate">{selectedUser.email}</p>
              )}
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">{selectedUser.profile?.role || "CLIENT"}</Badge>
        </div>

        {/* User info card */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Client Info</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {selectedUser.email && (
              <div className="flex items-center gap-2 text-sm" data-testid="text-user-email">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">{selectedUser.email}</span>
              </div>
            )}
            {selectedUser.phone ? (
              <div className="flex items-center gap-2 text-sm" data-testid="text-user-phone">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{selectedUser.phone}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-user-phone-missing">
                <Phone className="h-4 w-4 shrink-0" />
                <span>No phone on file</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm" data-testid="text-user-role">
              <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Role: <span className="font-medium">{selectedUser.profile?.role || "CLIENT"}</span></span>
            </div>
            <div className="flex items-center gap-2 text-sm" data-testid="text-user-account-status">
              <CheckCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Account: <span className={`font-medium ${isSubscribed ? "text-green-600 dark:text-green-400" : ""}`}>
                {isSubscribed ? "Subscribed" : selectedUser.lastSignInAt ? "Active" : "Pending"}
              </span></span>
            </div>
            <div className="flex items-center gap-2 text-sm" data-testid="text-user-sms-status">
              <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>SMS: <span className={`font-medium ${selectedUser.smsOptIn ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                {selectedUser.smsOptIn ? "Opted In" : selectedUser.phone ? "Not opted in" : "No phone"}
              </span></span>
            </div>
            {walletDollars !== null && (
              <div className="flex items-center gap-2 text-sm" data-testid="text-user-wallet">
                <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>Dollar Balance: <span className={`font-medium ${selectedUser.balanceCents! < 0 ? "text-red-600 dark:text-red-400" : selectedUser.balanceCents! > 0 ? "text-green-600 dark:text-green-400" : ""}`}>{selectedUser.balanceCents! < 0 ? `Owes $${Math.abs(selectedUser.balanceCents!/ 100).toFixed(2)}` : `$${walletDollars}`}</span></span>
              </div>
            )}
          </div>
          {selectedUser.notes && (
            <div className="mt-3 pt-3 border-t flex items-start gap-2 text-sm" data-testid="text-user-notes">
              <StickyNote className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <span className="text-muted-foreground font-medium">Notes: </span>
                <span>{selectedUser.notes}</span>
              </div>
            </div>
          )}
        </Card>

        <h3 className="text-base font-medium" data-testid="text-sessions-header">Session History</h3>

        {bookingsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : !userBookings || userBookings.length === 0 ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground text-center" data-testid="text-no-sessions">No sessions found for this user.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {userBookings.map((booking) => {
              const startDt = parseISO(booking.startAt as unknown as string);
              const endDt = parseISO(booking.endAt as unknown as string);
              const isSemiPrivate = booking.maxParticipants && booking.maxParticipants > 1;
              const isRedeemed = booking.status === "COMPLETED" || !!booking.redemption;
              const isLocked = isRedeemed;

              const statusVariant = booking.status === "CONFIRMED"
                ? "default"
                : booking.status === "COMPLETED"
                ? "secondary"
                : booking.status === "CANCELLED"
                ? "outline"
                : "outline";

              const paymentLabel = booking.paymentMethod === "WALLET"
                ? "Wallet credit"
                : booking.paymentMethod === "VENMO"
                ? "Venmo"
                : booking.paymentMethod === "CASH"
                ? "Cash"
                : booking.subscriptionPlanId
                ? "Subscription"
                : null;

              return (
                <Card key={booking.id} className={`p-3 ${isLocked ? "opacity-90 border-muted" : ""}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" data-testid={`text-booking-service-${booking.id}`}>
                          {booking.service?.name || "Session"}
                        </span>
                        <Badge
                          variant={statusVariant}
                          data-testid={`badge-status-${booking.id}`}
                        >
                          {booking.status}
                        </Badge>
                        {isRedeemed ? (
                          <Badge
                            variant="secondary"
                            className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                            data-testid={`badge-redeemed-${booking.id}`}
                          >
                            <Lock className="h-3 w-3" />
                            Redeemed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-700 dark:text-green-400 border-green-300 dark:border-green-700" data-testid={`badge-not-redeemed-${booking.id}`}>
                            Not Redeemed
                          </Badge>
                        )}
                        {isSemiPrivate && <Badge variant="outline">Semi-Private</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(startDt, "MMM d, yyyy")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(startDt, "h:mm a")} – {format(endDt, "h:mm a")}
                        </span>
                        {booking.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {booking.location}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {booking.coach?.user && (
                          <span>Coach: {booking.coach.user.firstName} {booking.coach.user.lastName}</span>
                        )}
                        {paymentLabel && (
                          <span className="flex items-center gap-1">
                            <CreditCard className="h-3 w-3" />
                            {paymentLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isSemiPrivate && !isLocked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setAddParticipantBooking(booking)}
                          title="Add participant"
                          data-testid={`button-add-participant-${booking.id}`}
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      )}
                      {isLocked ? (
                        <span title="Redeemed sessions are locked and cannot be changed.">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled
                            data-testid={`button-edit-booking-${booking.id}`}
                          >
                            <Lock className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEditBooking(booking)}
                          title="Edit session"
                          data-testid={`button-edit-booking-${booking.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {!isLocked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteBooking(booking)}
                          title="Delete session"
                          data-testid={`button-delete-booking-${booking.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!editBooking} onOpenChange={(open) => { if (!open) setEditBooking(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editBookingDate}
                  onChange={(e) => setEditBookingDate(e.target.value)}
                  data-testid="input-edit-booking-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input
                  type="time"
                  value={editBookingTime}
                  onChange={(e) => setEditBookingTime(e.target.value)}
                  data-testid="input-edit-booking-time"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editBookingStatus} onValueChange={setEditBookingStatus}>
                  <SelectTrigger data-testid="select-booking-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                    <SelectItem value="NO_SHOW">No Show</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditBooking(null)} data-testid="button-cancel-edit-booking">Cancel</Button>
              <Button onClick={handleSaveBooking} disabled={updateBookingMutation.isPending} data-testid="button-save-booking">
                {updateBookingMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteBooking} onOpenChange={(open) => { if (!open) setDeleteBooking(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Session</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this session? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-booking">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteBooking && deleteBookingMutation.mutate(deleteBooking.id)}
                data-testid="button-confirm-delete-booking"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!addParticipantBooking} onOpenChange={(open) => { if (!open) { setAddParticipantBooking(null); setParticipantSearch(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Participant to Semi-Private</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Search for user</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name..."
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    className="pl-9"
                    data-testid="input-participant-search"
                  />
                </div>
              </div>
              {participantSearchResults && participantSearchResults.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {participantSearchResults.map((user) => (
                    <Button
                      key={user.id}
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => {
                        if (addParticipantBooking) {
                          addParticipantMutation.mutate({
                            bookingId: addParticipantBooking.id,
                            userId: user.id,
                            participantName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
                          });
                        }
                      }}
                      data-testid={`button-add-user-${user.id}`}
                    >
                      <Avatar className="h-6 w-6 mr-2">
                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                          {(user.firstName?.[0] || "U").toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{user.firstName} {user.lastName}</span>
                      {user.email && <span className="text-xs text-muted-foreground ml-2">{user.email}</span>}
                    </Button>
                  ))}
                </div>
              )}
              {participantSearch.length >= 2 && (!participantSearchResults || participantSearchResults.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-2">No users found</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-x-hidden max-w-full w-full">
      {/* Title row */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">User Management</h1>
        <Badge variant="secondary" data-testid="text-user-count">{filteredUsers.length} users</Badge>
      </div>

      {/* Action buttons — stacked on mobile, row on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="file"
          accept=".csv"
          ref={fileInputRef}
          onChange={handleCsvFileSelect}
          className="hidden"
          data-testid="input-csv-file"
        />
        <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()} data-testid="button-import-csv">
          <Upload className="h-4 w-4 mr-1" />
          Import CSV
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setClientDialogOpen(true)} data-testid="button-add-client">
          <UserPlus className="h-4 w-4 mr-1" />
          Add Client
        </Button>
        <Button className="w-full" onClick={() => setCoachDialogOpen(true)} data-testid="button-add-coach">
          <UserCog className="h-4 w-4 mr-1" />
          Add Coach
        </Button>
      </div>

      <Dialog open={coachDialogOpen} onOpenChange={setCoachDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Coach</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>First Name</Label>
                    <Input
                      value={newCoachFirstName}
                      onChange={(e) => setNewCoachFirstName(e.target.value)}
                      placeholder="John"
                      data-testid="input-coach-first-name"
                    />
                  </div>
                  <div>
                    <Label>Last Name</Label>
                    <Input
                      value={newCoachLastName}
                      onChange={(e) => setNewCoachLastName(e.target.value)}
                      placeholder="Smith"
                      data-testid="input-coach-last-name"
                    />
                  </div>
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={newCoachEmail}
                    onChange={(e) => setNewCoachEmail(e.target.value)}
                    placeholder="coach@example.com"
                    data-testid="input-coach-email"
                  />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input
                    type="text"
                    value={newCoachPassword}
                    onChange={(e) => setNewCoachPassword(e.target.value)}
                    placeholder="Initial login password"
                    data-testid="input-coach-password"
                  />
                </div>
                <div>
                  <Label>Bio</Label>
                  <Textarea
                    value={newCoachBio}
                    onChange={(e) => setNewCoachBio(e.target.value)}
                    placeholder="Brief bio about the coach..."
                    data-testid="input-coach-bio"
                  />
                </div>
                <div>
                  <Label>Specialties (comma-separated)</Label>
                  <Input
                    value={newCoachSpecialties}
                    onChange={(e) => setNewCoachSpecialties(e.target.value)}
                    placeholder="Strength & Conditioning, Speed Training"
                    data-testid="input-coach-specialties"
                  />
                </div>
                <Button onClick={handleCreateCoach} disabled={createCoachMutation.isPending} className="w-full" data-testid="button-submit-coach">
                  {createCoachMutation.isPending ? "Adding Coach..." : "Add Coach"}
                </Button>
              </div>
            </DialogContent>
      </Dialog>

      <div className="relative w-full max-w-full">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 w-full"
          data-testid="input-search-users"
        />
      </div>

      {isError ? (
        <QueryErrorState
          title="Unable to load users"
          message="There was a problem fetching athlete and client data. Please try again."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : filteredUsers.length === 0 ? (
        <Card className="p-8">
          <p className="text-sm text-muted-foreground text-center" data-testid="text-no-users">No users found.</p>
        </Card>
      ) : (
        <div className="space-y-1">
          {filteredUsers.map((user) => (
            <Card
              key={user.id}
              className="p-3 hover-elevate cursor-pointer"
              onClick={() => setSelectedUser(user)}
              data-testid={`card-user-${user.id}`}
            >
              {/* Top row: avatar + name/email/phone + badges + desktop actions */}
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={user.profileImageUrl || undefined} />
                  <AvatarFallback className="text-sm bg-primary/10 text-primary">
                    {(user.firstName?.[0] || "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <p className="text-sm font-medium truncate min-w-0" data-testid={`text-user-name-${user.id}`}>
                      {user.firstName} {user.lastName}
                    </p>
                    {subscribedUserIds.has(user.id) && (
                      <Badge className="shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`badge-subscribed-${user.id}`}>
                        <RefreshCw className="h-3 w-3 mr-0.5" />
                        Sub
                      </Badge>
                    )}
                    <Badge variant="outline" className="shrink-0 text-xs" data-testid={`badge-role-${user.id}`}>
                      {user.profile?.role || "CLIENT"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email || "No email"}
                  </p>
                  {user.phone && (
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5" data-testid={`text-user-phone-${user.id}`}>
                      <MessageSquare className="h-3 w-3 shrink-0" />
                      {user.phone}
                      {user.smsOptIn ? (
                        <span className="text-green-600 dark:text-green-400 font-medium ml-0.5" data-testid={`badge-sms-opted-in-${user.id}`}>SMS on</span>
                      ) : (
                        <span className="text-muted-foreground/60 ml-0.5" data-testid={`badge-sms-opted-out-${user.id}`}>SMS off</span>
                      )}
                    </p>
                  )}
                </div>
                {/* Desktop-only icon buttons */}
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); openEditUser(user); }}
                    title="Edit user"
                    data-testid={`button-edit-user-${user.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); setDeleteUser(user); }}
                    title="Delete user"
                    data-testid={`button-delete-user-${user.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {/* Mobile-only action row */}
              <div className="flex sm:hidden items-center gap-2 mt-2 pt-2 border-t border-border/40">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs"
                  onClick={(e) => { e.stopPropagation(); openEditUser(user); }}
                  data-testid={`button-edit-user-mobile-${user.id}`}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs"
                  onClick={(e) => { e.stopPropagation(); setDeleteUser(user); }}
                  data-testid={`button-delete-user-mobile-${user.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input
                value={editFirstName}
                onChange={(e) => setEditFirstName(e.target.value)}
                data-testid="input-edit-first-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input
                value={editLastName}
                onChange={(e) => setEditLastName(e.target.value)}
                data-testid="input-edit-last-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                data-testid="input-edit-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)} data-testid="button-cancel-edit-user">Cancel</Button>
            <Button
              onClick={() => editUser && updateUserMutation.mutate({
                id: editUser.id,
                firstName: editFirstName,
                lastName: editLastName,
                email: editEmail,
              })}
              disabled={updateUserMutation.isPending}
              data-testid="button-save-user"
            >
              {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUser} onOpenChange={(open) => { if (!open) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteUser?.firstName} {deleteUser?.lastName}? This will also remove all their sessions and data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteUser && deleteUserMutation.mutate(deleteUser.id)}
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input
                  value={newClientFirstName}
                  onChange={(e) => setNewClientFirstName(e.target.value)}
                  placeholder="Jane"
                  data-testid="input-client-first-name"
                />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input
                  value={newClientLastName}
                  onChange={(e) => setNewClientLastName(e.target.value)}
                  placeholder="Doe"
                  data-testid="input-client-last-name"
                />
              </div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={newClientEmail}
                onChange={(e) => setNewClientEmail(e.target.value)}
                placeholder="client@example.com"
                data-testid="input-client-email"
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                type="tel"
                value={newClientPhone}
                onChange={(e) => setNewClientPhone(e.target.value)}
                placeholder="(555) 123-4567"
                data-testid="input-client-phone"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={newClientNotes}
                onChange={(e) => setNewClientNotes(e.target.value)}
                placeholder="Any notes about this client..."
                data-testid="input-client-notes"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The client will receive an email with a link to create their password and sign in.
            </p>
            <Button onClick={handleCreateClient} disabled={createClientMutation.isPending} className="w-full" data-testid="button-submit-client">
              {createClientMutation.isPending ? "Adding Client..." : "Add Client"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={csvDialogOpen} onOpenChange={(open) => { if (!open) closeCsvDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              {importResults ? "Import Results" : "Import Clients from CSV"}
            </DialogTitle>
          </DialogHeader>

          {importResults ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400 mb-1">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-lg font-bold" data-testid="text-import-created">{importResults.summary.created}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Created</p>
                </Card>
                <Card className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-yellow-600 dark:text-yellow-400 mb-1">
                    <SkipForward className="h-4 w-4" />
                    <span className="text-lg font-bold" data-testid="text-import-skipped">{importResults.summary.skipped}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </Card>
                <Card className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-red-600 dark:text-red-400 mb-1">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-lg font-bold" data-testid="text-import-errors">{importResults.summary.errors}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </Card>
              </div>

              <div className="space-y-1 max-h-60 overflow-y-auto">
                {importResults.results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 px-2 rounded" data-testid={`row-import-result-${i}`}>
                    {r.status === "created" && <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                    {r.status === "already_exists" && <SkipForward className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                    {r.status.startsWith("skipped") && <SkipForward className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                    {r.status === "error" && <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                    <span className="truncate flex-1">{r.name || r.email}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {r.status === "created" ? "Invite sent" :
                       r.status === "already_exists" ? "Already exists" :
                       r.status === "skipped_invalid_email" ? "Invalid email" :
                       r.status === "skipped_missing_name" ? "Missing name" : "Error"}
                    </span>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button onClick={closeCsvDialog} data-testid="button-close-import">Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">CSV Format</p>
                <p className="text-xs text-muted-foreground">
                  Your CSV should have headers for: <strong>First Name</strong>, <strong>Last Name</strong> (or <strong>Name</strong>), <strong>Email</strong>.
                  Optional: <strong>Phone</strong>, <strong>Notes</strong>.
                </p>
                <p className="text-xs text-muted-foreground">
                  Each imported client will receive an email with a link to create their password.
                </p>
              </div>

              {csvFileName && (
                <p className="text-sm">
                  File: <strong>{csvFileName}</strong> — {csvPreview.length} row{csvPreview.length !== 1 ? "s" : ""} found
                </p>
              )}

              {csvPreview.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-48">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="px-3 py-2 text-left font-medium">Name</th>
                          <th className="px-3 py-2 text-left font-medium">Email</th>
                          {csvPreview.some(r => r.phone) && <th className="px-3 py-2 text-left font-medium">Phone</th>}
                          {csvPreview.some(r => r.notes) && <th className="px-3 py-2 text-left font-medium">Notes</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.slice(0, 10).map((row, i) => (
                          <tr key={i} className="border-b last:border-0" data-testid={`row-csv-preview-${i}`}>
                            <td className="px-3 py-1.5">{row.firstName} {row.lastName || ""}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{row.email || "—"}</td>
                            {csvPreview.some(r => r.phone) && <td className="px-3 py-1.5 text-muted-foreground">{row.phone || "—"}</td>}
                            {csvPreview.some(r => r.notes) && <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[150px]">{row.notes || "—"}</td>}
                          </tr>
                        ))}
                        {csvPreview.length > 10 && (
                          <tr>
                            <td colSpan={4} className="px-3 py-1.5 text-center text-xs text-muted-foreground">
                              ... and {csvPreview.length - 10} more
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {csvPreview.length === 0 && csvFileName && (
                <p className="text-sm text-red-500" data-testid="text-csv-empty">
                  No valid rows found in this file. Please check the CSV format.
                </p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={closeCsvDialog} data-testid="button-cancel-import">Cancel</Button>
                <Button
                  onClick={handleImportCsv}
                  disabled={csvPreview.length === 0 || importCsvMutation.isPending}
                  data-testid="button-confirm-import"
                >
                  {importCsvMutation.isPending ? "Importing..." : `Import ${csvPreview.length} Client${csvPreview.length !== 1 ? "s" : ""}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
