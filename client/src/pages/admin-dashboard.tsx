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
import { Users, Calendar, DollarSign, Plus, Download, Settings, Banknote, CheckCircle, XCircle, UserPlus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";
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

  const totalRevenue = allBookings?.filter(b => b.status === "CONFIRMED" || b.status === "COMPLETED")
    .reduce((sum, b) => sum + (b.service?.priceCents || 0), 0) || 0;

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
          <p className="text-2xl font-bold" data-testid="text-total-revenue">${(totalRevenue / 100).toFixed(0)}</p>
          <p className="text-xs text-muted-foreground">Total Revenue</p>
        </Card>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="services" data-testid="tab-services">Services</TabsTrigger>
          <TabsTrigger value="bookings" data-testid="tab-bookings">Bookings</TabsTrigger>
          <TabsTrigger value="redemptions" data-testid="tab-redemptions">Redemptions</TabsTrigger>
          <TabsTrigger value="cashouts" data-testid="tab-cashouts">Cashouts</TabsTrigger>
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
            <h3 className="text-sm font-semibold mb-3">Redemption History</h3>
            <div className="space-y-3">
              {allRedemptions?.map((r) => (
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
              {(!allRedemptions || allRedemptions.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No redemptions yet</p>
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
