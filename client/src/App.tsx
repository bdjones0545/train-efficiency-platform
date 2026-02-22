import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import CoachesPage from "@/pages/coaches";
import CoachSchedulePage from "@/pages/coach-schedule";
import MyBookingsPage from "@/pages/my-bookings";
import CoachDashboardPage from "@/pages/coach-dashboard";
import AvailabilityManagerPage from "@/pages/availability-manager";
import RedemptionsPage from "@/pages/redemptions";
import CoachProfilePage from "@/pages/coach-profile";
import AdminDashboardPage from "@/pages/admin-dashboard";
import OpenSessionsPage from "@/pages/open-sessions";
import AthleticSchedulingPage from "@/pages/athletic-scheduling";
import CoachAthleticPage from "@/pages/coach-athletic";
import UserManagementPage from "@/pages/user-management";
import CoachTransactionsPage from "@/pages/coach-transactions";
import CoachBusinessPlanPage from "@/pages/coach-business-plan";
import WalletPage from "@/pages/wallet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatWidget } from "@/components/chat-widget";
import logoImg from "@assets/IMG_7961_1771105509253.jpeg";

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-3 border-b sticky top-0 z-50 bg-background/80 backdrop-blur-md">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-5xl mx-auto">
              <Switch>
                <Route path="/" component={CoachesPage} />
                <Route path="/coaches" component={CoachesPage} />
                <Route path="/coaches/:id" component={CoachSchedulePage} />
                <Route path="/sessions" component={OpenSessionsPage} />
                <Route path="/athletic" component={AthleticSchedulingPage} />
                <Route path="/bookings" component={MyBookingsPage} />
                <Route path="/wallet" component={WalletPage} />
                <Route path="/coach" component={CoachDashboardPage} />
                <Route path="/coach/profile" component={CoachProfilePage} />
                <Route path="/coach/availability" component={AvailabilityManagerPage} />
                <Route path="/coach/redemptions" component={RedemptionsPage} />
                <Route path="/coach/users" component={UserManagementPage} />
                <Route path="/coach/transactions" component={CoachTransactionsPage} />
                <Route path="/coach/business-plan" component={CoachBusinessPlanPage} />
                <Route path="/coach/athletic" component={CoachAthleticPage} />
                <Route path="/admin" component={AdminDashboardPage} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function PublicLayout() {
  return (
    <Switch>
      <Route path="/sessions" component={OpenSessionsPublicPage} />
      <Route path="/athletic" component={AthleticSchedulingPage} />
      <Route><LandingPage /></Route>
    </Switch>
  );
}

function OpenSessionsPublicPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4 flex-wrap">
          <a href="/" className="flex items-center gap-2" data-testid="link-nav-home">
            <img src={logoImg} alt="EST Logo" className="h-8 rounded-md" data-testid="img-public-nav-logo" />
            <span className="font-semibold text-lg tracking-tight" data-testid="text-public-brand-name">Efficiency Strength Training</span>
          </a>
          <div className="flex items-center gap-3">
            <a href="/">
              <Button variant="ghost" size="sm" data-testid="link-home">Home</Button>
            </a>
            <a href="/">
              <Button data-testid="button-register">Sign Up / Log In</Button>
            </a>
          </div>
        </div>
      </nav>
      <main className="pt-24 pb-12 px-6">
        <div className="max-w-5xl mx-auto">
          <OpenSessionsPage />
        </div>
      </main>
    </div>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-full max-w-sm px-6">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <PublicLayout />;
  }

  return <AuthenticatedLayout />;
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AppContent />
          <ChatWidget />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
