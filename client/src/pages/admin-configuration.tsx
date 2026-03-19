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
  CreditCard,
  Loader2,
  Check,
  Trophy,
  Clock,
  Wallet,
  Mail,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import type { Service, Organization, OrganizationSubscriptionPlan } from "@shared/schema";
import { MapPin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

type StripeProduct = {
  productId: string;
  productName: string;
  productDescription: string;
  priceId: string;
  amountCents: number;
  currency: string;
  interval: string;
  intervalCount: number;
};

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

  const { data: adminProfile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = adminProfile?.organizationId;
  const { data: orgData } = useQuery<Organization>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });
  const { data: services, isLoading: servicesLoading } = useQuery<Service[]>({
    queryKey: ["/api/services", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/services?organizationId=${orgId}` : "/api/services";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json();
    },
  });
  const { data: coaches, isLoading: coachesLoading } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", orgId],
    queryFn: async () => {
      const url = orgId ? `/api/coaches?organizationId=${orgId}` : "/api/coaches";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
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
  const [newServiceType, setNewServiceType] = useState<"1_ON_1" | "GROUP">("1_ON_1");

  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editServiceName, setEditServiceName] = useState("");
  const [editServiceDesc, setEditServiceDesc] = useState("");
  const [editServiceDuration, setEditServiceDuration] = useState("");
  const [editServicePrice, setEditServicePrice] = useState("");
  const [editServiceActive, setEditServiceActive] = useState(true);
  const [editServiceType, setEditServiceType] = useState<"1_ON_1" | "GROUP">("1_ON_1");

  const athleticEnabled = orgData?.athleticEnabled === true;

  const { data: athleticPrograms } = useQuery<any[]>({
    queryKey: ["/api/athletic/programs", orgId],
    queryFn: () => fetch(`/api/athletic/programs?orgId=${orgId}`).then(r => r.json()),
    enabled: athleticEnabled && !!orgId,
  });

  const [payoutPercentage, setPayoutPercentage] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);


  const [selectedCoachId, setSelectedCoachId] = useState<string | null>(null);
  const [editCoachDialogOpen, setEditCoachDialogOpen] = useState(false);
  const [editCoachBio, setEditCoachBio] = useState("");
  const [editCoachSpecialties, setEditCoachSpecialties] = useState("");
  const [editCoachActive, setEditCoachActive] = useState(true);
  const [editCoachPayout, setEditCoachPayout] = useState("");

  const [payoutEditing, setPayoutEditing] = useState(false);

  const [addingProgram, setAddingProgram] = useState(false);
  const [newProgramName, setNewProgramName] = useState("");
  const [newProgramSlug, setNewProgramSlug] = useState("");
  const [newProgramMaxTeams, setNewProgramMaxTeams] = useState("2");
  const [newProgramTrainingTypes, setNewProgramTrainingTypes] = useState("Strength,Speed");
  const [newProgramStartHour, setNewProgramStartHour] = useState("16");
  const [newProgramEndHour, setNewProgramEndHour] = useState("20");

  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [editProgramName, setEditProgramName] = useState("");
  const [editProgramSlug, setEditProgramSlug] = useState("");
  const [editProgramMaxTeams, setEditProgramMaxTeams] = useState("2");
  const [editProgramTrainingTypes, setEditProgramTrainingTypes] = useState("");
  const [editProgramStartHour, setEditProgramStartHour] = useState("16");
  const [editProgramEndHour, setEditProgramEndHour] = useState("20");
  const [editProgramActive, setEditProgramActive] = useState(true);

  const [schedulesProgramId, setSchedulesProgramId] = useState<string | null>(null);
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [newScheduleLabel, setNewScheduleLabel] = useState("");
  const [newScheduleStartDate, setNewScheduleStartDate] = useState("");
  const [newScheduleEndDate, setNewScheduleEndDate] = useState("");
  const [newScheduleStartHour, setNewScheduleStartHour] = useState("8");
  const [newScheduleEndHour, setNewScheduleEndHour] = useState("11");

  const [showStripeProducts, setShowStripeProducts] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  const { data: savedPlans } = useQuery<OrganizationSubscriptionPlan[]>({
    queryKey: ["/api/organizations", orgId, "subscription-plans"],
    enabled: !!orgId,
  });

  const { data: stripeProducts, isLoading: stripeProductsLoading, refetch: refetchStripeProducts } = useQuery<StripeProduct[]>({
    queryKey: ["/api/organizations", orgId, "stripe-products"],
    enabled: false,
  });

  const toggleSubscriptionsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, { subscriptionsEnabled: enabled });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscriptions setting updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveSubscriptionPlansMutation = useMutation({
    mutationFn: async (plans: any[]) => {
      const res = await apiRequest("POST", `/api/organizations/${orgId}/subscription-plans`, { plans });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription plans saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", orgId, "subscription-plans"] });
      setShowStripeProducts(false);
      setSelectedProducts(new Set());
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteSubscriptionPlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiRequest("DELETE", `/api/organizations/${orgId}/subscription-plans/${planId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscription plan removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", orgId, "subscription-plans"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const [sendingEmailPlanId, setSendingEmailPlanId] = useState<string | null>(null);
  const sendSignupEmailsMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiRequest("POST", `/api/organizations/${orgId}/subscription-plans/${planId}/send-signup-emails`, {});
      return res.json();
    },
    onSuccess: (data, planId) => {
      setSendingEmailPlanId(null);
      toast({ title: "Emails sent", description: data.message });
    },
    onError: (error: Error) => {
      setSendingEmailPlanId(null);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleConnectStripeSubscriptions = () => {
    setShowStripeProducts(true);
    refetchStripeProducts();
    if (savedPlans?.length) {
      setSelectedProducts(new Set(savedPlans.map(p => p.stripePriceId)));
    }
  };

  const toggleProductSelection = (priceId: string) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(priceId)) {
        next.delete(priceId);
      } else {
        next.add(priceId);
      }
      return next;
    });
  };

  const handleSaveSelectedPlans = () => {
    if (!stripeProducts) return;
    const selected = stripeProducts.filter(p => selectedProducts.has(p.priceId));
    const plans = selected.map(p => ({
      stripeProductId: p.productId,
      stripePriceId: p.priceId,
      name: p.productName,
      description: p.productDescription,
      amountCents: p.amountCents,
      interval: p.interval,
      intervalCount: p.intervalCount,
    }));
    saveSubscriptionPlansMutation.mutate(plans);
  };

  const formatPrice = (cents: number, interval: string, intervalCount: number) => {
    const dollars = (cents / 100).toFixed(2);
    const intervalLabel = intervalCount > 1 ? `every ${intervalCount} ${interval}s` : `/${interval}`;
    return `$${dollars}${intervalLabel}`;
  };

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
      sessionType: string;
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
      setNewServiceType("1_ON_1");
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
    setEditServiceType((service.sessionType as "1_ON_1" | "GROUP") || "1_ON_1");
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
      sessionType: editServiceType,
    });
  };

  const deleteServiceMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/services/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Training option deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setEditingServiceId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateLocationsMutation = useMutation({
    mutationFn: async (locations: string[]) => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, { locations });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Locations updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addLocation = () => {
    if (!newLocation.trim()) return;
    const current = orgData?.locations || [];
    updateLocationsMutation.mutate([...current, newLocation.trim()]);
    setNewLocation("");
    setLocationDialogOpen(false);
  };

  const removeLocation = (index: number) => {
    const current = orgData?.locations || [];
    const updated = current.filter((_, i) => i !== index);
    updateLocationsMutation.mutate(updated);
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

  const toggleCoachTransactionsMutation = useMutation({
    mutationFn: async (visible: boolean) => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, { coachTransactionsVisible: visible });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
      toast({ title: "Coach transactions visibility updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleAthleticMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, { athleticEnabled: enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createProgramMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/athletic/programs", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Program created" });
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/programs", orgId] });
      setAddingProgram(false);
      setNewProgramName("");
      setNewProgramSlug("");
      setNewProgramMaxTeams("2");
      setNewProgramTrainingTypes("Strength,Speed");
      setNewProgramStartHour("16");
      setNewProgramEndHour("20");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateProgramMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/athletic/programs/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Program updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/programs", orgId] });
      setEditingProgramId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteProgramMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/athletic/programs/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Program deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/programs", orgId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { data: programSchedules } = useQuery<any[]>({
    queryKey: ["/api/athletic/schedules", schedulesProgramId],
    queryFn: () => fetch(`/api/athletic/schedules?programId=${schedulesProgramId}`).then(r => r.json()),
    enabled: !!schedulesProgramId,
  });

  const addScheduleMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/athletic/schedules", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule added" });
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/schedules", schedulesProgramId] });
      setAddingSchedule(false);
      setNewScheduleLabel("");
      setNewScheduleStartDate("");
      setNewScheduleEndDate("");
      setNewScheduleStartHour("8");
      setNewScheduleEndHour("11");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/athletic/schedules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/schedules", schedulesProgramId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const formatHourLabel = (hour: number) => {
    const suffix = hour >= 12 ? "PM" : "AM";
    const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${h}:00 ${suffix}`;
  };

  const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const startEditProgram = (p: any) => {
    setEditingProgramId(p.id);
    setEditProgramName(p.name);
    setEditProgramSlug(p.slug);
    setEditProgramMaxTeams(String(p.maxTeamsPerSlot ?? 2));
    setEditProgramTrainingTypes((p.trainingTypes || ["Strength", "Speed"]).join(", "));
    setEditProgramStartHour(String(p.startHour ?? 16));
    setEditProgramEndHour(String(p.endHour ?? 20));
    setEditProgramActive(p.active !== false);
  };

  const saveEditProgram = () => {
    if (!editingProgramId) return;
    const start = parseInt(editProgramStartHour);
    const end = parseInt(editProgramEndHour);
    if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > 24) {
      toast({ title: "Invalid hours", description: "Start hour must be before end hour (0-24).", variant: "destructive" });
      return;
    }
    const types = editProgramTrainingTypes.split(",").map((t: string) => t.trim()).filter(Boolean);
    if (types.length === 0) {
      toast({ title: "Invalid", description: "At least one training type is required.", variant: "destructive" });
      return;
    }
    updateProgramMutation.mutate({
      id: editingProgramId,
      data: {
        name: editProgramName.trim(),
        slug: editProgramSlug.trim(),
        maxTeamsPerSlot: parseInt(editProgramMaxTeams) || 2,
        trainingTypes: types,
        startHour: start,
        endHour: end,
        active: editProgramActive,
      },
    });
  };

  const handleCreateProgram = () => {
    const start = parseInt(newProgramStartHour);
    const end = parseInt(newProgramEndHour);
    if (!newProgramName.trim() || !newProgramSlug.trim()) {
      toast({ title: "Missing fields", description: "Name and slug are required.", variant: "destructive" });
      return;
    }
    if (isNaN(start) || isNaN(end) || start >= end) {
      toast({ title: "Invalid hours", description: "Start hour must be before end hour.", variant: "destructive" });
      return;
    }
    const types = newProgramTrainingTypes.split(",").map((t: string) => t.trim()).filter(Boolean);
    if (types.length === 0) {
      toast({ title: "Invalid", description: "At least one training type is required.", variant: "destructive" });
      return;
    }
    createProgramMutation.mutate({
      name: newProgramName.trim(),
      slug: newProgramSlug.trim(),
      maxTeamsPerSlot: parseInt(newProgramMaxTeams) || 2,
      trainingTypes: types,
      startHour: start,
      endHour: end,
    });
  };

  const handleAddSchedule = () => {
    const start = parseInt(newScheduleStartHour);
    const end = parseInt(newScheduleEndHour);
    if (!newScheduleLabel.trim() || !newScheduleStartDate || !newScheduleEndDate) {
      toast({ title: "Missing fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }
    if (start >= end) {
      toast({ title: "Invalid hours", description: "Start hour must be before end hour.", variant: "destructive" });
      return;
    }
    addScheduleMutation.mutate({
      programId: schedulesProgramId,
      label: newScheduleLabel.trim(),
      startDate: newScheduleStartDate,
      endDate: newScheduleEndDate,
      startHour: start,
      endHour: end,
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
                <div>
                  <Label>Session Type</Label>
                  <Select value={newServiceType} onValueChange={(v) => setNewServiceType(v as "1_ON_1" | "GROUP")}>
                    <SelectTrigger data-testid="select-new-service-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1_ON_1">1 on 1</SelectItem>
                      <SelectItem value="GROUP">Group</SelectItem>
                    </SelectContent>
                  </Select>
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
                      sessionType: newServiceType,
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
                  <div>
                    <Label>Session Type</Label>
                    <Select value={editServiceType} onValueChange={(v) => setEditServiceType(v as "1_ON_1" | "GROUP")}>
                      <SelectTrigger data-testid={`select-edit-service-type-${service.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1_ON_1">1 on 1</SelectItem>
                        <SelectItem value="GROUP">Group</SelectItem>
                      </SelectContent>
                    </Select>
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
                  <div className="flex items-center justify-between">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" data-testid={`button-delete-service-${service.id}`}>
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Training Option</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete "{service.name}". If this option has existing bookings, it cannot be deleted — deactivate it instead. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="button-cancel-delete-service">Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteServiceMutation.mutate(service.id)}
                            data-testid="button-confirm-delete-service"
                          >
                            {deleteServiceMutation.isPending ? "Deleting..." : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={cancelEditService} data-testid={`button-cancel-edit-${service.id}`}>
                        <X className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={updateServiceMutation.isPending}
                        onClick={saveEditService}
                        data-testid={`button-save-service-${service.id}`}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        {updateServiceMutation.isPending ? "Saving..." : "Save & Sync Stripe"}
                      </Button>
                    </div>
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
                        {service.sessionType === "GROUP" ? "Group" : "1 on 1"}
                      </Badge>
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Session Locations
          </h2>
          <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-location">
                <Plus className="h-4 w-4 mr-1" /> Add Location
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Location</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div>
                  <Label>Location Name</Label>
                  <Input
                    placeholder="e.g. Downtown Gym (City, State)"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    data-testid="input-new-location"
                  />
                </div>
                <Button
                  onClick={addLocation}
                  disabled={updateLocationsMutation.isPending || !newLocation.trim()}
                  data-testid="button-submit-location"
                >
                  {updateLocationsMutation.isPending ? "Adding..." : "Add Location"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-2">
          {(orgData?.locations || []).length === 0 && (
            <p className="text-sm text-muted-foreground">No locations configured yet. Add locations that coaches can select when scheduling sessions.</p>
          )}
          {(orgData?.locations || []).map((loc, index) => (
            <Card key={index} className="p-3 flex items-center justify-between" data-testid={`card-location-${index}`}>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium" data-testid={`text-location-${index}`}>{loc}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeLocation(index)}
                disabled={updateLocationsMutation.isPending}
                data-testid={`button-remove-location-${index}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscriptions
          </h2>
          <div className="flex items-center gap-2">
            <Label htmlFor="subscriptions-toggle" className="text-sm text-muted-foreground">
              {orgData?.subscriptionsEnabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="subscriptions-toggle"
              checked={orgData?.subscriptionsEnabled ?? false}
              onCheckedChange={(checked) => toggleSubscriptionsMutation.mutate(checked)}
              disabled={toggleSubscriptionsMutation.isPending}
              data-testid="switch-subscriptions-enabled"
            />
          </div>
        </div>

        {orgData?.subscriptionsEnabled && (
          <div className="space-y-4">
            {!showStripeProducts && (
              <>
                <Button
                  onClick={handleConnectStripeSubscriptions}
                  variant="outline"
                  className="w-full"
                  data-testid="button-connect-stripe-subscriptions"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Connect with your Stripe Subscriptions
                </Button>

                {savedPlans && savedPlans.length > 0 && (
                  <div className="grid gap-2">
                    <p className="text-sm text-muted-foreground">Active subscription plans on your platform:</p>
                    {savedPlans.map((plan) => (
                      <Card key={plan.id} className="p-3 space-y-2" data-testid={`card-subscription-plan-${plan.id}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm" data-testid={`text-plan-name-${plan.id}`}>{plan.name}</p>
                            {plan.description && (
                              <p className="text-xs text-muted-foreground">{plan.description}</p>
                            )}
                            <Badge variant="secondary" className="text-xs mt-1">
                              {formatPrice(plan.amountCents, plan.interval, plan.intervalCount ?? 1)}
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteSubscriptionPlanMutation.mutate(plan.id)}
                            disabled={deleteSubscriptionPlanMutation.isPending}
                            data-testid={`button-remove-plan-${plan.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">Cancellation:</span>
                          <Select
                            value={(plan as any).cancellationPolicy || "end_of_period"}
                            onValueChange={async (value) => {
                              try {
                                await apiRequest("PATCH", `/api/organizations/${orgId}/subscription-plans/${plan.id}`, { cancellationPolicy: value });
                                queryClient.invalidateQueries({ queryKey: ["/api/organizations", orgId, "subscription-plans"] });
                                toast({ title: "Updated", description: `Cancellation policy set to ${value === "immediate" ? "Immediate" : "End of billing period"}` });
                              } catch {
                                toast({ title: "Error", description: "Failed to update policy", variant: "destructive" });
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-auto min-w-[180px]" data-testid={`select-cancel-policy-${plan.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="end_of_period">End of billing period</SelectItem>
                              <SelectItem value="immediate">Immediate</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">Session type:</span>
                          <Select
                            value={plan.sessionType || "personal"}
                            onValueChange={async (value) => {
                              try {
                                await apiRequest("PATCH", `/api/organizations/${orgId}/subscription-plans/${plan.id}`, { sessionType: value });
                                queryClient.invalidateQueries({ queryKey: ["/api/organizations", orgId, "subscription-plans"] });
                                toast({ title: "Updated", description: `Session type set to ${value === "group" ? "Group (Open Sessions)" : "Personal"}` });
                              } catch {
                                toast({ title: "Error", description: "Failed to update session type", variant: "destructive" });
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-auto min-w-[180px]" data-testid={`select-session-type-${plan.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="personal">Personal</SelectItem>
                              <SelectItem value="group">Group (Open Sessions)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">Sessions/week:</span>
                          <Select
                            value={String((plan as any).sessionsPerWeek || 1)}
                            onValueChange={async (value) => {
                              try {
                                await apiRequest("PATCH", `/api/organizations/${orgId}/subscription-plans/${plan.id}`, { sessionsPerWeek: parseInt(value) });
                                queryClient.invalidateQueries({ queryKey: ["/api/organizations", orgId, "subscription-plans"] });
                                toast({ title: "Updated", description: `Sessions per week set to ${value}x` });
                              } catch {
                                toast({ title: "Error", description: "Failed to update sessions per week", variant: "destructive" });
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-auto min-w-[100px]" data-testid={`select-sessions-per-week-${plan.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1x</SelectItem>
                              <SelectItem value="2">2x</SelectItem>
                              <SelectItem value="3">3x</SelectItem>
                              <SelectItem value="4">4x</SelectItem>
                              <SelectItem value="5">5x</SelectItem>
                              <SelectItem value="6">6x</SelectItem>
                              <SelectItem value="7">7x</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">Coach pay/session:</span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">$</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Not set"
                              className="h-7 text-xs w-24"
                              defaultValue={(plan as any).coachPayPerSessionCents ? ((plan as any).coachPayPerSessionCents / 100).toFixed(2) : ""}
                              data-testid={`input-coach-pay-${plan.id}`}
                              onBlur={async (e) => {
                                const val = e.target.value;
                                const cents = val ? Math.round(parseFloat(val) * 100) : null;
                                try {
                                  await apiRequest("PATCH", `/api/organizations/${orgId}/subscription-plans/${plan.id}`, { coachPayPerSessionCents: cents });
                                  queryClient.invalidateQueries({ queryKey: ["/api/organizations", orgId, "subscription-plans"] });
                                  toast({ title: "Updated", description: cents ? `Coach pay set to $${(cents / 100).toFixed(2)} per session` : "Coach pay cleared" });
                                } catch {
                                  toast({ title: "Error", description: "Failed to update coach pay", variant: "destructive" });
                                }
                              }}
                            />
                          </div>
                        </div>
                        <div className="border-t pt-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full text-xs"
                                disabled={sendSignupEmailsMutation.isPending && sendingEmailPlanId === plan.id}
                                data-testid={`button-send-signup-emails-${plan.id}`}
                              >
                                {sendSignupEmailsMutation.isPending && sendingEmailPlanId === plan.id ? (
                                  <><Loader2 className="h-3 w-3 mr-2 animate-spin" />Sending...</>
                                ) : (
                                  <><Mail className="h-3 w-3 mr-2" />Send Sign-up Email to Active Members</>
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Send Subscription Sign-up Emails</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will send an email to all active members in your organization inviting them to subscribe to <strong>{plan.name}</strong>. The email includes a secure link to complete checkout on your connected Stripe account.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => {
                                    setSendingEmailPlanId(plan.id);
                                    sendSignupEmailsMutation.mutate(plan.id);
                                  }}
                                  data-testid={`button-confirm-send-emails-${plan.id}`}
                                >
                                  Send Emails
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
                {savedPlans && savedPlans.length === 0 && (
                  <p className="text-sm text-muted-foreground">No subscription plans configured yet. Connect your Stripe account to import subscription products.</p>
                )}
              </>
            )}

            {showStripeProducts && (
              <Card className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">Select Stripe Subscription Products</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowStripeProducts(false); setSelectedProducts(new Set()); }}
                    data-testid="button-close-stripe-products"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {stripeProductsLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading Stripe products...</span>
                  </div>
                )}

                {!stripeProductsLoading && stripeProducts && stripeProducts.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No recurring subscription products found in your Stripe account. Create subscription products in your Stripe Dashboard first.
                  </p>
                )}

                {!stripeProductsLoading && stripeProducts && stripeProducts.length > 0 && (
                  <div className="grid gap-2">
                    {stripeProducts.map((product) => {
                      const isSelected = selectedProducts.has(product.priceId);
                      return (
                        <div
                          key={product.priceId}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"
                          }`}
                          onClick={() => toggleProductSelection(product.priceId)}
                          data-testid={`card-stripe-product-${product.priceId}`}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleProductSelection(product.priceId)}
                            data-testid={`checkbox-product-${product.priceId}`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{product.productName}</p>
                            {product.productDescription && (
                              <p className="text-xs text-muted-foreground truncate">{product.productDescription}</p>
                            )}
                          </div>
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {formatPrice(product.amountCents, product.interval, product.intervalCount)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!stripeProductsLoading && stripeProducts && stripeProducts.length > 0 && (
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setShowStripeProducts(false); setSelectedProducts(new Set()); }}
                      data-testid="button-cancel-stripe-selection"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveSelectedPlans}
                      disabled={selectedProducts.size === 0 || saveSubscriptionPlansMutation.isPending}
                      data-testid="button-save-stripe-selection"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      {saveSubscriptionPlansMutation.isPending ? "Saving..." : `Add ${selectedProducts.size} Plan${selectedProducts.size !== 1 ? "s" : ""}`}
                    </Button>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
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

      <section>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Wallet className="h-5 w-5" />
          Coach Transactions
        </h2>
        <Card className="p-4" data-testid="card-coach-transactions-settings">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Show Transactions in Sidebar</p>
              <p className="text-xs text-muted-foreground">Control whether coaches can see the Transactions page in their sidebar navigation.</p>
            </div>
            <Switch
              checked={orgData?.coachTransactionsVisible !== false}
              onCheckedChange={(checked) => toggleCoachTransactionsMutation.mutate(checked)}
              disabled={toggleCoachTransactionsMutation.isPending}
              data-testid="switch-coach-transactions-visible"
            />
          </div>
        </Card>
      </section>

      <section>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5" />
          Athletic Programs
        </h2>
        <Card className="p-4 space-y-4" data-testid="card-athletic-settings">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Athletic Scheduling</p>
              <p className="text-xs text-muted-foreground">Allow teams to book athletic training time slots on your landing page.</p>
            </div>
            <Switch
              checked={athleticEnabled}
              onCheckedChange={(checked) => toggleAthleticMutation.mutate(checked)}
              data-testid="switch-athletic-enabled"
            />
          </div>
        </Card>
      </section>

      {athleticEnabled && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Programs
            </h2>
            <Button size="sm" onClick={() => setAddingProgram(true)} data-testid="button-add-program">
              <Plus className="h-4 w-4 mr-1" /> Add Program
            </Button>
          </div>

          {addingProgram && (
            <Card className="p-4 space-y-3 mb-4" data-testid="card-add-program">
              <p className="text-sm font-semibold">New Athletic Program</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Program Name</Label>
                  <Input
                    placeholder="e.g., BLHS Athletic"
                    value={newProgramName}
                    onChange={(e) => { setNewProgramName(e.target.value); setNewProgramSlug(slugify(e.target.value)); }}
                    data-testid="input-new-program-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">URL Slug</Label>
                  <Input
                    placeholder="e.g., blhs-athletic"
                    value={newProgramSlug}
                    onChange={(e) => setNewProgramSlug(e.target.value)}
                    data-testid="input-new-program-slug"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Teams Per Slot</Label>
                  <Input
                    type="number"
                    min="1"
                    value={newProgramMaxTeams}
                    onChange={(e) => setNewProgramMaxTeams(e.target.value)}
                    data-testid="input-new-program-max-teams"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Training Types (comma-separated)</Label>
                  <Input
                    placeholder="Strength, Speed, Agility"
                    value={newProgramTrainingTypes}
                    onChange={(e) => setNewProgramTrainingTypes(e.target.value)}
                    data-testid="input-new-program-types"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Start Hour</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={newProgramStartHour}
                    onChange={(e) => setNewProgramStartHour(e.target.value)}
                    data-testid="select-new-program-start-hour"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{formatHourLabel(i)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">End Hour</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    value={newProgramEndHour}
                    onChange={(e) => setNewProgramEndHour(e.target.value)}
                    data-testid="select-new-program-end-hour"
                  >
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>{formatHourLabel(h === 24 ? 0 : h)}{h === 24 ? " (Midnight)" : ""}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={createProgramMutation.isPending} onClick={handleCreateProgram} data-testid="button-save-new-program">
                  <Save className="h-4 w-4 mr-1" />
                  {createProgramMutation.isPending ? "Creating..." : "Create Program"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAddingProgram(false)} data-testid="button-cancel-new-program">
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
              </div>
            </Card>
          )}

          <div className="space-y-4">
            {athleticPrograms?.map((p: any) => (
              <Card key={p.id} className="p-4 space-y-3" data-testid={`card-program-${p.id}`}>
                {editingProgramId === p.id ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Program Name</Label>
                        <Input value={editProgramName} onChange={(e) => setEditProgramName(e.target.value)} data-testid="input-edit-program-name" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">URL Slug</Label>
                        <Input value={editProgramSlug} onChange={(e) => setEditProgramSlug(e.target.value)} data-testid="input-edit-program-slug" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Max Teams Per Slot</Label>
                        <Input type="number" min="1" value={editProgramMaxTeams} onChange={(e) => setEditProgramMaxTeams(e.target.value)} data-testid="input-edit-program-max-teams" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Training Types (comma-separated)</Label>
                        <Input value={editProgramTrainingTypes} onChange={(e) => setEditProgramTrainingTypes(e.target.value)} data-testid="input-edit-program-types" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Start Hour</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={editProgramStartHour} onChange={(e) => setEditProgramStartHour(e.target.value)} data-testid="select-edit-program-start-hour">
                          {Array.from({ length: 24 }, (_, i) => (<option key={i} value={i}>{formatHourLabel(i)}</option>))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">End Hour</Label>
                        <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={editProgramEndHour} onChange={(e) => setEditProgramEndHour(e.target.value)} data-testid="select-edit-program-end-hour">
                          {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (<option key={h} value={h}>{formatHourLabel(h === 24 ? 0 : h)}{h === 24 ? " (Midnight)" : ""}</option>))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Switch checked={editProgramActive} onCheckedChange={setEditProgramActive} data-testid="switch-edit-program-active" />
                        <Label className="text-xs">{editProgramActive ? "Active" : "Inactive"}</Label>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" disabled={updateProgramMutation.isPending} onClick={saveEditProgram} data-testid="button-save-edit-program">
                        <Save className="h-4 w-4 mr-1" /> {updateProgramMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingProgramId(null)} data-testid="button-cancel-edit-program">
                        <X className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold" data-testid={`text-program-name-${p.id}`}>{p.name}</p>
                          {!p.active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">/{p.slug}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => startEditProgram(p)} data-testid={`button-edit-program-${p.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => { setSchedulesProgramId(schedulesProgramId === p.id ? null : p.id); setAddingSchedule(false); }} data-testid={`button-schedules-program-${p.id}`}>
                          <Clock className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7" data-testid={`button-delete-program-${p.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Program</AlertDialogTitle>
                              <AlertDialogDescription>This will permanently delete "{p.name}" and all its bookings and schedules. This cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteProgramMutation.mutate(p.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatHourLabel(p.startHour)} - {formatHourLabel(p.endHour)}</span>
                      <span className="flex items-center gap-1"><Dumbbell className="h-3.5 w-3.5" /> {(p.trainingTypes || []).join(", ")}</span>
                      <span>Max {p.maxTeamsPerSlot} teams/slot</span>
                    </div>
                  </>
                )}

                {schedulesProgramId === p.id && (
                  <div className="border-t pt-3 mt-2 space-y-3">
                    <p className="text-sm font-medium">Date Range Schedules</p>
                    <p className="text-xs text-muted-foreground">Custom hours for specific date ranges (override default hours).</p>
                    {programSchedules && programSchedules.length > 0 && (
                      <div className="space-y-2">
                        {programSchedules.map((s: any) => (
                          <div key={s.id} className="flex items-center justify-between rounded-md border p-3" data-testid={`schedule-row-${s.id}`}>
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium">{s.label}</p>
                              <p className="text-xs text-muted-foreground">{s.startDate} to {s.endDate} &middot; {formatHourLabel(s.startHour)} - {formatHourLabel(s.endHour)}</p>
                            </div>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7" onClick={() => deleteScheduleMutation.mutate(s.id)} data-testid={`button-delete-schedule-${s.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {addingSchedule ? (
                      <div className="space-y-3 rounded-md border p-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Label</Label>
                          <Input placeholder="e.g., Summer Hours" value={newScheduleLabel} onChange={(e) => setNewScheduleLabel(e.target.value)} data-testid="input-schedule-label" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Start Date</Label>
                            <Input type="date" value={newScheduleStartDate} onChange={(e) => setNewScheduleStartDate(e.target.value)} data-testid="input-schedule-start-date" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">End Date</Label>
                            <Input type="date" value={newScheduleEndDate} onChange={(e) => setNewScheduleEndDate(e.target.value)} data-testid="input-schedule-end-date" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Start Hour</Label>
                            <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={newScheduleStartHour} onChange={(e) => setNewScheduleStartHour(e.target.value)} data-testid="select-schedule-start-hour">
                              {Array.from({ length: 24 }, (_, i) => (<option key={i} value={i}>{formatHourLabel(i)}</option>))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">End Hour</Label>
                            <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={newScheduleEndHour} onChange={(e) => setNewScheduleEndHour(e.target.value)} data-testid="select-schedule-end-hour">
                              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (<option key={h} value={h}>{formatHourLabel(h === 24 ? 0 : h)}{h === 24 ? " (Midnight)" : ""}</option>))}
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" disabled={addScheduleMutation.isPending} onClick={handleAddSchedule} data-testid="button-save-schedule">
                            <Save className="h-4 w-4 mr-1" /> {addScheduleMutation.isPending ? "Adding..." : "Add Schedule"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setAddingSchedule(false)} data-testid="button-cancel-schedule">
                            <X className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setAddingSchedule(true)} data-testid="button-add-schedule">
                        <Plus className="h-4 w-4 mr-1" /> Add Date Range
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            ))}

            {(!athleticPrograms || athleticPrograms.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-6">No athletic programs yet. Click "Add Program" to create one.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
