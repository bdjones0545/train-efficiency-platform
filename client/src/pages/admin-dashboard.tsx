import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Users, Calendar, DollarSign, Plus, Download, Settings, Banknote, CheckCircle, XCircle, UserPlus, TrendingUp, AlertTriangle, BarChart2, Target, Zap } from "lucide-react";
import { format, parseISO, subDays, subWeeks, subMonths, subYears, isAfter } from "date-fns";
import { useState, useMemo } from "react";
import type { CoachWithUser, BookingWithDetails, RedemptionWithDetails } from "@/lib/types";
import type { Service, UserProfile, Cashout } from "@shared/schema";
import type { User } from "@shared/models/auth";

type CashoutWithCoach = Cashout & { coachName: string };

export default function AdminDashboardPage() {
  const { toast } = useToast();

  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;
  const { data: coaches } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/coaches?organizationId=${orgId}` : "/api/coaches";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/services?organizationId=${orgId}` : "/api/services";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json();
    },
  });
  const { data: allBookings } = useQuery<BookingWithDetails[]>({ queryKey: ["/api/admin/bookings"] });
  const { data: allRedemptions } = useQuery<RedemptionWithDetails[]>({ queryKey: ["/api/admin/redemptions"] });
  const { data: allUsers } = useQuery<(User & { profile?: UserProfile })[]>({ queryKey: ["/api/admin/users"] });
  const { data: allCashouts } = useQuery<CashoutWithCoach[]>({ queryKey: ["/api/admin/cashouts"] });

  const { data: revQuality, isLoading: revQualityLoading } = useQuery<any>({
    queryKey: ["/api/scheduling/revenue-quality"],
  });
  const { data: sessionMix, isLoading: sessionMixLoading } = useQuery<any>({
    queryKey: ["/api/scheduling/session-mix"],
  });
  const { data: coachProfitability, isLoading: coachProfLoading } = useQuery<any>({
    queryKey: ["/api/scheduling/coach-profitability"],
  });
  const { data: revPressure, isLoading: revPressureLoading } = useQuery<any>({
    queryKey: ["/api/scheduling/revenue-pressure"],
  });
  const { data: lostRevenue, isLoading: lostRevenueLoading } = useQuery<any>({
    queryKey: ["/api/scheduling/lost-revenue"],
  });

  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceDesc, setNewServiceDesc] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState("60");
  const [newServicePrice, setNewServicePrice] = useState("50");
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);

  const [coachDialogOpen, setCoachDialogOpen] = useState(false);
  const [newCoachFirstName, setNewCoachFirstName] = useState("");
  const [newCoachLastName, setNewCoachLastName] = useState("");
  const [newCoachEmail, setNewCoachEmail] = useState("");
  const [newCoachPassword, setNewCoachPassword] = useState("");
  const [newCoachBio, setNewCoachBio] = useState("");
  const [newCoachSpecialties, setNewCoachSpecialties] = useState("");
  const [redemptionPeriod, setRedemptionPeriod] = useState<"all" | "day" | "week" | "month" | "year">("all");

  const filteredRedemptions = useMemo(() => {
    if (!allRedemptions) return [];
    if (redemptionPeriod === "all") return allRedemptions;
    const now = new Date();
    const cutoff =
      redemptionPeriod === "day" ? subDays(now, 1) :
      redemptionPeriod === "week" ? subWeeks(now, 1) :
      redemptionPeriod === "month" ? subMonths(now, 1) :
      subYears(now, 1);
    return allRedemptions.filter((r) => {
      if (!r.redeemedAt) return false;
      return isAfter(parseISO(r.redeemedAt as unknown as string), cutoff);
    });
  }, [allRedemptions, redemptionPeriod]);

  const createCoachMutation = useMutation({
    mutationFn: async (data: { firstName: string; lastName: string; email: string; password: string; bio: string; specialties: string[] }) => {
      const res = await apiRequest("POST", "/api/admin/coaches", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coach Added", description: "Welcome email has been sent to the new coach." });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
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
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateCoach = () => {
    if (!newCoachFirstName || !newCoachLastName || !newCoachEmail || !newCoachPassword) return;
    createCoachMutation.mutate({
      firstName: newCoachFirstName,
      lastName: newCoachLastName,
      email: newCoachEmail,
      password: newCoachPassword,
      bio: newCoachBio,
      specialties: newCoachSpecialties ? newCoachSpecialties.split(",").map(s => s.trim()).filter(Boolean) : [],
    });
  };

  const createServiceMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; durationMin: number; priceCents: number }) => {
      const res = await apiRequest("POST", "/api/admin/services", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Service Created" });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setServiceDialogOpen(false);
      setNewServiceName("");
      setNewServiceDesc("");
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const setRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("POST", "/api/admin/set-role", { userId, role });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Role Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateCashoutMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/cashouts/${id}/status`, { status });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      toast({ title: variables.status === "PAID" ? "Marked as Completed" : "Cashout Denied" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cashouts"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateService = () => {
    if (!newServiceName) return;
    createServiceMutation.mutate({
      name: newServiceName,
      description: newServiceDesc,
      durationMin: parseInt(newServiceDuration),
      priceCents: Math.round(parseFloat(newServicePrice) * 100),
    });
  };

  const exportCSV = () => {
    if (!allRedemptions || allRedemptions.length === 0) {
      toast({ title: "No data to export" });
      return;
    }
    const headers = "ID,BookingID,CoachID,RedeemedAt,Amount,PayoutStatus\n";
    const rows = allRedemptions.map(r =>
      `${r.id},${r.bookingId},${r.coachId},${r.redeemedAt || ""},${(r.amountCents / 100).toFixed(2)},${r.payoutStatus}`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `redemptions-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalRevenue = allRedemptions?.reduce((sum, r) => sum + (r.amountCents || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold" data-testid="text-admin-title">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage coaches, services, and view reports</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <Users className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-2xl font-bold" data-testid="text-total-users">{allUsers?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Total Users</p>
        </Card>
        <Card className="p-4 text-center">
          <Settings className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-2xl font-bold" data-testid="text-total-coaches">{coaches?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Active Coaches</p>
        </Card>
        <Card className="p-4 text-center">
          <Calendar className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-2xl font-bold" data-testid="text-total-bookings">{allBookings?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Total Bookings</p>
        </Card>
        <Card className="p-4 text-center">
          <DollarSign className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-2xl font-bold" data-testid="text-total-revenue">${(totalRevenue / 100).toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">Total Redeemed</p>
        </Card>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="flex-wrap">
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="services" data-testid="tab-services">Services</TabsTrigger>
          <TabsTrigger value="bookings" data-testid="tab-bookings">Bookings</TabsTrigger>
          <TabsTrigger value="redemptions" data-testid="tab-redemptions">Redemptions</TabsTrigger>
          <TabsTrigger value="cashouts" data-testid="tab-cashouts">Cashouts</TabsTrigger>
          <TabsTrigger value="revenue-intelligence" data-testid="tab-revenue-intelligence">Revenue Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog open={coachDialogOpen} onOpenChange={setCoachDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-coach">
                  <UserPlus className="h-4 w-4 mr-1" />
                  Add Coach
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Coach</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-muted-foreground mb-1 block">First Name</label>
                      <Input
                        value={newCoachFirstName}
                        onChange={(e) => setNewCoachFirstName(e.target.value)}
                        placeholder="John"
                        data-testid="input-coach-first-name"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground mb-1 block">Last Name</label>
                      <Input
                        value={newCoachLastName}
                        onChange={(e) => setNewCoachLastName(e.target.value)}
                        placeholder="Smith"
                        data-testid="input-coach-last-name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Email</label>
                    <Input
                      type="email"
                      value={newCoachEmail}
                      onChange={(e) => setNewCoachEmail(e.target.value)}
                      placeholder="coach@example.com"
                      data-testid="input-coach-email"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Password</label>
                    <Input
                      type="text"
                      value={newCoachPassword}
                      onChange={(e) => setNewCoachPassword(e.target.value)}
                      placeholder="Initial login password"
                      data-testid="input-coach-password"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Bio</label>
                    <Textarea
                      value={newCoachBio}
                      onChange={(e) => setNewCoachBio(e.target.value)}
                      placeholder="Brief bio about the coach..."
                      data-testid="input-coach-bio"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Specialties (comma-separated)</label>
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
          </div>
          <Card className="p-4">
            <div className="space-y-3">
              {allUsers?.map((u) => (
                <div key={u.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{u.firstName} {u.lastName}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={u.profile?.role || "CLIENT"}
                      onValueChange={(role) => setRoleMutation.mutate({ userId: u.id, role })}
                    >
                      <SelectTrigger className="w-28" data-testid={`select-role-${u.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CLIENT">Client</SelectItem>
                        <SelectItem value="COACH">Coach</SelectItem>
                        <SelectItem value="ADMIN">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
              {(!allUsers || allUsers.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No users found</p>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-service">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Service
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Service</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Name</label>
                    <Input
                      value={newServiceName}
                      onChange={(e) => setNewServiceName(e.target.value)}
                      placeholder="1:1 Training 60"
                      data-testid="input-service-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">Description</label>
                    <Textarea
                      value={newServiceDesc}
                      onChange={(e) => setNewServiceDesc(e.target.value)}
                      placeholder="One-on-one strength & conditioning session"
                      data-testid="input-service-desc"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-muted-foreground mb-1 block">Duration (min)</label>
                      <Input
                        type="number"
                        value={newServiceDuration}
                        onChange={(e) => setNewServiceDuration(e.target.value)}
                        data-testid="input-service-duration"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground mb-1 block">Price ($)</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={newServicePrice}
                        onChange={(e) => setNewServicePrice(e.target.value)}
                        data-testid="input-service-price"
                      />
                    </div>
                  </div>
                  <Button onClick={handleCreateService} disabled={createServiceMutation.isPending} className="w-full" data-testid="button-submit-service">
                    Create Service
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-3">
            {services?.map((s) => (
              <Card key={s.id} className="p-4" data-testid={`card-service-${s.id}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-sm">{s.name}</h3>
                    {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{s.durationMin} min</Badge>
                    <Badge variant="secondary" className="text-xs">{s.name.toLowerCase().includes("team training") ? "Quoted Price" : s.priceCents === 0 ? "FREE" : `$${(s.priceCents / 100).toFixed(2)}`}</Badge>
                    <Badge className={s.active ? "bg-green-500/15 text-green-700 dark:text-green-400 text-xs" : "bg-red-500/15 text-red-700 dark:text-red-400 text-xs"}>
                      {s.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="bookings" className="mt-4">
          <Card className="p-4">
            <div className="space-y-3">
              {allBookings?.slice(0, 50).map((b) => (
                <div key={b.id} className="flex flex-col sm:flex-row items-start justify-between gap-2 py-2 border-b last:border-0">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{b.service?.name} — {b.client?.firstName} {b.client?.lastName}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(b.startAt as unknown as string), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                  <Badge className={`text-xs ${
                    b.status === "CONFIRMED" ? "bg-green-500/15 text-green-700 dark:text-green-400" :
                    b.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
                    b.status === "CANCELLED" ? "bg-red-500/15 text-red-700 dark:text-red-400" :
                    "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                  }`}>
                    {b.status}
                  </Badge>
                </div>
              ))}
              {(!allBookings || allBookings.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No bookings yet</p>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="redemptions" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" onClick={exportCSV} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>

          {allCashouts?.some((c) => c.status === "REQUESTED") && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">Pending Cash Out Requests</h3>
              <div className="space-y-3">
                {allCashouts
                  .filter((c) => c.status === "REQUESTED")
                  .map((c) => (
                    <div key={c.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-3 border-b last:border-0" data-testid={`card-pending-cashout-${c.id}`}>
                      <div className="space-y-0.5">
                        <p className="font-medium text-sm" data-testid={`text-pending-cashout-coach-${c.id}`}>{c.coachName}</p>
                        <p className="text-lg font-bold" data-testid={`text-pending-cashout-amount-${c.id}`}>${(c.amountCents / 100).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          Requested {c.requestedAt && format(parseISO(c.requestedAt as unknown as string), "MMM d, yyyy h:mm a")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => updateCashoutMutation.mutate({ id: c.id, status: "PAID" })}
                          disabled={updateCashoutMutation.isPending}
                          data-testid={`button-complete-cashout-${c.id}`}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Mark Completed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateCashoutMutation.mutate({ id: c.id, status: "DENIED" })}
                          disabled={updateCashoutMutation.isPending}
                          data-testid={`button-deny-pending-cashout-${c.id}`}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold">Redemption History</h3>
              <div className="flex items-center gap-1">
                {(["all", "day", "week", "month", "year"] as const).map((period) => (
                  <Button
                    key={period}
                    size="sm"
                    variant={redemptionPeriod === period ? "default" : "outline"}
                    onClick={() => setRedemptionPeriod(period)}
                    className="text-xs px-3 h-7"
                    data-testid={`button-filter-${period}`}
                  >
                    {period === "all" ? "All" : period === "day" ? "Day" : period === "week" ? "Week" : period === "month" ? "Month" : "Year"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {filteredRedemptions.map((r) => (
                <div key={r.id} className="flex flex-col sm:flex-row items-start justify-between gap-2 py-2 border-b last:border-0">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">${(r.amountCents / 100).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.redeemedAt && format(parseISO(r.redeemedAt as unknown as string), "MMM d, yyyy")}
                    </p>
                  </div>
                  <Badge className={`text-xs ${payoutColors[r.payoutStatus] || ""}`}>
                    {r.payoutStatus}
                  </Badge>
                </div>
              ))}
              {filteredRedemptions.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {redemptionPeriod === "all" ? "No redemptions yet" : `No redemptions in the past ${redemptionPeriod}`}
                </p>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="cashouts" className="mt-4">
          <Card className="p-4">
            <div className="space-y-3">
              {allCashouts?.map((c) => (
                <div key={c.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-3 border-b last:border-0" data-testid={`card-cashout-${c.id}`}>
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm" data-testid={`text-cashout-coach-${c.id}`}>{c.coachName}</p>
                    <p className="text-lg font-bold" data-testid={`text-cashout-amount-${c.id}`}>${(c.amountCents / 100).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      Requested {c.requestedAt && format(parseISO(c.requestedAt as unknown as string), "MMM d, yyyy h:mm a")}
                    </p>
                    {c.processedAt && (
                      <p className="text-xs text-muted-foreground">
                        Processed {format(parseISO(c.processedAt as unknown as string), "MMM d, yyyy h:mm a")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.status === "REQUESTED" ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => updateCashoutMutation.mutate({ id: c.id, status: "PAID" })}
                          disabled={updateCashoutMutation.isPending}
                          data-testid={`button-pay-cashout-${c.id}`}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Mark Completed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateCashoutMutation.mutate({ id: c.id, status: "DENIED" })}
                          disabled={updateCashoutMutation.isPending}
                          data-testid={`button-deny-cashout-${c.id}`}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Deny
                        </Button>
                      </>
                    ) : (
                      <Badge className={`text-xs ${cashoutColors[c.status] || ""}`}>
                        {c.status}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
              {(!allCashouts || allCashouts.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No cashout requests yet</p>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="revenue-intelligence" className="mt-4 space-y-6">
          <h2 className="text-lg font-semibold">Revenue Intelligence — This Week</h2>

          {/* Revenue Pressure */}
          <Card className="p-5" data-testid="card-revenue-pressure">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <h3 className="font-semibold">Revenue Pressure</h3>
            </div>
            {revPressureLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : revPressure ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={
                    revPressure.urgencyLevel === "critical" ? "bg-red-500/15 text-red-700 dark:text-red-400" :
                    revPressure.urgencyLevel === "high" ? "bg-orange-500/15 text-orange-700 dark:text-orange-400" :
                    revPressure.urgencyLevel === "medium" ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" :
                    "bg-green-500/15 text-green-700 dark:text-green-400"
                  } data-testid="badge-urgency-level">
                    {revPressure.urgencyLevel?.toUpperCase()}
                  </Badge>
                  <span className="text-sm text-muted-foreground" data-testid="text-days-remaining">{revPressure.daysRemaining} days remaining in week</span>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Target</p>
                    <p className="font-semibold" data-testid="text-weekly-target">${((revPressure.weeklyTargetCents ?? 0) / 100).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Achieved</p>
                    <p className="font-semibold" data-testid="text-achieved">${((revPressure.achievedCents ?? 0) / 100).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Gap</p>
                    <p className="font-semibold text-red-600 dark:text-red-400" data-testid="text-gap">${((revPressure.gapCents ?? 0) / 100).toFixed(0)}</p>
                  </div>
                </div>
                {revPressure.requiredDailyRevenueCents > 0 && (
                  <p className="text-sm text-muted-foreground mt-1" data-testid="text-required-daily">
                    Need <strong>${((revPressure.requiredDailyRevenueCents ?? 0) / 100).toFixed(0)}/day</strong> to close the gap
                  </p>
                )}
                {revPressure.recoveryActions?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Top Recovery Actions</p>
                    <ul className="space-y-1">
                      {revPressure.recoveryActions.map((a: string, i: number) => (
                        <li key={i} className="text-sm text-foreground" data-testid={`text-recovery-action-${i}`}>• {a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No pressure data available</p>
            )}
          </Card>

          {/* Lost Revenue */}
          <Card className="p-5" data-testid="card-lost-revenue">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-5 w-5 text-yellow-500" />
              <h3 className="font-semibold">Lost Revenue Opportunities</h3>
            </div>
            {lostRevenueLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : lostRevenue ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-foreground" data-testid="text-total-recoverable">${((lostRevenue.totalRecoverableCents ?? 0) / 100).toFixed(0)}</span>
                  <span className="text-sm text-muted-foreground">recoverable this week</span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Open Slots</p>
                    <p className="font-semibold" data-testid="text-open-slots-value">${((lostRevenue.openSlotRevenueCents ?? 0) / 100).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Inactive Clients</p>
                    <p className="font-semibold" data-testid="text-inactive-clients-value">${((lostRevenue.inactiveClientRevenueCents ?? 0) / 100).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Unconverted Intros</p>
                    <p className="font-semibold" data-testid="text-intro-value">${((lostRevenue.unconvertedIntroRevenueCents ?? 0) / 100).toFixed(0)}</p>
                  </div>
                </div>
                {lostRevenue.topOpportunities?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Top Opportunities</p>
                    <ul className="space-y-1">
                      {lostRevenue.topOpportunities.slice(0, 3).map((o: any, i: number) => (
                        <li key={i} className="text-sm text-foreground flex justify-between" data-testid={`text-opportunity-${i}`}>
                          <span>{o.description}</span>
                          <span className="font-medium text-green-600 dark:text-green-400">${((o.valueCents ?? 0) / 100).toFixed(0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No lost revenue data available</p>
            )}
          </Card>

          {/* Revenue Quality */}
          <Card className="p-5" data-testid="card-revenue-quality">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              <h3 className="font-semibold">Revenue Quality</h3>
            </div>
            {revQualityLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : revQuality ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold" data-testid="text-quality-score">
                    {Math.round((revQuality.revenueQualityScore ?? 0) * 100)}%
                  </span>
                  <div>
                    <p className="text-sm font-medium">Revenue Quality Score</p>
                    <p className="text-xs text-muted-foreground">% of hours that generate revenue</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Revenue Hours</p>
                    <p className="font-semibold" data-testid="text-revenue-hours">{(revQuality.revenueHours ?? 0).toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Non-Revenue Hours</p>
                    <p className="font-semibold" data-testid="text-non-revenue-hours">{(revQuality.nonRevenueHours ?? 0).toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Revenue Lost</p>
                    <p className="font-semibold text-red-600 dark:text-red-400" data-testid="text-revenue-lost">${((revQuality.estimatedRevenueLostCents ?? 0) / 100).toFixed(0)}</p>
                  </div>
                </div>
                {(revQuality.revenueQualityScore ?? 0) < 0.7 && (
                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 text-xs" data-testid="badge-low-quality">
                    Below target — shift more sessions to paid
                  </Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No quality data available</p>
            )}
          </Card>

          {/* Session Mix */}
          <Card className="p-5" data-testid="card-session-mix">
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 className="h-5 w-5 text-purple-500" />
              <h3 className="font-semibold">Session Mix</h3>
            </div>
            {sessionMixLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : sessionMix ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(sessionMix.breakdown ?? {}).map(([category, data]: [string, any]) => (
                    <div key={category} className="rounded-lg border p-3" data-testid={`card-mix-${category}`}>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{category}</p>
                      <p className="text-lg font-bold" data-testid={`text-mix-pct-${category}`}>{data.percent?.toFixed(0) ?? 0}%</p>
                      <p className="text-xs text-muted-foreground">{data.count ?? 0} sessions</p>
                    </div>
                  ))}
                </div>
                {(sessionMix.breakdown?.intro?.percent ?? 0) > 30 && (
                  <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 text-xs" data-testid="badge-high-intro">
                    High intro rate — convert more before adding new intros
                  </Badge>
                )}
                {(sessionMix.breakdown?.paid?.percent ?? 100) < 50 && (
                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 text-xs" data-testid="badge-low-paid">
                    Less than 50% paid sessions — revenue mix concern
                  </Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No session mix data available</p>
            )}
          </Card>

          {/* Coach Profitability */}
          <Card className="p-5" data-testid="card-coach-profitability">
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-5 w-5 text-green-500" />
              <h3 className="font-semibold">Coach Profitability</h3>
            </div>
            {coachProfLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : coachProfitability?.coaches?.length > 0 ? (
              <div className="space-y-3">
                {coachProfitability.coaches.map((c: any) => (
                  <div key={c.coachId} className="flex items-center justify-between border rounded-lg p-3" data-testid={`card-coach-prof-${c.coachId}`}>
                    <div>
                      <p className="font-medium text-sm" data-testid={`text-coach-name-${c.coachId}`}>{c.coachName}</p>
                      <p className="text-xs text-muted-foreground">{(c.revenueHours ?? 0).toFixed(1)}h revenue · ${((c.estimatedPayoutCents ?? 0) / 100).toFixed(0)} payout</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold" data-testid={`text-coach-revenue-${c.coachId}`}>${((c.revenueCents ?? 0) / 100).toFixed(0)}</p>
                      <Badge className={`text-xs ${(c.marginPercent ?? 0) >= 50 ? "bg-green-500/15 text-green-700 dark:text-green-400" : (c.marginPercent ?? 0) >= 30 ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" : "bg-red-500/15 text-red-700 dark:text-red-400"}`} data-testid={`badge-margin-${c.coachId}`}>
                        {(c.marginPercent ?? 0).toFixed(0)}% margin
                      </Badge>
                    </div>
                  </div>
                ))}
                {coachProfitability.orgMarginPercent !== undefined && (
                  <div className="border-t pt-2 flex justify-between text-sm" data-testid="text-org-margin">
                    <span className="text-muted-foreground">Org avg margin</span>
                    <span className="font-semibold">{(coachProfitability.orgMarginPercent ?? 0).toFixed(0)}%</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No profitability data available this week</p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const cashoutColors: Record<string, string> = {
  PAID: "bg-green-500/15 text-green-700 dark:text-green-400",
  DENIED: "bg-red-500/15 text-red-700 dark:text-red-400",
  REQUESTED: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
};

const payoutColors: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  SENT: "bg-green-500/15 text-green-700 dark:text-green-400",
  FAILED: "bg-red-500/15 text-red-700 dark:text-red-400",
};
