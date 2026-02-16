import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Search, Pencil, Trash2, Calendar, UserPlus, ChevronLeft, Clock, MapPin } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { UserProfile, Booking, Service } from "@shared/schema";
import type { User } from "@shared/models/auth";

type UserWithProfile = User & { profile?: UserProfile };

type UserBooking = Booking & {
  service?: Service;
  coach?: { user: User } & Record<string, any>;
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

  const { data: users, isLoading } = useQuery<UserWithProfile[]>({
    queryKey: ["/api/coach/users"],
  });

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
    return (
      <div className="space-y-4">
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

        <h3 className="text-base font-medium" data-testid="text-sessions-header">Sessions</h3>

        {bookingsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
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
              return (
                <Card key={booking.id} className="p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" data-testid={`text-booking-service-${booking.id}`}>
                          {booking.service?.name || "Session"}
                        </span>
                        <Badge
                          variant={booking.status === "CONFIRMED" ? "default" : booking.status === "COMPLETED" ? "secondary" : "outline"}
                          data-testid={`badge-status-${booking.id}`}
                        >
                          {booking.status}
                        </Badge>
                        {isSemiPrivate && <Badge variant="outline">Semi-Private</Badge>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(startDt, "MMM d, yyyy")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(startDt, "h:mm a")} - {format(endDt, "h:mm a")}
                        </span>
                        {booking.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {booking.location}
                          </span>
                        )}
                      </div>
                      {booking.coach?.user && (
                        <p className="text-xs text-muted-foreground">
                          Coach: {booking.coach.user.firstName} {booking.coach.user.lastName}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isSemiPrivate && (
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
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEditBooking(booking)}
                        title="Edit session"
                        data-testid={`button-edit-booking-${booking.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteBooking(booking)}
                        title="Delete session"
                        data-testid={`button-delete-booking-${booking.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">User Management</h1>
        <Badge variant="secondary" data-testid="text-user-count">{filteredUsers.length} users</Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-users"
        />
      </div>

      {isLoading ? (
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
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={user.profileImageUrl || undefined} />
                  <AvatarFallback className="text-sm bg-primary/10 text-primary">
                    {(user.firstName?.[0] || "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" data-testid={`text-user-name-${user.id}`}>
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email || "No email"}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0" data-testid={`badge-role-${user.id}`}>
                  {user.profile?.role || "CLIENT"}
                </Badge>
                <div className="flex items-center gap-1 shrink-0">
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
    </div>
  );
}
