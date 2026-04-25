import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Users,
  UsersRound,
  Calendar,
  CalendarClock,
  LayoutDashboard,
  DollarSign,
  LogOut,
  UserCog,
  Trophy,
  Wallet,
  Briefcase,
  FileText,
  Dumbbell,
  Settings,
  Paintbrush,
  CreditCard,
  Sparkles,
  Trash2,
  Bot,
  CalendarDays,
  ImagePlay,
  Mail,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { clearAuthToken } from "@/lib/authToken";
import logoImg from "@assets/IMG_7961_1771105509253.jpeg";
import type { UserProfile } from "@shared/schema";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const role = profile?.role || "CLIENT";

  const orgId = profile?.organizationId;
  const { data: organization, isLoading: orgLoading } = useQuery<{ name: string; logoUrl?: string | null }>({
    queryKey: ["/api/organizations/by-id", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/by-id/${orgId}`);
      if (!res.ok) throw new Error("Failed to fetch org");
      return res.json();
    },
    enabled: !!orgId,
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/organizations/${orgId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Organization deleted", description: "Your organization has been permanently deleted." });
      clearAuthToken();
      window.location.href = "/";
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to delete organization", variant: "destructive" });
    },
  });

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const clientItems = [
    { title: "Coaches", url: "/coaches", icon: Users },
    { title: "Group Sessions", url: "/sessions", icon: UsersRound },
    { title: "Team Training", url: "/team-training", icon: Dumbbell },
    { title: "My Bookings", url: "/bookings", icon: Calendar },
    ...(role === "CLIENT" ? [{ title: "My Wallet", url: "/wallet", icon: Wallet }] : []),
    ...(role === "CLIENT" ? [{ title: "Scheduling Agent", url: "/scheduling/agent", icon: Bot }] : []),
  ];

  const athleticEnabled = (organization as any)?.athleticEnabled === true;

  const { data: athleticProgramsSidebar } = useQuery<any[]>({
    queryKey: ["/api/athletic/programs", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/athletic/programs?orgId=${orgId}`);
      return res.json();
    },
    enabled: !!orgId && athleticEnabled,
  });

  const activeAthleticPrograms = athleticProgramsSidebar?.filter((p: any) => p.active) || [];

  const coachTransactionsVisible = (organization as any)?.coachTransactionsVisible !== false;

  const coachItems = [
    { title: "Dashboard", url: "/coach", icon: LayoutDashboard },
    { title: "My Profile", url: "/coach/profile", icon: UserCog },
    { title: "Availability", url: "/coach/availability", icon: CalendarClock },
    { title: "Redemptions", url: "/coach/redemptions", icon: DollarSign },
    ...(coachTransactionsVisible ? [{ title: "Transactions", url: "/coach/transactions", icon: Wallet }] : []),
    { title: "Users", url: "/coach/users", icon: Users },
    ...(athleticEnabled ? [{ title: activeAthleticPrograms.length === 1 ? activeAthleticPrograms[0]?.name || "Athletic" : "Athletic", url: "/coach/athletic", icon: Trophy }] : []),
    { title: "Team Quotes", url: "/coach/team-quotes", icon: FileText },
    { title: "Email History", url: "/coach/communications", icon: Mail },
  ];


  return (
    <>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <div className="flex items-center gap-2 px-2 py-3">
              {organization?.logoUrl ? (
                <img src={organization?.logoUrl || logoImg} alt={organization?.name || "Logo"} className="h-8 rounded-md object-contain" data-testid="img-sidebar-logo" />
              ) : orgLoading ? (
                <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
              ) : (
                <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm" data-testid="img-sidebar-logo">
                  {(organization?.name || "").charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-semibold text-sm tracking-tight">
                {organization?.name || (orgLoading ? "Loading..." : "My Organization")}
              </span>
            </div>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Browse</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {clientItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url || location.startsWith(item.url + "/")}>
                      <Link href={item.url} onClick={handleNavClick} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {(role === "COACH" || role === "ADMIN" || role === "STAFF") && (
            <SidebarGroup>
              <SidebarGroupLabel>Scheduling</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/scheduling"}>
                      <Link href="/scheduling" onClick={handleNavClick} data-testid="nav-scheduling">
                        <CalendarDays className="h-4 w-4" />
                        <span>Schedule</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/scheduling/agent"}>
                      <Link href="/scheduling/agent" onClick={handleNavClick} data-testid="nav-scheduling-agent">
                        <Bot className="h-4 w-4" />
                        <span>Scheduling Agent</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {(role === "COACH" || role === "ADMIN") && (
            <SidebarGroup>
              <SidebarGroupLabel>Business Plan</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/coach/business-plan"}>
                      <Link href="/coach/business-plan" onClick={handleNavClick} data-testid="nav-business-plan">
                        <Briefcase className="h-4 w-4" />
                        <span>Business Plan</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {(role === "COACH" || role === "ADMIN") && (
            <SidebarGroup>
              <SidebarGroupLabel>Coach Tools</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {coachItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.url}>
                        <Link href={item.url} onClick={handleNavClick} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {role === "ADMIN" && (
            <SidebarGroup>
              <SidebarGroupLabel>Configuration</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/admin/configuration"}>
                      <Link href="/admin/configuration" onClick={handleNavClick} data-testid="nav-options">
                        <Settings className="h-4 w-4" />
                        <span>Options</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/admin/branding"}>
                      <Link href="/admin/branding" onClick={handleNavClick} data-testid="nav-branding">
                        <Paintbrush className="h-4 w-4" />
                        <span>Branding</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/admin/media"}>
                      <Link href="/admin/media" onClick={handleNavClick} data-testid="nav-media">
                        <ImagePlay className="h-4 w-4" />
                        <span>Media Library</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/admin/stripe"}>
                      <Link href="/admin/stripe" onClick={handleNavClick} data-testid="nav-stripe">
                        <CreditCard className="h-4 w-4" />
                        <span>Stripe</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location === "/admin/subscription"}>
                      <Link href="/admin/subscription" onClick={handleNavClick} data-testid="nav-subscription">
                        <Sparkles className="h-4 w-4" />
                        <span>Subscription</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {role === "ADMIN" && (
            <SidebarGroup>
              <SidebarGroupLabel>Danger Zone</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setDeleteDialogOpen(true)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      data-testid="button-delete-organization"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Delete Organization</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

        </SidebarContent>

        <SidebarFooter className="p-3">
          {user && (
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.profileImageUrl || undefined} />
                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                  {(user.firstName?.[0] || "U").toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user.firstName} {user.lastName}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <Button size="icon" variant="ghost" data-testid="button-logout" onClick={() => logout()}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </SidebarFooter>
      </Sidebar>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-dialog-title">Are you sure?</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-dialog-description">
              This will permanently delete your organization, all services, coach profiles, and user data associated with it. If you have an active subscription, it will also be canceled. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteOrgMutation.mutate()}
              disabled={deleteOrgMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteOrgMutation.isPending ? "Deleting..." : "Delete Organization"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
