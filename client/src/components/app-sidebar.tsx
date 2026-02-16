import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  Shield,
  LogOut,
  UserCog,
  Trophy,
  Wallet,
} from "lucide-react";
import logoImg from "@assets/IMG_7961_1771105509253.jpeg";
import type { UserProfile } from "@shared/schema";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const role = profile?.role || "CLIENT";

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const clientItems = [
    { title: "Coaches", url: "/coaches", icon: Users },
    { title: "Group Sessions", url: "/sessions", icon: UsersRound },
    { title: "My Bookings", url: "/bookings", icon: Calendar },
    ...(role === "CLIENT" ? [{ title: "My Wallet", url: "/wallet", icon: Wallet }] : []),
  ];

  const coachItems = [
    { title: "Dashboard", url: "/coach", icon: LayoutDashboard },
    { title: "My Profile", url: "/coach/profile", icon: UserCog },
    { title: "Availability", url: "/coach/availability", icon: CalendarClock },
    { title: "Redemptions", url: "/coach/redemptions", icon: DollarSign },
    { title: "Users", url: "/coach/users", icon: Users },
    { title: "BLHS Athletic", url: "/coach/athletic", icon: Trophy },
  ];

  const adminItems = [
    { title: "Admin", url: "/admin", icon: Shield },
  ];

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center gap-2 px-2 py-3">
            <img src={logoImg} alt="EST" className="h-8 rounded-md" data-testid="img-sidebar-logo" />
            <span className="font-semibold text-sm tracking-tight">Efficiency Strength Training</span>
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

        {role === "ADMIN" && user?.id === "42755213" && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
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
  );
}
