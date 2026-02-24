import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  UserPlus,
  Plus,
  Pencil,
  Percent,
  Settings,
  Dumbbell,
  Save,
  X,
  Trash2,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import type { Service } from "@shared/schema";

type CoachWithUser = {
  id: string;
  userId: string;
  bio: string;
  specialties: string[];
  isActive: boolean;
  payoutPercentage: number | null;
  user: { id: string; firstName: string; lastName: string; email: string };
};

export default function AdminConfigurationPage() {
  const { toast } = useToast();

  const { data: services, isLoading: servicesLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });
  const { data: coaches, isLoading: coachesLoading } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches"],
  });
  const { data: settings, isLoading: settingsLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/admin/settings"],
  });

  const [coachDialogOpen, setCoachDialogOpen] = useState(false);
  const [newCoachFirstName, setNewCoachFirstName] = useState("");
  const [newCoachLastName, setNewCoachLastName] = useState("");
  const [newCoachEmail, setNewCoachEmail] = useState("");
  const [newCoachPassword, setNewCoachPassword] = useState("");
  const [newCoachBio, setNewCoachBio] = useState("");
  const [newCoachSpecialties, setNewCoachSpecialties] = useState("");

  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceDesc, setNewServiceDesc] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState("60");
  const [newServicePrice, setNewServicePrice] = useState("50");

  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editServiceName, setEditServiceName] = useState("");
  const [editServiceDesc, setEditServiceDesc] = useState("");
  const [editServiceDuration, setEditServiceDuration] = useState("");
  const [editServicePrice, setEditServicePrice] = useState("");
  const [editServiceActive, setEditServiceActive] = useState(true);

  const [payoutPercentage, setPayoutPercentage] = useState("");
  const [payoutEditing, setPayoutEditing] = useState(false);


  const [selectedCoachId, setSelectedCoachId] = useState<string | null>(null);
  const [editCoachDialogOpen, setEditCoachDialogOpen] = useState(false);
  const [editCoachBio, setEditCoachBio] = useState("");
  const [editCoachSpecialties, setEditCoachSpecialties] = useState("");
  const [editCoachActive, setEditCoachActive] = useState(true);
  const [editCoachPayout, setEditCoachPayout] = useState("");

  const createCoachMutation = useMutation({
    mutationFn: async (data: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      bio: string;
      specialties: string[];
    }) => {
      const res = await apiRequest("POST", "/api/admin/coaches", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coach created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
      setCoachDialogOpen(false);
      setNewCoachFirstName("");
      setNewCoachLastName("");
      setNewCoachEmail("");
      setNewCoachPassword("");
      setNewCoachBio("");
      setNewCoachSpecialties("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateCoachMutation = useMutation({
    mutationFn: async (data: { id: string; bio: string; specialties: string[]; isActive: boolean; payoutPercentage: number }) => {
      const { id, ...body } = data;
      const res = await apiRequest("PATCH", `/api/admin/coaches/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coach updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
      setEditCoachDialogOpen(false);
      setSelectedCoachId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteCoachMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/coaches/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coach deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
      setSelectedCoachId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openEditCoachDialog = (coach: CoachWithUser) => {
    setSelectedCoachId(coach.id);
    setEditCoachBio(coach.bio || "");
    setEditCoachSpecialties(coach.specialties?.join(", ") || "");
    setEditCoachActive(coach.isActive);
    setEditCoachPayout(String(coach.payoutPercentage ?? settings?.coach_payout_percentage ?? "50"));
    setEditCoachDialogOpen(true);
  };

  const createServiceMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description: string;
      durationMin: number;
      priceCents: number;
    }) => {
      const res = await apiRequest("POST", "/api/admin/services", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Training option created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setServiceDialogOpen(false);
      setNewServiceName("");
      setNewServiceDesc("");
      setNewServiceDuration("60");
      setNewServicePrice("50");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateServiceMutation = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name: string;
      description: string;
      durationMin: number;
      priceCents: number;
      active: boolean;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/services/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Training option updated and synced with Stripe" });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setEditingServiceId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateSettingMutation = useMutation({
    mutationFn: async (data: { key: string; value: string }) => {
      const res = await apiRequest("PUT", "/api/admin/settings", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Default payout percentage updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      setPayoutEditing(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const startEditService = (service: Service) => {
    setEditingServiceId(service.id);
    setEditServiceName(service.name);
    setEditServiceDesc(service.description || "");
    setEditServiceDuration(String(service.durationMin));
    setEditServicePrice(String((service.priceCents || 0) / 100));
    setEditServiceActive(service.active ?? true);
  };

  const cancelEditService = () => {
    setEditingServiceId(null);
  };

  const saveEditService = () => {
    if (!editingServiceId) return;
    updateServiceMutation.mutate({
      id: editingServiceId,
      name: editServiceName,
      description: editServiceDesc,
      durationMin: parseInt(editServiceDuration) || 60,
      priceCents: Math.round(parseFloat(editServicePrice) * 100) || 0,
      active: editServiceActive,
    });
  };

  const startEditPayout = () => {
    setPayoutPercentage(settings?.coach_payout_percentage || "50");
    setPayoutEditing(true);
  };

  const savePayout = () => {
    updateSettingMutation.mutate({
      key: "coach_payout_percentage",
      value: payoutPercentage,
    });
  };

  return (
    <div className="space-y-8" data-testid="page-admin-configuration">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-config-title">
          <Settings className="h-6 w-6" />
          Configuration
        </h1>
        <p className="text-muted-foreground mt-1">Manage coaches, training options, pricing, and payout settings.</p>
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Coaches
          </h2>
          <Dialog open={coachDialogOpen} onOpenChange={setCoachDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-coach">
                <Plus className="h-4 w-4 mr-1" /> Add Coach
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Coach</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>First Name</Label>
                    <Input
                      value={newCoachFirstName}
                      onChange={(e) => setNewCoachFirstName(e.target.value)}
                      data-testid="input-coach-first-name"
                    />
                  </div>
                  <div>
                    <Label>Last Name</Label>
                    <Input
                      value={newCoachLastName}
                      onChange={(e) => setNewCoachLastName(e.target.value)}
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
                    data-testid="input-coach-email"
                  />
                </div>
                <div>
                  <Label>Temporary Password</Label>
                  <Input
                    type="text"
                    value={newCoachPassword}
                    onChange={(e) => setNewCoachPassword(e.target.value)}
                    data-testid="input-coach-password"
                  />
                </div>
                <div>
                  <Label>Bio</Label>
                  <Textarea
                    value={newCoachBio}
                    onChange={(e) => setNewCoachBio(e.target.value)}
                    rows={2}
                    data-testid="input-coach-bio"
                  />
                </div>
                <div>
                  <Label>Specialties (comma-separated)</Label>
                  <Input
                    value={newCoachSpecialties}
                    onChange={(e) => setNewCoachSpecialties(e.target.value)}
                    placeholder="Strength, Speed, Conditioning"
                    data-testid="input-coach-specialties"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={createCoachMutation.isPending}
                  data-testid="button-submit-coach"
                  onClick={() =>
                    createCoachMutation.mutate({
                      firstName: newCoachFirstName,
                      lastName: newCoachLastName,
                      email: newCoachEmail,
                      password: newCoachPassword,
                      bio: newCoachBio,
                      specialties: newCoachSpecialties
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                >
                  {createCoachMutation.isPending ? "Creating..." : "Create Coach"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-3">
          {coachesLoading && <p className="text-sm text-muted-foreground">Loading coaches...</p>}
          {coaches?.map((coach) => (
            <Card
              key={coach.id}
              className="p-4 cursor-pointer transition-colors hover:bg-accent/50"
              data-testid={`card-coach-${coach.id}`}
              onClick={() => openEditCoachDialog(coach)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium" data-testid={`text-coach-name-${coach.id}`}>
                    {coach.user.firstName} {coach.user.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">{coach.user.email}</p>
                  {coach.specialties?.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {coach.specialties.map((s, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm" data-testid={`text-coach-payout-${coach.id}`}>
                      Payout: {coach.payoutPercentage !== null && coach.payoutPercentage !== undefined
                        ? `${coach.payoutPercentage}%`
                        : `${settings?.coach_payout_percentage || "50"}% (default)`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={coach.isActive ? "default" : "secondary"}>
                    {coach.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))}
          {!coachesLoading && coaches?.length === 0 && (
            <p className="text-sm text-muted-foreground">No coaches yet.</p>
          )}
        </div>

        <Dialog open={editCoachDialogOpen} onOpenChange={setEditCoachDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Coach</DialogTitle>
            </DialogHeader>
            {(() => {
              const coach = coaches?.find((c) => c.id === selectedCoachId);
              if (!coach) return null;
              return (
                <div className="space-y-4">
                  <div>
                    <Label className="text-muted-foreground">Name</Label>
                    <p className="font-medium">{coach.user.firstName} {coach.user.lastName}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Email</Label>
                    <p className="text-sm">{coach.user.email}</p>
                  </div>
                  <div>
                    <Label>Bio</Label>
                    <Textarea
                      value={editCoachBio}
                      onChange={(e) => setEditCoachBio(e.target.value)}
                      rows={3}
                      data-testid="input-edit-coach-bio"
                    />
                  </div>
                  <div>
                    <Label>Specialties (comma-separated)</Label>
                    <Input
                      value={editCoachSpecialties}
                      onChange={(e) => setEditCoachSpecialties(e.target.value)}
                      placeholder="Strength, Speed, Conditioning"
                      data-testid="input-edit-coach-specialties"
                    />
                  </div>
                  <div>
                    <Label>Payout Percentage</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        className="w-24"
                        value={editCoachPayout}
                        onChange={(e) => setEditCoachPayout(e.target.value)}
                        data-testid="input-edit-coach-payout"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Active</Label>
                    <Switch
                      checked={editCoachActive}
                      onCheckedChange={setEditCoachActive}
                      data-testid="switch-edit-coach-active"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" data-testid="button-delete-coach">
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete Coach
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Coach</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete {coach.user.firstName} {coach.user.lastName} and all their associated data including bookings, availability, and earnings. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="button-cancel-delete-coach">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteCoachMutation.mutate(coach.id)}
                            data-testid="button-confirm-delete-coach"
                          >
                            {deleteCoachMutation.isPending ? "Deleting..." : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button
                      disabled={updateCoachMutation.isPending}
                      onClick={() =>
                        updateCoachMutation.mutate({
                          id: coach.id,
                          bio: editCoachBio,
                          specialties: editCoachSpecialties
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                          isActive: editCoachActive,
                          payoutPercentage: parseInt(editCoachPayout) || 0,
                        })
                      }
                      data-testid="button-save-edit-coach"
                    >
                      {updateCoachMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      </section>

      <Separator />

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Dumbbell className="h-5 w-5" />
            Training Options
          </h2>
          <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-service">
                <Plus className="h-4 w-4 mr-1" /> Add Option
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Training Option</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={newServiceName}
                    onChange={(e) => setNewServiceName(e.target.value)}
                    placeholder="e.g. 1-on-1 Strength Training"
                    data-testid="input-service-name"
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={newServiceDesc}
                    onChange={(e) => setNewServiceDesc(e.target.value)}
                    rows={2}
                    data-testid="input-service-description"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Duration (minutes)</Label>
                    <Input
                      type="number"
                      value={newServiceDuration}
                      onChange={(e) => setNewServiceDuration(e.target.value)}
                      data-testid="input-service-duration"
                    />
                  </div>
                  <div>
                    <Label>Price ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newServicePrice}
                      onChange={(e) => setNewServicePrice(e.target.value)}
                      data-testid="input-service-price"
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={createServiceMutation.isPending}
                  data-testid="button-submit-service"
                  onClick={() =>
                    createServiceMutation.mutate({
                      name: newServiceName,
                      description: newServiceDesc,
                      durationMin: parseInt(newServiceDuration) || 60,
                      priceCents: Math.round(parseFloat(newServicePrice) * 100) || 0,
                    })
                  }
                >
                  {createServiceMutation.isPending ? "Creating..." : "Create Training Option"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-3">
          {servicesLoading && <p className="text-sm text-muted-foreground">Loading training options...</p>}
          {services?.map((service) => (
            <Card key={service.id} className="p-4" data-testid={`card-service-${service.id}`}>
              {editingServiceId === service.id ? (
                <div className="space-y-3">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={editServiceName}
                      onChange={(e) => setEditServiceName(e.target.value)}
                      data-testid={`input-edit-service-name-${service.id}`}
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={editServiceDesc}
                      onChange={(e) => setEditServiceDesc(e.target.value)}
                      rows={2}
                      data-testid={`input-edit-service-desc-${service.id}`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Duration (minutes)</Label>
                      <Input
                        type="number"
                        value={editServiceDuration}
                        onChange={(e) => setEditServiceDuration(e.target.value)}
                        data-testid={`input-edit-service-duration-${service.id}`}
                      />
                    </div>
                    <div>
                      <Label>Price ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editServicePrice}
                        onChange={(e) => setEditServicePrice(e.target.value)}
                        data-testid={`input-edit-service-price-${service.id}`}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editServiceActive}
                      onCheckedChange={setEditServiceActive}
                      data-testid={`switch-edit-service-active-${service.id}`}
                    />
                    <Label>Active</Label>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={updateServiceMutation.isPending}
                      onClick={saveEditService}
                      data-testid={`button-save-service-${service.id}`}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      {updateServiceMutation.isPending ? "Saving..." : "Save & Sync Stripe"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={cancelEditService} data-testid={`button-cancel-edit-${service.id}`}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium" data-testid={`text-service-name-${service.id}`}>{service.name}</p>
                    {service.description && (
                      <p className="text-sm text-muted-foreground">{service.description}</p>
                    )}
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {service.durationMin} min
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        ${((service.priceCents || 0) / 100).toFixed(2)}
                      </Badge>
                      <Badge variant={service.active ? "default" : "outline"} className="text-xs">
                        {service.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startEditService(service)}
                    data-testid={`button-edit-service-${service.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
          {!servicesLoading && services?.length === 0 && (
            <p className="text-sm text-muted-foreground">No training options yet.</p>
          )}
        </div>
      </section>

      <Separator />

      <section>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Percent className="h-5 w-5" />
          Default Coach Payout Percentage
        </h2>
        <Card className="p-4" data-testid="card-payout-percentage">
          <p className="text-sm text-muted-foreground mb-3">
            The default percentage for coaches without a custom payout set above. Individual coach percentages override this value. The owner always receives 100%.
          </p>
          {settingsLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : payoutEditing ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  className="w-24"
                  value={payoutPercentage}
                  onChange={(e) => setPayoutPercentage(e.target.value)}
                  data-testid="input-payout-percentage"
                />
                <span className="text-sm font-medium">%</span>
              </div>
              <Button
                size="sm"
                disabled={updateSettingMutation.isPending}
                onClick={savePayout}
                data-testid="button-save-payout"
              >
                <Save className="h-4 w-4 mr-1" />
                {updateSettingMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPayoutEditing(false)} data-testid="button-cancel-payout">
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold" data-testid="text-payout-value">
                {settings?.coach_payout_percentage || "50"}%
              </span>
              <Button size="sm" variant="outline" onClick={startEditPayout} data-testid="button-edit-payout">
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
