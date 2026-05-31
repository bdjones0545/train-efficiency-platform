import { Component } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { OrgSidebar } from "@/components/OrgSidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import CoachesPage from "@/pages/coaches";
import CoachSchedulePage from "@/pages/coach-schedule";
import BookFastPage from "@/pages/book-fast";
import MyBookingsPage from "@/pages/my-bookings";
import CoachDashboardPage from "@/pages/coach-dashboard";
import AvailabilityManagerPage from "@/pages/availability-manager";
import RedemptionsPage from "@/pages/redemptions";
import CoachProfilePage from "@/pages/coach-profile";
import AdminDashboardPage from "@/pages/admin-dashboard";
import AdminConfigurationPage from "@/pages/admin-configuration";
import AdminBrandingPage from "@/pages/admin-branding";
import AdminMediaPage from "@/pages/admin-media";
import AdminStripePage from "@/pages/admin-stripe";
import AdminSubscriptionPage from "@/pages/admin-subscription";
import AdminSetupPage from "@/pages/admin-setup";
import OpenSessionsPage from "@/pages/open-sessions";
import AthleticSchedulingPage from "@/pages/athletic-scheduling";
import ProgramToolPage from "@/pages/program-tool-placeholder";
import CoachAthleticPage from "@/pages/coach-athletic";
import UserManagementPage from "@/pages/user-management";
import CoachTransactionsPage from "@/pages/coach-transactions";
import CoachBusinessPlanPage from "@/pages/coach-business-plan";
import WalletPage from "@/pages/wallet";
import TeamQuotesPage from "@/pages/team-quotes";
import TeamTrainingPage from "@/pages/team-training";
import EfficiencyStrengthPage from "@/pages/efficiency-strength";
import OrgLandingPage from "@/pages/org-landing";
import PrivacyPolicyPage from "@/pages/privacy-policy";
import TermsConditionsPage from "@/pages/terms-conditions";
import CreatePasswordPage from "@/pages/create-password";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import ClientPortalPage from "@/pages/client-portal";
import SubscribePage from "@/pages/subscribe";
import ClaimSubscriptionPage from "@/pages/claim-subscription";
import SchedulingPage from "@/pages/scheduling";
import SchedulingAgentPage from "@/pages/scheduling-agent";
import CommunicationHistoryPage from "@/pages/communication-history";
import UnsubscribePage from "@/pages/unsubscribe";
import SettingsPage from "@/pages/settings";
import AdminTeamTrainingLeadsPage from "@/pages/admin-team-training-leads";
import AdminTeamTrainingDealsPage from "@/pages/admin-team-training-deals";
import AdminAthleteLeadsPage from "@/pages/admin-athlete-leads";
import AdminOutreachCenterPage from "@/pages/admin-outreach-center";
import BusinessCommandCenterPage from "@/pages/business-command-center";
import BusinessBrainPage from "@/pages/business-brain";
import AdminAiOperationsPage from "@/pages/admin-ai-operations";
import AdminAiGovernancePage from "@/pages/admin-ai-governance";
import AdminAiWorkforcePage from "@/pages/admin-ai-workforce";
import AdminAiWorkforceSettingsPage from "@/pages/admin-ai-workforce-settings";
import AdminAiWorkforceCapabilitiesPage from "@/pages/admin-ai-workforce-capabilities";
import AdminAiWorkforceActivityPage from "@/pages/admin-ai-workforce-activity";
import AdminAiWorkforceLeaderboardPage from "@/pages/admin-ai-workforce-leaderboard";
import AdminAiWorkforceOutcomesPage from "@/pages/admin-ai-workforce-outcomes";
import AdminAiWorkforceOptimizationPage from "@/pages/admin-ai-workforce-optimization";
import AdminAiWorkforceApprovalsPage from "@/pages/admin-ai-workforce-approvals";
import AdminAiWorkforceExecutionsPage from "@/pages/admin-ai-workforce-executions";
import AdminAiWorkforceSimulatorPage from "@/pages/admin-ai-workforce-simulator";
import AdminAgentMarketplacePage from "@/pages/admin-agent-marketplace";
import DeveloperPortalPage from "@/pages/developer-portal";
import DeveloperSandboxPage from "@/pages/developer-sandbox";
import MarketplaceStorePage from "@/pages/marketplace-store";
import AdminWorkflowBuilderPage from "@/pages/admin-workflow-builder";
import AdminWorkflowLivePage from "@/pages/admin-workflow-live";
import AdminWorkflowHeatmapPage from "@/pages/admin-workflow-heatmap";
import AdminWorkflowsLibraryPage from "@/pages/admin-workflows-library";
import OnboardingAiWorkforcePage from "@/pages/onboarding-ai-workforce";
import AdminRecommendationsPage from "@/pages/admin-recommendations";
import AdminAiEmployeeProfilePage from "@/pages/admin-ai-employee-profile";
import EmailTriggerAuditPage from "@/pages/email-trigger-audit";
import AdminGmailConversationsPage from "@/pages/admin-gmail-conversations";
import AdminAgentToolsPage from "@/pages/admin-agent-tools";
import AdminWorkflowsPage from "@/pages/admin-workflows";
import AdminAgentOpsPage from "@/pages/admin-agent-ops";
import AdminFinancialFailuresPage from "@/pages/admin-financial-failures";
import AdminFinancialReconciliationPage from "@/pages/admin-financial-reconciliation";
import AdminFinancialBrainPage from "@/pages/admin-financial-brain";
import AdminOperatorActionsPage from "@/pages/admin-operator-actions";
import AdminRetentionWorkflowsPage from "@/pages/admin-retention-workflows";
import AdminOutreachQueuePage from "@/pages/admin-outreach-queue";
import AdminWorkflowOrchestratorPage from "@/pages/admin-workflow-orchestrator";
import { CoachAgentLauncher } from "@/components/coach-agent-launcher";
import { ClientAgentLauncher } from "@/components/client-agent-launcher";
import { CommandPalette } from "@/components/command-palette";
import { Search } from "lucide-react";
import AttentionInboxPage from "@/pages/attention-inbox";
import AdminAutonomyControlsPage from "@/pages/admin-autonomy-controls";
import { AttentionBell } from "@/components/attention-bell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import logoImg from "@assets/IMG_7961_1771105509253.jpeg";
import OrgMySchedulePage from "@/pages/org-my-schedule";
import OrgPortalPage from "@/pages/org-portal";
import OrgNotificationsPage from "@/pages/org-notifications";
import OrgCalendarPage from "@/pages/org-calendar";
import CoachTimelinePage from "@/pages/coach-timeline";
import AthleteTimelinePage from "@/pages/athlete-timeline";
import OrgNutritionPage from "@/pages/org-nutrition";
import CoachNutritionPage from "@/pages/coach-nutrition";
import OrgEducationPage from "@/pages/org-education";
import CoachEducationBuilderPage from "@/pages/coach-education-builder";
import CoachEducationProgressPage from "@/pages/coach-education-progress";
import CoachEducationRulesPage from "@/pages/coach-education-rules";
import CoachEducationPlansPage from "@/pages/coach-education-plans";
import CoachAthleteStatusPage from "@/pages/coach-athlete-status";
import CoachWorkflowsPage from "@/pages/coach-workflows";
import ProgramBuilderPage from "@/pages/program-builder";
import AthleteExecutionPage from "@/pages/athlete-execution";
import ExerciseMediaManagerPage from "@/pages/exercise-media-manager";
import AthleteProfilePage from "@/pages/athlete-profile";
import OrgGuardianPage from "@/pages/org-guardian";
import CoachGuardianManagementPage from "@/pages/coach-guardian-management";
import OrgProfilePage from "@/pages/org-profile";
import CoachTeamsPage from "@/pages/coach-teams";
import CoachTeamDetailPage from "@/pages/coach-team-detail";
import CoachAthleteDetailPage from "@/pages/coach-athlete-detail";
import OrgIntelligencePage from "@/pages/org-intelligence";
import CoachCommandCenterPage from "@/pages/coach-command-center";
import CoachCommunicationsCenterPage from "@/pages/coach-communications-center";
import LeadCaptureLandingPage from "@/pages/lead-capture-landing";
import LeadCaptureProgramEditorPage from "@/pages/lead-capture-program-editor";
import AthleteSignupPage from "@/pages/athlete-signup";
import AdminLeadPipelinePage from "@/pages/admin-lead-pipeline";

interface SubscriptionStatus {
  status: string;
  isPlatformOrg: boolean;
  isActive: boolean;
}

class AppErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary] Caught render error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-md w-full space-y-4">
            <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              A page rendering error occurred. Try refreshing — if the problem persists, please report it.
            </p>
            <details className="text-xs text-muted-foreground bg-muted rounded p-3 whitespace-pre-wrap break-words">
              <summary className="cursor-pointer font-medium mb-1">Error details</summary>
              {this.state.error?.message}
              {"\n"}
              {this.state.error?.stack}
            </details>
            <button
              className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  const { data: profile } = useQuery<{ role?: string; organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });

  const hasOrg = !!profile?.organizationId;

  const { data: subscription, isLoading: subLoading } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: hasOrg,
  });

  if (location === "/admin/subscription" || location === "/admin/setup") {
    return <>{children}</>;
  }

  if (!hasOrg || subLoading) {
    return <>{children}</>;
  }

  if (subscription?.isPlatformOrg || subscription?.isActive) {
    return <>{children}</>;
  }

  const isAdmin = profile?.role === "ADMIN";

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="p-8 max-w-lg w-full text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-yellow-600 dark:text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <h2 className="text-xl font-bold" data-testid="text-subscription-required">Subscription Required</h2>
        <p className="text-muted-foreground">
          {subscription?.status === "canceled"
            ? "Your subscription has been canceled. Resubscribe to regain access to the platform."
            : subscription?.status === "past_due"
            ? "Your payment is past due. Please update your payment method to continue using the platform."
            : "Your free trial has ended. Subscribe to continue using the platform."}
        </p>
        {isAdmin ? (
          <Button
            size="lg"
            className="w-full"
            onClick={() => setLocation("/admin/subscription")}
            data-testid="button-go-to-subscription"
          >
            {subscription?.status === "canceled" ? "Resubscribe" : "Manage Subscription"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Please contact your organization admin to manage the subscription.
          </p>
        )}
      </Card>
    </div>
  );
}

// Layout with OrgSidebar — used for all /org/:slug/* inner routes
function OrgLayout({ orgSlug }: { orgSlug: string }) {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-[100dvh] w-full overflow-hidden">
        <OrgSidebar orgSlug={orgSlug} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header className="flex items-center gap-2 p-3 border-b sticky top-0 z-50 bg-background/80 backdrop-blur-md shrink-0">
            <SidebarTrigger data-testid="button-org-sidebar-toggle" />
            <div className="flex-1" />
            <ThemeToggle />
          </header>
          <main className="main-scroll flex-1 min-h-0 overflow-y-auto p-4 md:p-6 pb-safe">
            <div className="max-w-5xl mx-auto">
              <Switch>
                <Route path="/org/:slug/portal" component={OrgPortalPage} />
                <Route path="/org/:slug/notifications" component={OrgNotificationsPage} />
                <Route path="/org/:slug/profile" component={OrgProfilePage} />
                <Route path="/org/:slug/coach/teams/:teamId" component={CoachTeamDetailPage} />
                <Route path="/org/:slug/coach/teams" component={CoachTeamsPage} />
                <Route path="/org/:slug/coach/athletes/:userId/timeline" component={AthleteTimelinePage} />
                <Route path="/org/:slug/coach/athletes/:userId" component={CoachAthleteDetailPage} />
                <Route path="/org/:slug/calendar" component={OrgCalendarPage} />
                <Route path="/org/:slug/coach/timeline" component={CoachTimelinePage} />
                <Route path="/org/:slug/nutrition" component={OrgNutritionPage} />
                <Route path="/org/:slug/coach/nutrition" component={CoachNutritionPage} />
                <Route path="/org/:slug/education/:pathwaySlug" component={OrgEducationPage} />
                <Route path="/org/:slug/education" component={OrgEducationPage} />
                <Route path="/org/:slug/coach/education-builder" component={CoachEducationBuilderPage} />
                <Route path="/org/:slug/coach/education-progress" component={CoachEducationProgressPage} />
                <Route path="/org/:slug/coach/education-rules" component={CoachEducationRulesPage} />
                <Route path="/org/:slug/coach/education-plans" component={CoachEducationPlansPage} />
                <Route path="/org/:slug/coach/athlete-status" component={CoachAthleteStatusPage} />
                <Route path="/org/:slug/coach/workflows" component={CoachWorkflowsPage} />
                <Route path="/org/:slug/guardian" component={OrgGuardianPage} />
                <Route path="/org/:slug/coach/guardians" component={CoachGuardianManagementPage} />
                <Route path="/org/:slug/coach/intelligence" component={OrgIntelligencePage} />
                <Route path="/org/:slug/coach/command-center" component={CoachCommandCenterPage} />
                <Route path="/org/:slug/coach/communications-center" component={CoachCommunicationsCenterPage} />
                <Route path="/org/:slug/athlete/:userId" component={AthleteProfilePage} />
                <Route path="/org/:slug/coach/exercise-media" component={ExerciseMediaManagerPage} />
                <Route path="/org/:slug/workout/:sessionId/execute" component={AthleteExecutionPage} />
                <Route path="/org/:slug/programs/:programSlug/builder" component={ProgramBuilderPage} />
                <Route path="/org/:slug/programs/:programSlug" component={ProgramToolPage} />
                <Route path="/org/:slug/athletic/:programSlug" component={AthleticSchedulingPage} />
                <Route path="/org/:slug/athletic" component={AthleticSchedulingPage} />
                <Route path="/org/:slug/my-schedule" component={OrgMySchedulePage} />
                <Route component={NotFound} />
              </Switch>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AuthenticatedLayout() {
  const [location] = useLocation();

  if (location === "/admin/setup") {
    return <AdminSetupPage />;
  }

  // Detect org inner routes: /org/:slug/<something> (not just /org/:slug)
  const orgInnerMatch = location.match(/^\/org\/([^/]+)\//);
  const orgSlug = orgInnerMatch?.[1] ?? null;

  // Show OrgSidebar layout when inside an org section
  if (orgSlug) {
    return <OrgLayout orgSlug={orgSlug} />;
  }

  const isFullscreenPage = location === "/scheduling/agent";

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-[100dvh] w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header className="flex items-center gap-2 p-3 border-b sticky top-0 z-50 bg-background/80 backdrop-blur-md shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
              data-testid="button-search"
              aria-label="Open search"
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline text-xs">Search</span>
              <kbd className="hidden md:inline text-[10px] bg-background border border-border rounded px-1.5 py-0.5 font-mono opacity-60">⌘K</kbd>
            </button>
            <div className="flex-1" />
            <AttentionBell />
            <ThemeToggle />
          </header>
          <main className={`flex-1 min-h-0 ${isFullscreenPage ? "overflow-hidden" : "main-scroll overflow-y-auto p-4 md:p-6 pb-safe"}`}>
            <div className={isFullscreenPage ? "h-full" : "max-w-5xl mx-auto"}>
              <SubscriptionGate>
                <Switch>
                  <Route path="/" component={BookFastPage} />
                  <Route path="/coaches" component={BookFastPage} />
                  <Route path="/coaches/browse" component={CoachesPage} />
                  <Route path="/coaches/:id" component={CoachSchedulePage} />
                  <Route path="/sessions" component={OpenSessionsPage} />
                  <Route path="/org/:slug" component={OrgLandingPage} />
                  <Route path="/apply/:orgSlug/:programSlug" component={LeadCaptureLandingPage} />
                  <Route path="/athletic" component={AthleticSchedulingPage} />
                  <Route path="/bookings" component={MyBookingsPage} />
                  <Route path="/settings" component={SettingsPage} />
                  <Route path="/wallet" component={WalletPage} />
                  <Route path="/coach" component={CoachDashboardPage} />
                  <Route path="/coach/profile" component={CoachProfilePage} />
                  <Route path="/coach/availability" component={AvailabilityManagerPage} />
                  <Route path="/coach/redemptions" component={RedemptionsPage} />
                  <Route path="/coach/users" component={UserManagementPage} />
                  <Route path="/coach/transactions" component={CoachTransactionsPage} />
                  <Route path="/coach/business-plan" component={CoachBusinessPlanPage} />
                  <Route path="/coach/athletic" component={CoachAthleticPage} />
                  <Route path="/coach/team-quotes" component={TeamQuotesPage} />
                  <Route path="/coach/communications" component={CommunicationHistoryPage} />
                  <Route path="/team-training" component={TeamTrainingPage} />
                  <Route path="/portal" component={ClientPortalPage} />
                  <Route path="/efficiencystrength" component={EfficiencyStrengthPage} />
                  <Route path="/privacy" component={PrivacyPolicyPage} />
                  <Route path="/terms" component={TermsConditionsPage} />
                  <Route path="/scheduling" component={SchedulingPage} />
                  <Route path="/scheduling/agent" component={SchedulingAgentPage} />
                  <Route path="/admin" component={AdminDashboardPage} />
                  <Route path="/admin/configuration" component={AdminConfigurationPage} />
                  <Route path="/lead-capture/programs/:programId" component={LeadCaptureProgramEditorPage} />
                  <Route path="/admin/branding" component={AdminBrandingPage} />
                  <Route path="/admin/media" component={AdminMediaPage} />
                  <Route path="/admin/stripe" component={AdminStripePage} />
                  <Route path="/admin/subscription" component={AdminSubscriptionPage} />
                  <Route path="/admin/team-training-leads" component={AdminTeamTrainingLeadsPage} />
                  <Route path="/admin/team-training-deals" component={AdminTeamTrainingDealsPage} />
                  <Route path="/admin/athlete-leads" component={AdminAthleteLeadsPage} />
                  <Route path="/admin/outreach-center" component={AdminOutreachCenterPage} />
                  <Route path="/admin/lead-pipeline" component={AdminLeadPipelinePage} />
                  <Route path="/admin/business-brain" component={BusinessBrainPage} />
                  <Route path="/admin/ai-operations" component={AdminAiOperationsPage} />
                  <Route path="/command-center" component={BusinessCommandCenterPage} />
                  <Route path="/admin/trigger-audit" component={EmailTriggerAuditPage} />
                  <Route path="/admin/gmail-conversations" component={AdminGmailConversationsPage} />
                  <Route path="/admin/agent-tools" component={AdminAgentToolsPage} />
                  <Route path="/admin/workflows" component={AdminWorkflowsPage} />
                  <Route path="/admin/agent-ops" component={AdminAgentOpsPage} />
                  <Route path="/admin/financial-failures" component={AdminFinancialFailuresPage} />
                  <Route path="/admin/financial-reconciliation" component={AdminFinancialReconciliationPage} />
                  <Route path="/admin/financial-brain" component={AdminFinancialBrainPage} />
                  <Route path="/admin/operator-actions" component={AdminOperatorActionsPage} />
                  <Route path="/admin/retention-workflows" component={AdminRetentionWorkflowsPage} />
                  <Route path="/admin/outreach-queue" component={AdminOutreachQueuePage} />
                  <Route path="/admin/workflow-orchestrator" component={AdminWorkflowOrchestratorPage} />
                  <Route path="/admin/attention" component={AttentionInboxPage} />
                  <Route path="/admin/autonomy-controls" component={AdminAutonomyControlsPage} />
                  <Route path="/admin/ai-governance" component={AdminAiGovernancePage} />
                  <Route path="/admin/ai-workforce" component={AdminAiWorkforcePage} />
                  <Route path="/admin/ai-workforce/settings" component={AdminAiWorkforceSettingsPage} />
                  <Route path="/admin/ai-workforce/capabilities" component={AdminAiWorkforceCapabilitiesPage} />
                  <Route path="/admin/ai-workforce/activity" component={AdminAiWorkforceActivityPage} />
                  <Route path="/admin/ai-workforce/leaderboard" component={AdminAiWorkforceLeaderboardPage} />
                  <Route path="/admin/ai-workforce/outcomes" component={AdminAiWorkforceOutcomesPage} />
                  <Route path="/admin/ai-workforce/optimization" component={AdminAiWorkforceOptimizationPage} />
                  <Route path="/admin/ai-workforce/approvals" component={AdminAiWorkforceApprovalsPage} />
                  <Route path="/admin/ai-workforce/executions" component={AdminAiWorkforceExecutionsPage} />
                  <Route path="/admin/ai-workforce/simulator" component={AdminAiWorkforceSimulatorPage} />
                  <Route path="/admin/agent-marketplace" component={AdminAgentMarketplacePage} />
                  <Route path="/developer" component={DeveloperPortalPage} />
                  <Route path="/developer/sandbox" component={DeveloperSandboxPage} />
                  <Route path="/marketplace/store" component={MarketplaceStorePage} />
                  <Route path="/admin/ai-employee/:agentId" component={AdminAiEmployeeProfilePage} />
                  <Route path="/admin/recommendations" component={AdminRecommendationsPage} />
                  <Route path="/admin/workflow-builder" component={AdminWorkflowBuilderPage} />
                  <Route path="/admin/workflows/:id/live" component={AdminWorkflowLivePage} />
                  <Route path="/admin/workflow-heatmap" component={AdminWorkflowHeatmapPage} />
                  <Route path="/admin/workflows-library" component={AdminWorkflowsLibraryPage} />
                  <Route path="/onboarding/ai-workforce" component={OnboardingAiWorkforcePage} />
                  <Route path="/subscribe/:planId" component={SubscribePage} />
                  <Route path="/claim-subscription" component={ClaimSubscriptionPage} />
                  <Route path="/create-password" component={CreatePasswordPage} />
                  <Route path="/unsubscribe/:token" component={UnsubscribePage} />
                  <Route component={NotFound} />
                </Switch>
              </SubscriptionGate>
            </div>
          </main>
        </div>
      </div>
      <CoachAgentLauncher />
      <ClientAgentLauncher />
      <CommandPalette />
    </SidebarProvider>
  );
}


function PublicLayout() {
  const [location] = useLocation();

  // Org inner routes get the OrgSidebar layout even for unauthenticated users
  // (the sidebar itself handles showing a login prompt when not authenticated)
  const orgInnerMatch = location.match(/^\/org\/([^/]+)\//);
  const orgSlug = orgInnerMatch?.[1] ?? null;
  if (orgSlug) {
    return <OrgLayout orgSlug={orgSlug} />;
  }

  return (
    <Switch>
      <Route path="/portal" component={ClientPortalPage} />
      <Route path="/sessions" component={OpenSessionsPublicPage} />
      <Route path="/org/:slug" component={OrgLandingPage} />
      <Route path="/apply/:orgSlug/:programSlug" component={LeadCaptureLandingPage} />
      <Route path="/athletic" component={AthleticSchedulingPage} />
      <Route path="/efficiencystrength" component={EfficiencyStrengthPage} />
      <Route path="/subscribe/:planId" component={SubscribePage} />
      <Route path="/claim-subscription" component={ClaimSubscriptionPage} />
      <Route path="/signup" component={AthleteSignupPage} />
      <Route path="/create-password" component={CreatePasswordPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/privacy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsConditionsPage} />
      <Route path="/unsubscribe/:token" component={UnsubscribePage} />
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
          <AppErrorBoundary>
            <AppContent />
          </AppErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
