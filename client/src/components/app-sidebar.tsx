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
} from "@/components/ui/sidebar";
import {
  Dumbbell,
  Users,
  Calendar,
  CalendarClock,
  LayoutDashboard,
  Clock,
  DollarSign,
  Shield,
  LogOut,
} from "lucide-react";
import type { UserProfile } from "@shared/schema";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/profile"],
    enabled: isAuthenticated,
  });

  const role = profile?.role || "CLIENT";

  const clientItems = [
    { title: "Coaches", url: "/coaches", icon: Users },
    { title: "My Bookings", url: "/bookings", icon: Calendar },
  ];

  const coachItems = [
    { title: "Dashboard", url: "/coach", icon: LayoutDashboard },
    { title: "Availability", url: "/coach/availability", icon: CalendarClock },
    { title: "Redemptions", url: "/coach/redemptions", icon: DollarSign },
  ];

  const adminItems = [
    { title: "Admin", url: "/admin", icon: Shield },
  ];

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center gap-2 px-2 py-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Dumbbell className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm tracking-tight">Efficiency ST</span>
          </div>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Browse</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {clientItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url || location.startsWith(item.url + "/")}>
                    <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
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
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
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
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
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
            <a href="/api/logout">
              <Button size="icon" variant="ghost" data-testid="button-logout">
                <LogOut className="h-4 w-4" />
              </Button>
            </a>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
