import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, isSameDay, isToday, parseISO, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar,
  List,
  Filter,
  X,
  Clock,
  User as UserIcon,
  MapPin,
  Dumbbell,
  Bot,
} from "lucide-react";
import { Link } from "wouter";
import type { Booking, Service, CoachProfile, User } from "@shared/schema";

type BookingWithDetails = Booking & {
  service?: Service;
  client?: User;
  coach?: CoachProfile & { user: User };
};

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  COMPLETED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  NO_SHOW: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  RESCHEDULED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const SESSION_TYPE_LABELS: Record<string, string> = {
  "1_ON_1": "1-on-1",
  GROUP: "Group",
  SEMI_PRIVATE: "Semi-Private",
  TEAM_TRAINING: "Team Training",
  ASSESSMENT: "Assessment",
  RECOVERY: "Recovery",
};

const BOOKING_STATUSES = ["CONFIRMED", "PENDING", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"];

function BookingCard({ booking, onCancel, onReschedule, onComplete, onNoShow }: {
  booking: BookingWithDetails;
  onCancel: (b: BookingWithDetails) => void;
  onReschedule: (b: BookingWithDetails) => void;
  onComplete: (b: BookingWithDetails) => void;
  onNoShow: (b: BookingWithDetails) => void;
}) {
  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);
  const isPast = end < new Date();
  const isActive = booking.status === "CONFIRMED" || booking.status === "PENDING";

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`card-booking-${booking.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm" data-testid={`text-booking-service-${booking.id}`}>
                {booking.service?.name || "Session"}
              </span>
              <Badge
                variant="secondary"
                className={`text-xs ${STATUS_COLORS[booking.status] || ""}`}
                data-testid={`status-booking-${booking.id}`}
              >
                {booking.status}
              </Badge>
              {booking.service?.sessionType && (
                <Badge variant="outline" className="text-xs">
                  {SESSION_TYPE_LABELS[booking.service.sessionType] || booking.service.sessionType}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1" data-testid={`text-booking-time-${booking.id}`}>
                <Clock className="h-3 w-3" />
                {format(start, "EEE, MMM d")} · {format(start, "h:mm a")} – {format(end, "h:mm a")}
              </span>
              {booking.coach?.user && (
                <span className="flex items-center gap-1" data-testid={`text-booking-coach-${booking.id}`}>
                  <Dumbbell className="h-3 w-3" />
                  {booking.coach.user.firstName} {booking.coach.user.lastName}
                </span>
              )}
              {booking.client && (
                <span className="flex items-center gap-1" data-testid={`text-booking-client-${booking.id}`}>
                  <UserIcon className="h-3 w-3" />
                  {booking.client.firstName} {booking.client.lastName}
                </span>
              )}
              {booking.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {booking.location}
                </span>
              )}
            </div>

            {booking.notes && (
              <p className="text-xs text-muted-foreground italic">{booking.notes}</p>
            )}
          </div>

          {isActive && (
            <div className="flex gap-1.5 flex-wrap shrink-0">
              {!isPast && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onReschedule(booking)}
                  data-testid={`button-reschedule-${booking.id}`}
                >
                  Reschedule
                </Button>
              )}
              {isPast && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => onComplete(booking)}
                    data-testid={`button-complete-${booking.id}`}
                  >
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-orange-600 border-orange-200 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-900/20"
                    onClick={() => onNoShow(booking)}
                    data-testid={`button-noshow-${booking.id}`}
                  >
                    No Show
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => onCancel(booking)}
                data-testid={`button-cancel-booking-${booking.id}`}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WeekView({ bookings, currentWeek }: { bookings: BookingWithDetails[]; currentWeek: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentWeek, { weekStartsOn: 0 }), i));

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-7 gap-1 min-w-[700px]">
        {days.map(day => {
          const dayBookings = bookings.filter(b => isSameDay(new Date(b.startAt), day));
          const isCurrentDay = isToday(day);
          return (
            <div key={day.toISOString()} className="min-h-[200px]">
              <div className={`text-center py-2 px-1 rounded-md mb-1 text-xs font-medium ${isCurrentDay ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                <div>{format(day, "EEE")}</div>
                <div className={`text-sm font-bold ${isCurrentDay ? "" : "text-foreground"}`}>{format(day, "d")}</div>
              </div>
              <div className="space-y-1">
                {dayBookings.map(b => (
                  <div
                    key={b.id}
                    className={`p-1.5 rounded text-xs border ${STATUS_COLORS[b.status] || "bg-muted"} cursor-default`}
                    title={`${b.service?.name} - ${b.client?.firstName} ${b.client?.lastName}`}
                    data-testid={`week-booking-${b.id}`}
                  >
                    <div className="font-medium truncate">{format(new Date(b.startAt), "h:mm a")}</div>
                    <div className="truncate opacity-80">{b.service?.name}</div>
                    <div className="truncate opacity-70">{b.client?.firstName} {b.client?.lastName}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SchedulingPage() {
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "week">("list");
  const [currentWeek, setCurrentWeek] = useState(new Date());

  const [filterCoach, setFilterCoach] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSessionType, setFilterSessionType] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [cancelBooking, setCancelBooking] = useState<BookingWithDetails | null>(null);
  const [rescheduleBooking, setRescheduleBooking] = useState<BookingWithDetails | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [newBooking, setNewBooking] = useState({
    clientId: "", coachId: "", serviceId: "", startAt: "", endAt: "", notes: "", location: "",
  });

  const [rescheduleData, setRescheduleData] = useState({ startAt: "", endAt: "" });

  const { data: bookings = [], isLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/scheduling/bookings"],
  });

  const { data: coaches = [] } = useQuery<(CoachProfile & { user: User })[]>({
    queryKey: ["/api/coaches"],
  });

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const { data: orgUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/coach/users"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/scheduling/bookings/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling/bookings"] });
      toast({ title: "Booking updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, startAt, endAt }: { id: string; startAt: string; endAt: string }) =>
      apiRequest("PATCH", `/api/scheduling/bookings/${id}`, { startAt, endAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling/bookings"] });
      setRescheduleBooking(null);
      toast({ title: "Booking rescheduled" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof newBooking) => apiRequest("POST", "/api/scheduling/bookings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduling/bookings"] });
      setCreateOpen(false);
      setNewBooking({ clientId: "", coachId: "", serviceId: "", startAt: "", endAt: "", notes: "", location: "" });
      toast({ title: "Booking created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    return bookings.filter(b => {
      if (filterCoach !== "all" && b.coachId !== filterCoach) return false;
      if (filterStatus !== "all" && b.status !== filterStatus) return false;
      if (filterSessionType !== "all" && b.service?.sessionType !== filterSessionType) return false;
      if (filterLocation !== "all") {
        const locName = locations.find(l => l.id === filterLocation)?.name;
        if (locName && b.location !== locName) return false;
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const clientName = `${b.client?.firstName} ${b.client?.lastName}`.toLowerCase();
        const coachName = `${b.coach?.user?.firstName} ${b.coach?.user?.lastName}`.toLowerCase();
        const svcName = (b.service?.name || "").toLowerCase();
        if (!clientName.includes(q) && !coachName.includes(q) && !svcName.includes(q)) return false;
      }
      return true;
    });
  }, [bookings, filterCoach, filterStatus, filterSessionType, filterLocation, searchTerm, locations]);

  const weekBookings = useMemo(() => {
    const start = startOfWeek(currentWeek, { weekStartsOn: 0 });
    const end = endOfWeek(currentWeek, { weekStartsOn: 0 });
    return filtered.filter(b => {
      const d = new Date(b.startAt);
      return d >= start && d <= end;
    });
  }, [filtered, currentWeek]);

  const upcoming = useMemo(() => filtered.filter(b => new Date(b.startAt) >= new Date()), [filtered]);
  const past = useMemo(() => filtered.filter(b => new Date(b.startAt) < new Date()), [filtered]);

  const uniqueSessionTypes = useMemo(() => {
    const types = new Set(bookings.map(b => b.service?.sessionType).filter(Boolean));
    return Array.from(types) as string[];
  }, [bookings]);

  const hasFilters = filterCoach !== "all" || filterStatus !== "all" || filterSessionType !== "all" || filterLocation !== "all" || searchTerm;

  const clearFilters = () => {
    setFilterCoach("all");
    setFilterStatus("all");
    setFilterSessionType("all");
    setFilterLocation("all");
    setSearchTerm("");
  };

  const handleRescheduleSubmit = () => {
    if (!rescheduleBooking || !rescheduleData.startAt || !rescheduleData.endAt) return;
    rescheduleMutation.mutate({ id: rescheduleBooking.id, ...rescheduleData });
  };

  const handleCreateSubmit = () => {
    if (!newBooking.clientId || !newBooking.coachId || !newBooking.serviceId || !newBooking.startAt || !newBooking.endAt) {
      toast({ title: "Fill in all required fields", variant: "destructive" });
      return;
    }
    createMutation.mutate(newBooking);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-scheduling-title">Scheduling</h1>
          <p className="text-sm text-muted-foreground">Manage all bookings for your organization</p>
        </div>
        <div className="flex gap-2">
          <Link href="/scheduling/agent">
            <Button variant="outline" size="sm" data-testid="button-open-agent">
              <Bot className="h-4 w-4 mr-2" />
              Scheduling Agent
            </Button>
          </Link>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-booking">
            <Plus className="h-4 w-4 mr-2" />
            New Booking
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search client, coach, service..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-8 w-48 text-sm"
              data-testid="input-search-bookings"
            />
            <Select value={filterCoach} onValueChange={setFilterCoach}>
              <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-filter-coach">
                <SelectValue placeholder="All Coaches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Coaches</SelectItem>
                {coaches.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.user.firstName} {c.user.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-filter-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {BOOKING_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSessionType} onValueChange={setFilterSessionType}>
              <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-filter-session-type">
                <SelectValue placeholder="All Session Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {uniqueSessionTypes.map(t => (
                  <SelectItem key={t} value={t}>{SESSION_TYPE_LABELS[t] || t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {locations.length > 0 && (
              <Select value={filterLocation} onValueChange={setFilterLocation}>
                <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-filter-location">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant={view === "list" ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setView("list")}
                data-testid="button-view-list"
              >
                <List className="h-3 w-3 mr-1" />
                List
              </Button>
              <Button
                size="sm"
                variant={view === "week" ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setView("week")}
                data-testid="button-view-week"
              >
                <Calendar className="h-3 w-3 mr-1" />
                Week
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : view === "week" ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {format(startOfWeek(currentWeek, { weekStartsOn: 0 }), "MMM d")} –{" "}
                {format(endOfWeek(currentWeek, { weekStartsOn: 0 }), "MMM d, yyyy")}
              </CardTitle>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} data-testid="button-prev-week">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setCurrentWeek(new Date())} data-testid="button-today">
                  Today
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} data-testid="button-next-week">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <WeekView bookings={weekBookings} currentWeek={currentWeek} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Upcoming */}
          <div>
            <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Upcoming ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg" data-testid="text-no-upcoming">
                No upcoming bookings{hasFilters ? " matching your filters" : ""}
              </div>
            ) : (
              <div className="space-y-2">
                {upcoming.slice().sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()).map(b => (
                  <BookingCard
                    key={b.id}
                    booking={b}
                    onCancel={setCancelBooking}
                    onReschedule={b2 => {
                      setRescheduleBooking(b2);
                      setRescheduleData({
                        startAt: format(new Date(b2.startAt), "yyyy-MM-dd'T'HH:mm"),
                        endAt: format(new Date(b2.endAt), "yyyy-MM-dd'T'HH:mm"),
                      });
                    }}
                    onComplete={b2 => updateStatusMutation.mutate({ id: b2.id, status: "COMPLETED" })}
                    onNoShow={b2 => updateStatusMutation.mutate({ id: b2.id, status: "NO_SHOW" })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Past */}
          {past.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Past ({past.length})
              </h2>
              <div className="space-y-2">
                {past.slice(0, 20).sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()).map(b => (
                  <BookingCard
                    key={b.id}
                    booking={b}
                    onCancel={setCancelBooking}
                    onReschedule={b2 => {
                      setRescheduleBooking(b2);
                      setRescheduleData({
                        startAt: format(new Date(b2.startAt), "yyyy-MM-dd'T'HH:mm"),
                        endAt: format(new Date(b2.endAt), "yyyy-MM-dd'T'HH:mm"),
                      });
                    }}
                    onComplete={b2 => updateStatusMutation.mutate({ id: b2.id, status: "COMPLETED" })}
                    onNoShow={b2 => updateStatusMutation.mutate({ id: b2.id, status: "NO_SHOW" })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cancel Dialog */}
      <AlertDialog open={!!cancelBooking} onOpenChange={() => setCancelBooking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-cancel-dialog-title">Cancel Booking?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the booking for{" "}
              <strong>{cancelBooking?.client?.firstName} {cancelBooking?.client?.lastName}</strong>
              {" "}on{" "}
              <strong>{cancelBooking && format(new Date(cancelBooking.startAt), "MMM d 'at' h:mm a")}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-dialog-close">Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelBooking) {
                  updateStatusMutation.mutate({ id: cancelBooking.id, status: "CANCELLED" });
                  setCancelBooking(null);
                }
              }}
              data-testid="button-cancel-confirm"
            >
              Cancel Booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reschedule Dialog */}
      <Dialog open={!!rescheduleBooking} onOpenChange={() => setRescheduleBooking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle data-testid="text-reschedule-dialog-title">Reschedule Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>New Start Time</Label>
              <Input
                type="datetime-local"
                value={rescheduleData.startAt}
                onChange={e => setRescheduleData(d => ({ ...d, startAt: e.target.value }))}
                data-testid="input-reschedule-start"
              />
            </div>
            <div className="space-y-2">
              <Label>New End Time</Label>
              <Input
                type="datetime-local"
                value={rescheduleData.endAt}
                onChange={e => setRescheduleData(d => ({ ...d, endAt: e.target.value }))}
                data-testid="input-reschedule-end"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleBooking(null)}>Cancel</Button>
            <Button
              onClick={handleRescheduleSubmit}
              disabled={rescheduleMutation.isPending}
              data-testid="button-reschedule-confirm"
            >
              {rescheduleMutation.isPending ? "Saving..." : "Reschedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Booking Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-create-dialog-title">New Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Client *</Label>
              <Select value={newBooking.clientId} onValueChange={v => setNewBooking(d => ({ ...d, clientId: v }))}>
                <SelectTrigger data-testid="select-new-client">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {orgUsers.filter((u: any) => u.profile?.role === "CLIENT" || !u.profile?.role).map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Coach *</Label>
              <Select value={newBooking.coachId} onValueChange={v => setNewBooking(d => ({ ...d, coachId: v }))}>
                <SelectTrigger data-testid="select-new-coach">
                  <SelectValue placeholder="Select coach" />
                </SelectTrigger>
                <SelectContent>
                  {coaches.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.user.firstName} {c.user.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Session Type *</Label>
              <Select value={newBooking.serviceId} onValueChange={v => setNewBooking(d => ({ ...d, serviceId: v }))}>
                <SelectTrigger data-testid="select-new-service">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {services.filter(s => s.active && (s as any).isBookableByCoach !== false).map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({SESSION_TYPE_LABELS[s.sessionType || ""] || s.sessionType}{(s as any).category && (s as any).category !== "paid" ? ` · ${(s as any).category}` : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start *</Label>
                <Input
                  type="datetime-local"
                  value={newBooking.startAt}
                  onChange={e => setNewBooking(d => ({ ...d, startAt: e.target.value }))}
                  data-testid="input-new-start"
                />
              </div>
              <div className="space-y-2">
                <Label>End *</Label>
                <Input
                  type="datetime-local"
                  value={newBooking.endAt}
                  onChange={e => setNewBooking(d => ({ ...d, endAt: e.target.value }))}
                  data-testid="input-new-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input
                placeholder="Location (optional)"
                value={newBooking.location}
                onChange={e => setNewBooking(d => ({ ...d, location: e.target.value }))}
                data-testid="input-new-location"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Notes (optional)"
                value={newBooking.notes}
                onChange={e => setNewBooking(d => ({ ...d, notes: e.target.value }))}
                data-testid="input-new-notes"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateSubmit} disabled={createMutation.isPending} data-testid="button-create-confirm">
              {createMutation.isPending ? "Creating..." : "Create Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
