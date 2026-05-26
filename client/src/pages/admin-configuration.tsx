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
  AlertTriangle,
  Building2,
  Users,
  CalendarCheck,
  Wrench,
  BarChart2,
  Hammer,
  Link2,
  Link2Off,
  ShieldCheck,
  Wifi,
  WifiOff,
  Eye,
  EyeOff,
  Zap,
  TrendingUp,
  ExternalLink,
  Award,
  Brain,
  CircleDot,
  Cpu,
  Globe,
  Server,
  Activity,
  MessageSquare,
  RefreshCw,
  Key,
  Unplug,
  Plug,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Code2,
  Webhook,
  Copy,
  BookOpen,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import type { Service, Organization, OrganizationSubscriptionPlan } from "@shared/schema";
import { MapPin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { clearAuthToken } from "@/lib/authToken";

type FunnelData = {
  pageViews: number;
  step1Starts: number;
  partialCaptures: number;
  completedApplications: number;
  abandonmentRate: number;
  completionRate: number;
  highIntentRate: number;
  movedToDealRate: number;
  utmBreakdown: { source: string; views: number }[];
  funnel: { label: string; value: number; key: string }[];
};

function LeadCaptureStats({ programId, orgSlug, programSlug }: { programId: string; orgSlug?: string; programSlug: string }) {
  const [showFunnel, setShowFunnel] = useState(false);

  const { data: stats } = useQuery<{ total: number; highIntent: number; conversionRate: number; lastSubmission: string | null }>({
    queryKey: [`/api/lead-capture/programs/${programId}/stats`],
    enabled: !!programId,
    refetchInterval: 30000,
  });

  const { data: funnel } = useQuery<FunnelData>({
    queryKey: [`/api/lead-capture/programs/${programId}/funnel`],
    enabled: showFunnel,
  });

  const publicUrl = `/apply/${orgSlug}/${programSlug}`;

  const funnelSteps = funnel?.funnel ?? [];
  const funnelMax = funnelSteps.length > 0 ? Math.max(...funnelSteps.map((s) => s.value), 1) : 1;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-muted/50 rounded-lg px-3 py-2 text-center" data-testid={`stat-total-submissions-${programId}`}>
          <p className="text-lg font-bold">{stats?.total ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Total Leads</p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-950/20 rounded-lg px-3 py-2 text-center" data-testid={`stat-high-intent-${programId}`}>
          <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{stats?.highIntent ?? "—"}</p>
          <p className="text-xs text-muted-foreground">High Intent</p>
        </div>
        <div className="bg-muted/50 rounded-lg px-3 py-2 text-center" data-testid={`stat-conversion-${programId}`}>
          <p className="text-lg font-bold">{stats !== undefined ? `${stats.conversionRate}%` : "—"}</p>
          <p className="text-xs text-muted-foreground">Conversion</p>
        </div>
        <div className="bg-muted/50 rounded-lg px-3 py-2 text-center" data-testid={`stat-last-submission-${programId}`}>
          <p className="text-xs font-medium">{stats?.lastSubmission ? new Date(stats.lastSubmission).toLocaleDateString() : "None yet"}</p>
          <p className="text-xs text-muted-foreground">Last Lead</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <TrendingUp className="h-3 w-3 text-orange-400" />
        <span>Public URL:</span>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-500 hover:text-orange-600 font-mono underline underline-offset-2"
          data-testid={`link-public-url-${programId}`}
        >
          {publicUrl}
        </a>
        <button
          onClick={() => setShowFunnel((v) => !v)}
          className="ml-auto text-orange-500 hover:text-orange-600 flex items-center gap-1 font-medium"
          data-testid={`button-toggle-funnel-${programId}`}
        >
          <BarChart2 className="h-3 w-3" />
          {showFunnel ? "Hide" : "Funnel"}
        </button>
      </div>

      {showFunnel && funnel && (
        <div className="border border-orange-500/20 rounded-xl p-4 space-y-4 bg-orange-500/3">
          <p className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
            <BarChart2 className="h-3.5 w-3.5" /> Conversion Funnel
          </p>

          {/* Funnel bars */}
          <div className="space-y-2.5">
            {funnelSteps.map((step, i) => (
              <div key={step.key} data-testid={`funnel-step-${step.key}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">{step.label}</span>
                  <span className="text-xs font-semibold">{(step.value ?? 0).toLocaleString()}</span>
                </div>
                <div className="h-5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      i === 0 ? "bg-blue-500" :
                      i === 1 ? "bg-violet-500" :
                      i === 2 ? "bg-orange-500" :
                      i === 3 ? "bg-green-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${((step.value ?? 0) / funnelMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="text-center">
              <p className="text-base font-bold text-orange-500">{funnel.completionRate}%</p>
              <p className="text-xs text-muted-foreground">Completion Rate</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-red-500">{funnel.abandonmentRate}%</p>
              <p className="text-xs text-muted-foreground">Abandonment</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-green-500">{funnel.highIntentRate}%</p>
              <p className="text-xs text-muted-foreground">High-Intent Rate</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-violet-500">{(funnel.pageViews ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Page Views</p>
            </div>
          </div>

          {/* UTM source breakdown */}
          {funnel.utmBreakdown.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Traffic sources</p>
              <div className="space-y-1">
                {funnel.utmBreakdown.slice(0, 5).map((u, i) => (
                  <div key={u.source} className="flex items-center gap-2 text-xs" data-testid={`utm-source-${i}`}>
                    <span className="w-20 truncate text-muted-foreground capitalize">{u.source}</span>
                    <div className="flex-1 h-3 bg-muted/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500/70 rounded-full"
                        style={{ width: `${(u.views / (funnel.utmBreakdown[0]?.views || 1)) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right font-medium">{u.views}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

type SystemIntegration = {
  id: string;
  title: string;
  description: string;
  category: string;
  provider: string;
  status: "operational" | "inactive" | "degraded" | "maintenance";
  managed: boolean;
};

const INTEGRATION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  trainchat: Brain,
  openai: Cpu,
  sendgrid: Mail,
  twilio: MessageSquare,
  stripe: CreditCard,
  google_calendar: CalendarCheck,
  automation: Zap,
  research: Globe,
  meta_capi: TrendingUp,
  slack: Activity,
};

const CATEGORY_ORDER = ["ai", "communication", "platform", "payments", "calendar", "marketing"];
const CATEGORY_LABELS: Record<string, string> = {
  ai: "AI Systems",
  communication: "Communication",
  platform: "Platform",
  payments: "Payments",
  calendar: "Calendar",
  marketing: "Marketing",
};

function StatusDot({ status }: { status: SystemIntegration["status"] }) {
  if (status === "operational") {
    return (
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
    );
  }
  if (status === "degraded") {
    return <span className="inline-flex rounded-full h-2 w-2 bg-amber-500 flex-shrink-0" />;
  }
  if (status === "maintenance") {
    return <span className="inline-flex rounded-full h-2 w-2 bg-blue-500 flex-shrink-0" />;
  }
  return <span className="inline-flex rounded-full h-2 w-2 bg-muted-foreground/30 flex-shrink-0" />;
}

function StatusBadge({ status }: { status: SystemIntegration["status"] }) {
  if (status === "operational") {
    return (
      <Badge className="text-[10px] h-5 px-1.5 gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
        Operational
      </Badge>
    );
  }
  if (status === "degraded") {
    return (
      <Badge className="text-[10px] h-5 px-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
        Degraded
      </Badge>
    );
  }
  if (status === "maintenance") {
    return (
      <Badge className="text-[10px] h-5 px-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
        Maintenance
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground/60">
      Inactive
    </Badge>
  );
}

function IntegrationCard({ integration }: { integration: SystemIntegration }) {
  const Icon = INTEGRATION_ICONS[integration.id] ?? Server;
  const isOperational = integration.status === "operational";

  return (
    <div
      className={`relative flex flex-col gap-3 rounded-xl border p-4 transition-all ${
        isOperational
          ? "border-border/60 bg-card hover:border-border"
          : "border-border/30 bg-muted/20 opacity-70"
      }`}
      data-testid={`card-integration-${integration.id}`}
    >
      {/* Subtle glow for operational cards */}
      {isOperational && (
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-primary/5" />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            isOperational ? "bg-primary/10" : "bg-muted/50"
          }`}>
            <Icon className={`h-4 w-4 ${isOperational ? "text-primary" : "text-muted-foreground/50"}`} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{integration.title}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{integration.provider}</p>
          </div>
        </div>
        <StatusBadge status={integration.status} />
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{integration.description}</p>

      <div className="flex items-center gap-1.5 pt-0.5">
        <StatusDot status={integration.status} />
        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide font-medium">
          Managed by TrainEfficiency
        </span>
      </div>
    </div>
  );
}

function IntegrationsSection() {
  const { data, isLoading, refetch, isFetching } = useQuery<{
    integrations: SystemIntegration[];
    checkedAt: string;
  }>({
    queryKey: ["/api/admin/system-integrations"],
    refetchInterval: 60000,
  });

  const integrations = data?.integrations ?? [];
  const checkedAt = data?.checkedAt ? new Date(data.checkedAt) : null;

  const grouped = CATEGORY_ORDER.reduce<Record<string, SystemIntegration[]>>((acc, cat) => {
    const items = integrations.filter((i) => i.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  const operationalCount = integrations.filter((i) => i.status === "operational").length;

  return (
    <section data-testid="section-integrations">
      {/* Section header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            Platform Infrastructure
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Platform-managed services powering TrainEfficiency globally
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && (
            <span className="text-[10px] text-muted-foreground/60 hidden sm:block">
              {operationalCount}/{integrations.length} operational
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 w-7 rounded-lg border border-border/60 flex items-center justify-center hover:bg-muted/50 transition-colors disabled:opacity-50"
            data-testid="button-refresh-integrations"
            title="Refresh status"
          >
            <RefreshCw className={`h-3 w-3 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl border border-border/30 bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((integration) => (
                  <IntegrationCard key={integration.id} integration={integration} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {checkedAt && !isLoading && (
        <p className="text-[10px] text-muted-foreground/40 mt-4 flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Status verified {checkedAt.toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}

// ─── Org Integration Registry ────────────────────────────────────────────────

type OrgIntegrationCredentialField = {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "url";
  helpText?: string;
};

type OrgIntegrationDef = {
  id: string;
  title: string;
  description: string;
  authType: "oauth" | "api_key" | "webhook";
  provider: string;
  icon: React.ComponentType<{ className?: string }>;
  credentialFields: OrgIntegrationCredentialField[];
  oauthNote?: string;
};

const ORG_INTEGRATION_REGISTRY: OrgIntegrationDef[] = [
  {
    id: "gmail",
    title: "Gmail Workspace",
    description: "Connect a Gmail Workspace account for inbox sync, reply detection, message threading, send-as-user workflows, and AI-assisted communication.",
    authType: "oauth",
    provider: "Google Workspace",
    icon: Mail,
    credentialFields: [
      { key: "clientId", label: "Google Client ID", placeholder: "1234567890-abcxyz.apps.googleusercontent.com", type: "text", helpText: "Example: 1234567890-abcxyz.apps.googleusercontent.com" },
      { key: "clientSecret", label: "Google Client Secret", placeholder: "GOCSPX-xxxxxxxxxxxxxxxx", type: "password", helpText: "Example: GOCSPX-xxxxxxxxxxxxxxxx" },
      { key: "accountEmail", label: "Connected Gmail Account", placeholder: "you@yourworkspace.com", type: "text", helpText: "The Gmail address this OAuth app will authorize and send as" },
    ],
    oauthNote: undefined,
  },
  {
    id: "google_calendar",
    title: "Google Calendar",
    description: "Sync coach availability in real time, automatically create booking events, and push cancellations back to Google Calendar.",
    authType: "oauth",
    provider: "Google Workspace",
    icon: CalendarCheck,
    credentialFields: [
      { key: "clientId", label: "OAuth Client ID", placeholder: "your-client-id.apps.googleusercontent.com", type: "text" },
      { key: "clientSecret", label: "OAuth Client Secret", placeholder: "GOCSPX-...", type: "password" },
      { key: "calendarId", label: "Calendar ID", placeholder: "primary or calendar-id@group.calendar.google.com", type: "text", helpText: "Use 'primary' for the main calendar" },
    ],
    oauthNote: "Enter your Google Cloud OAuth 2.0 credentials with Calendar API access enabled.",
  },
  {
    id: "meta_ads",
    title: "Meta Ads",
    description: "Send conversion events directly to Meta via the Conversions API (CAPI) for accurate ad attribution and campaign optimization.",
    authType: "api_key",
    provider: "Meta (Facebook)",
    icon: TrendingUp,
    credentialFields: [
      { key: "accessToken", label: "CAPI Access Token", placeholder: "EAAxxxxx...", type: "password", helpText: "Found in Events Manager → Data Sources → your Pixel → Settings" },
      { key: "pixelId", label: "Pixel ID", placeholder: "123456789012345", type: "text" },
    ],
  },
  {
    id: "slack",
    title: "Slack",
    description: "Receive operational alerts, AI action summaries, and governance escalations directly in your Slack workspace channels.",
    authType: "webhook",
    provider: "Slack",
    icon: Activity,
    credentialFields: [
      { key: "webhookUrl", label: "Incoming Webhook URL", placeholder: "https://hooks.slack.com/services/...", type: "url" },
      { key: "channel", label: "Default Channel", placeholder: "#ops-alerts", type: "text", helpText: "Channel must match the webhook's configured channel" },
    ],
  },
  {
    id: "developer_api",
    title: "Developer API & Webhooks",
    description: "Configure outbound webhooks and API access for custom integrations, third-party tools, and developer workflows.",
    authType: "api_key",
    provider: "TrainEfficiency API",
    icon: Code2,
    credentialFields: [
      { key: "webhookUrl", label: "Outbound Webhook URL", placeholder: "https://your-server.com/webhook", type: "url", helpText: "We will POST events to this endpoint" },
      { key: "webhookSecret", label: "Webhook Signing Secret", placeholder: "whsec_...", type: "password", helpText: "Used to verify webhook authenticity" },
    ],
  },
];

type OrgIntegrationRecord = {
  id: string;
  integrationType: string;
  status: string;
  displayName: string | null;
  authType: string;
  lastSuccessfulActionAt: string | null;
  lastHealthCheckAt: string | null;
  credentialHints: Record<string, string> | null;
};

function OrgIntegrationConnectModal({
  def,
  record,
  open,
  onOpenChange,
  onSuccess,
}: {
  def: OrgIntegrationDef;
  record?: OrgIntegrationRecord;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const isReauth = record?.status === "connected";
  const [fields, setFields] = useState<Record<string, string>>({});
  // Gmail OAuth: after credentials are saved, show "Authorize with Google" button
  const [gmailCredentialsSaved, setGmailCredentialsSaved] = useState(false);
  const isGmailOAuth = def.id === "gmail" && def.authType === "oauth";

  const saveMutation = useMutation({
    mutationFn: async () => {
      const displayName = fields.accountEmail || fields.calendarId || fields.channel || fields.webhookUrl || def.title;
      await apiRequest("PUT", `/api/integrations/${def.id}`, {
        status: isGmailOAuth ? "disconnected" : "connected",
        displayName,
        authType: def.authType,
      });
      // apiRequest returns Response — must call .json() to get the body
      const credRes = await apiRequest("POST", `/api/integrations/${def.id}/credentials`, {
        credentials: fields,
      });
      return credRes.json() as Promise<{ ok: boolean; integrationId?: string; requiresOAuth?: boolean }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      if (result?.requiresOAuth) {
        setGmailCredentialsSaved(true);
        toast({ title: "Credentials saved", description: "Now authorize access with Google to complete the connection." });
      } else {
        toast({ title: `${def.title} connected`, description: "Integration is now active." });
        onOpenChange(false);
        setFields({});
        onSuccess();
      }
    },
    onError: (e: any) => {
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    },
  });

  function handleClose() {
    setGmailCredentialsSaved(false);
    setFields({});
    setClientIdError(null);
    setClientSecretWarning(null);
    setSetupGuideOpen(false);
    setDebugInfo(null);
    onOpenChange(false);
  }

  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [uriCopied, setUriCopied] = useState(false);
  const [clientIdError, setClientIdError] = useState<string | null>(null);
  const [clientSecretWarning, setClientSecretWarning] = useState<string | null>(null);
  const [oauthStarting, setOauthStarting] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    clientIdPreview: string; redirectUri: string; scopes: string[];
    rowCount: number; rowIds: string[]; status: string;
    hasCredentials: boolean; clientIdLength: number | null;
    clientIdEndsCorrectly: boolean | null; hasClientSecret: boolean;
    updatedAt: string | null;
  } | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const REDIRECT_URI = "https://trainefficiency.com/api/integrations/gmail/callback";

  function copyRedirectUri() {
    navigator.clipboard.writeText(REDIRECT_URI).then(() => {
      setUriCopied(true);
      setTimeout(() => setUriCopied(false), 2000);
    });
  }

  function validateGmailAndSave() {
    if (!isGmailOAuth) { saveMutation.mutate(); return; }
    const cid = fields.clientId?.trim() ?? "";
    const csec = fields.clientSecret?.trim() ?? "";
    let error: string | null = null;
    if (cid.startsWith("AIza")) {
      error = "This looks like an API key, not an OAuth Client ID. Create a Web Application OAuth 2.0 client in Google Cloud Console.";
    } else if (!cid.endsWith(".apps.googleusercontent.com")) {
      error = "Client ID must end with .apps.googleusercontent.com";
    }
    setClientIdError(error);
    setClientSecretWarning(csec && !csec.startsWith("GOCSPX-") ? "Client Secret usually starts with GOCSPX-. Verify you copied it correctly from the Google Cloud Console." : null);
    if (!error) saveMutation.mutate();
  }

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/gmail/reset-credentials");
      return res.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      setGmailCredentialsSaved(false);
      setFields({});
      setClientIdError(null);
      setClientSecretWarning(null);
      setDebugInfo(null);
      toast({ title: "Gmail credentials cleared", description: "Paste fresh OAuth credentials and save again." });
    },
    onError: (e: any) => {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    },
  });

  async function fetchDebugPreview() {
    setDebugLoading(true);
    try {
      const res = await apiRequest("GET", "/api/integrations/gmail/oauth/debug");
      const data = await res.json() as any;
      setDebugInfo({
        clientIdPreview: data.clientIdPreview ?? "(none — no credentials saved)",
        redirectUri: data.redirectUri ?? "(not returned)",
        scopes: data.scopes ?? [],
        rowCount: data.rowCount ?? 0,
        rowIds: data.rowIds ?? [],
        status: data.status ?? "unknown",
        hasCredentials: data.hasCredentials ?? false,
        clientIdLength: data.clientIdLength ?? null,
        clientIdEndsCorrectly: data.clientIdEndsWithAppsGoogleusercontent ?? null,
        hasClientSecret: data.hasClientSecret ?? false,
        updatedAt: data.updatedAt ?? null,
      });
    } catch (e: any) {
      toast({ title: "Debug check failed", description: e.message, variant: "destructive" });
    } finally {
      setDebugLoading(false);
    }
  }

  async function startGmailOAuth() {
    setOauthStarting(true);
    try {
      // Pass the current page path+search as returnTo so the callback redirects
      // back here (e.g. /admin/configuration?tab=advanced) instead of a hardcoded URL.
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      const res = await apiRequest("GET", `/api/integrations/gmail/oauth/start-url?returnTo=${returnTo}`);

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new Error("Server returned a non-JSON response for OAuth URL");
      }

      const { url, clientIdPreview: cidPreview, redirectUri: dbgRedirectUri } = data as any;
      console.log(`[gmail/oauth] start-url check — clientIdPreview=${cidPreview} redirectUri=${dbgRedirectUri} returnTo=${decodeURIComponent(returnTo)}`);

      if (!url || typeof url !== "string") {
        throw new Error(`OAuth URL missing from response. Got: ${JSON.stringify(data)}`);
      }
      if (!url.startsWith("https://accounts.google.com")) {
        throw new Error(`Unexpected OAuth URL (not Google): ${url.slice(0, 100)}`);
      }

      console.log("[gmail/oauth] redirecting to Google:", url.slice(0, 100) + "…");
      window.location.href = url;
    } catch (e: any) {
      console.error("[gmail/oauth] startGmailOAuth error:", e);
      toast({ title: "Could not start OAuth", description: e.message, variant: "destructive" });
      setOauthStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <def.icon className="h-4 w-4" />
            {isReauth ? "Reauthorize" : "Connect"} {def.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Gmail OAuth — step 2: redirect to Google */}
          {isGmailOAuth && gmailCredentialsSaved ? (
            <>
              <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3">
                <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed">
                  Credentials saved. Click <strong>Authorize with Google</strong> to open Google's consent screen. If you pasted the wrong credentials, use <strong>Reset &amp; re-enter</strong> below.
                </p>
              </div>

              {/* Dev-only: credential debug panel */}
              {import.meta.env.DEV && (
                <div className="rounded border border-dashed border-border p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Dev — credential check</span>
                    <button
                      type="button"
                      onClick={fetchDebugPreview}
                      disabled={debugLoading}
                      className="text-[10px] underline text-muted-foreground hover:text-foreground disabled:opacity-50"
                      data-testid="button-gmail-debug-check"
                    >
                      {debugLoading ? "Checking…" : "Check saved credentials"}
                    </button>
                  </div>
                  {debugInfo && (
                    <div className="font-mono text-[10px] space-y-1 text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground">Client ID:</span>
                        <span className={debugInfo.clientIdEndsCorrectly === false ? "text-destructive" : "text-yellow-600 dark:text-yellow-400"}>
                          {debugInfo.clientIdPreview}
                        </span>
                        {debugInfo.clientIdPreview && !debugInfo.clientIdPreview.startsWith("(") && (
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(debugInfo.clientIdPreview)}
                            className="underline text-muted-foreground hover:text-foreground"
                            title="Copy preview to clipboard"
                          >copy</button>
                        )}
                      </div>
                      <div><span className="text-foreground">ID length:</span> {debugInfo.clientIdLength ?? "—"} chars</div>
                      <div><span className="text-foreground">Ends with …usercontent.com:</span>{" "}
                        <span className={debugInfo.clientIdEndsCorrectly === false ? "text-destructive" : "text-green-600"}>
                          {debugInfo.clientIdEndsCorrectly === null ? "—" : debugInfo.clientIdEndsCorrectly ? "yes ✓" : "NO ✗"}
                        </span>
                      </div>
                      <div><span className="text-foreground">Has client secret:</span> {debugInfo.hasClientSecret ? "yes" : "NO"}</div>
                      <div><span className="text-foreground">DB rows for this org:</span>{" "}
                        <span className={debugInfo.rowCount > 1 ? "text-destructive" : ""}>{debugInfo.rowCount}</span>
                        {debugInfo.rowCount > 1 && " ← DUPLICATE ROWS (reset will fix)"}
                      </div>
                      <div><span className="text-foreground">Status:</span> {debugInfo.status}</div>
                      <div><span className="text-foreground">Last saved:</span> {debugInfo.updatedAt ? new Date(debugInfo.updatedAt).toLocaleString() : "—"}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Reset credentials link */}
              <button
                type="button"
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                className="text-xs text-muted-foreground underline hover:text-destructive transition-colors disabled:opacity-50 w-full text-left"
                data-testid="button-gmail-reset-credentials"
              >
                {resetMutation.isPending ? "Resetting…" : "Reset & re-enter credentials"}
              </button>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleClose} data-testid="button-org-integration-gmail-cancel">
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={startGmailOAuth}
                  disabled={oauthStarting}
                  data-testid="button-org-integration-gmail-authorize"
                >
                  {oauthStarting ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Opening Google…</>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Authorize with Google
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Gmail-only: API key warning + setup guide */}
              {isGmailOAuth && (
                <>
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                    <div className="flex gap-2 items-start">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                        Do not use a Google API key. Gmail inbox/send access requires OAuth 2.0.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium hover:bg-muted/50 transition-colors"
                      onClick={() => setSetupGuideOpen((v) => !v)}
                      data-testid="button-gmail-setup-guide-toggle"
                    >
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        Google OAuth Setup Instructions
                      </span>
                      {setupGuideOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>

                    {setupGuideOpen && (
                      <div className="border-t border-border px-3 py-3">
                        <ol className="space-y-2.5">
                          {[
                            <>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">Google Cloud Console</a></>,
                            <>Enable the <strong>Gmail API</strong></>,
                            <>Go to APIs &amp; Services → Credentials → <strong>Create OAuth Client ID</strong></>,
                            <>Select Application Type: <strong>Web application</strong></>,
                            <>
                              Add this <strong>Authorized Redirect URI</strong>:
                              <div className="mt-1.5 flex items-center gap-1.5 rounded bg-muted px-2 py-1.5">
                                <code className="flex-1 text-[11px] font-mono break-all select-all">{REDIRECT_URI}</code>
                                <button
                                  type="button"
                                  onClick={copyRedirectUri}
                                  className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/20 transition-colors"
                                  title="Copy redirect URI"
                                  data-testid="button-gmail-copy-redirect-uri"
                                >
                                  {uriCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                                </button>
                              </div>
                            </>,
                            <>Copy the <strong>Client ID</strong></>,
                            <>Copy the <strong>Client Secret</strong></>,
                            <>Paste both into the fields below</>,
                            <>Click <strong>Save &amp; Continue</strong></>,
                            <>Click <strong>Authorize with Google</strong></>,
                          ].map((step, i) => (
                            <li key={i} className="flex gap-2.5 text-xs text-muted-foreground">
                              <span className="shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                              <span className="leading-relaxed">{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Non-Gmail oauthNote */}
              {!isGmailOAuth && def.oauthNote && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                  <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">{def.oauthNote}</p>
                </div>
              )}

              {def.credentialFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label className="text-xs font-medium">{field.label}</Label>
                  <Input
                    type={field.type ?? "text"}
                    placeholder={field.placeholder}
                    value={fields[field.key] ?? ""}
                    onChange={(e) => {
                      setFields((prev) => ({ ...prev, [field.key]: e.target.value }));
                      if (field.key === "clientId") setClientIdError(null);
                      if (field.key === "clientSecret") setClientSecretWarning(null);
                    }}
                    data-testid={`input-org-integration-${def.id}-${field.key}`}
                  />
                  {field.key === "clientId" && clientIdError ? (
                    <p className="text-[11px] text-red-600 dark:text-red-400">{clientIdError}</p>
                  ) : field.key === "clientSecret" && clientSecretWarning ? (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">{clientSecretWarning}</p>
                  ) : field.helpText ? (
                    <p className="text-[11px] text-muted-foreground">{field.helpText}</p>
                  ) : null}
                </div>
              ))}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleClose}
                  data-testid={`button-org-integration-${def.id}-cancel`}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={validateGmailAndSave}
                  disabled={saveMutation.isPending || def.credentialFields.some((f) => !fields[f.key]?.trim())}
                  data-testid={`button-org-integration-${def.id}-save`}
                >
                  {saveMutation.isPending ? (
                    <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />{isGmailOAuth ? "Saving..." : isReauth ? "Saving..." : "Connecting..."}</>
                  ) : (
                    <><Plug className="h-3 w-3 mr-1.5" />{isGmailOAuth ? "Save & Continue" : isReauth ? "Save Credentials" : "Connect"}</>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrgIntegrationCard({
  def,
  record,
  isAdmin,
  onRefresh,
}: {
  def: OrgIntegrationDef;
  record?: OrgIntegrationRecord;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [connectOpen, setConnectOpen] = useState(false);
  const isConnected = record?.status === "connected";
  const hints = record?.credentialHints ?? null;

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/integrations/${def.id}`),
    onSuccess: () => {
      toast({ title: `${def.title} disconnected` });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      onRefresh();
    },
    onError: (e: any) => {
      toast({ title: "Disconnect failed", description: e.message, variant: "destructive" });
    },
  });

  const authTypeLabel: Record<string, string> = {
    oauth: "OAuth 2.0",
    api_key: "API Key",
    webhook: "Webhook",
  };

  return (
    <>
      <div
        className={`relative flex flex-col gap-3 rounded-xl border p-4 transition-all ${
          isConnected
            ? "border-border/50 bg-card/60"
            : "border-border/20 bg-muted/10"
        }`}
        data-testid={`card-org-integration-${def.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isConnected ? "bg-muted/60" : "bg-muted/30"
            }`}>
              <def.icon className={`h-4 w-4 ${isConnected ? "text-foreground/70" : "text-muted-foreground/40"}`} />
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">{def.title}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{def.provider}</p>
            </div>
          </div>
          {isConnected ? (
            <Badge className="text-[10px] h-5 px-1.5 gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 flex-shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground/50 flex-shrink-0">
              Not connected
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground/80 leading-relaxed">{def.description}</p>

        {isConnected && record?.displayName && (
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/30 px-2.5 py-1.5">
            <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate" data-testid={`text-org-integration-${def.id}-account`}>
              {record.displayName}
            </span>
          </div>
        )}

        {/* Masked credential hints — only shown to admins, never raw values */}
        {isAdmin && isConnected && hints && Object.keys(hints).length > 0 && (
          <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2 space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 font-semibold flex items-center gap-1">
              <Key className="h-2.5 w-2.5" />
              Stored credentials
            </p>
            {def.credentialFields.map((field) => {
              const masked = hints[field.key];
              if (!masked) return null;
              return (
                <div key={field.key} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground/60 truncate">{field.label}</span>
                  <code
                    className="text-[11px] font-mono text-muted-foreground/70 tracking-wide"
                    data-testid={`text-credential-hint-${def.id}-${field.key}`}
                  >
                    {masked}
                  </code>
                </div>
              );
            })}
          </div>
        )}

        {isConnected && record?.lastSuccessfulActionAt && (
          <p className="text-[10px] text-muted-foreground/50">
            Last sync: {new Date(record.lastSuccessfulActionAt).toLocaleString()}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wide font-medium">
            {authTypeLabel[def.authType] ?? def.authType} · Managed by Organization
          </span>
          <div className="flex items-center gap-1.5">
            {!isAdmin ? (
              /* Non-admins see a read-only label instead of action buttons */
              <span className="text-[10px] text-muted-foreground/40 italic" data-testid={`text-org-integration-${def.id}-admin-only`}>
                Admin access required
              </span>
            ) : isConnected ? (
              <>
                <button
                  onClick={() => setConnectOpen(true)}
                  className="h-6 px-2 rounded-md border border-border/40 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-1"
                  data-testid={`button-org-integration-${def.id}-reauth`}
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  Reauthorize
                </button>
                <button
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="h-6 px-2 rounded-md border border-destructive/30 text-[10px] text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-colors flex items-center gap-1 disabled:opacity-50"
                  data-testid={`button-org-integration-${def.id}-disconnect`}
                >
                  {disconnectMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Unplug className="h-2.5 w-2.5" />}
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={() => setConnectOpen(true)}
                className="h-6 px-2.5 rounded-md bg-primary/90 text-[10px] text-primary-foreground hover:bg-primary transition-colors flex items-center gap-1 font-medium"
                data-testid={`button-org-integration-${def.id}-connect`}
              >
                <Plug className="h-2.5 w-2.5" />
                Connect
              </button>
            )}
          </div>
        </div>
      </div>

      {isAdmin && (
        <OrgIntegrationConnectModal
          def={def}
          record={record}
          open={connectOpen}
          onOpenChange={setConnectOpen}
          onSuccess={onRefresh}
        />
      )}
    </>
  );
}

function OrgIntegrationsSection() {
  const { toast } = useToast();
  // Phase-1 state: store the OAuth result from URL while waiting for data to load
  const [pendingOAuthResult, setPendingOAuthResult] = useState<{ provider: string; status: string } | null>(null);

  const { data: profile } = useQuery<{ role?: string; organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const isAdmin = profile?.role === "ADMIN";

  const { data: records, isLoading, refetch } = useQuery<OrgIntegrationRecord[]>({
    queryKey: ["/api/integrations"],
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  // Phase 1: detect ?gmail=connected in URL, invalidate cache immediately, store result for Phase 2
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (!gmailStatus) return;
    // Clean param so it doesn't re-fire on refresh
    const clean = new URL(window.location.href);
    clean.searchParams.delete("gmail");
    window.history.replaceState({}, "", clean.toString());

    if (gmailStatus === "denied") {
      toast({ title: "Gmail authorization denied", description: "You declined the Google permission request.", variant: "destructive" });
      return;
    }
    if (gmailStatus === "error") {
      toast({ title: "Gmail authorization failed", description: "Something went wrong during Gmail OAuth. Please try again.", variant: "destructive" });
      return;
    }
    if (gmailStatus === "invalid_client") {
      toast({
        title: "Google could not find this OAuth client",
        description: "Recheck your Client ID, Client Secret, and make sure you created a Web Application OAuth client — not an API key.",
        variant: "destructive",
      });
      return;
    }
    // For "connected": invalidate cache and wait for data — Phase 2 will show toast
    queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
    setPendingOAuthResult({ provider: "gmail", status: gmailStatus });
  }, []);

  // Phase 2: once data actually loads, confirm backend state and show toast
  useEffect(() => {
    if (!pendingOAuthResult || !records) return;
    const { provider, status } = pendingOAuthResult;
    if (status !== "connected") return;
    setPendingOAuthResult(null);

    const record = records.find((r) => r.integrationType === provider);
    console.log(`[${provider}] OAuth callback — backend record:`, JSON.stringify(record, null, 2));

    if (record?.status === "connected") {
      toast({ title: `${provider === "gmail" ? "Gmail Workspace" : provider} connected`, description: "Your account has been authorized and is now active." });
    } else {
      toast({
        title: "Connection not confirmed",
        description: `OAuth completed but the backend status is "${record?.status ?? "unknown"}". Check server logs.`,
        variant: "destructive",
      });
    }
  }, [pendingOAuthResult, records]);

  const recordsByType = (records ?? []).reduce<Record<string, OrgIntegrationRecord>>((acc, r) => {
    acc[r.integrationType] = r;
    return acc;
  }, {});

  const connectedCount = ORG_INTEGRATION_REGISTRY.filter((def) => recordsByType[def.id]?.status === "connected").length;

  return (
    <section data-testid="section-org-integrations">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-medium flex items-center gap-2">
            <Plug className="h-4 w-4 text-muted-foreground/70" />
            Organization Integrations
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Connect your organization's own accounts and services
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && !isLoading && (
            <span className="text-[10px] text-muted-foreground/50 hidden sm:block">
              {connectedCount}/{ORG_INTEGRATION_REGISTRY.length} connected
            </span>
          )}
          {isAdmin && (
            <button
              onClick={() => refetch()}
              className="h-7 w-7 rounded-lg border border-border/40 flex items-center justify-center hover:bg-muted/50 transition-colors"
              data-testid="button-refresh-org-integrations"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3 text-muted-foreground/60" />
            </button>
          )}
        </div>
      </div>

      {isLoading && isAdmin ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 rounded-xl border border-border/20 bg-muted/10 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ORG_INTEGRATION_REGISTRY.map((def) => (
            <OrgIntegrationCard
              key={def.id}
              def={def}
              record={recordsByType[def.id]}
              isAdmin={isAdmin}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/30 mt-4">
        Organization-managed · Credentials encrypted at rest · Admin access required
      </p>
    </section>
  );
}

export default function AdminConfigurationPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

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

  // New fields for service category/revenue/payout/ops
  const [newServiceCategory, setNewServiceCategory] = useState("paid");
  const [newServiceCountsTowardRevenue, setNewServiceCountsTowardRevenue] = useState(true);
  const [newServiceRevenueRecognition, setNewServiceRevenueRecognition] = useState("at_booking");
  const [newServicePayoutType, setNewServicePayoutType] = useState("percentage");
  const [newServicePayoutValue, setNewServicePayoutValue] = useState("");
  const [newServicePayoutPercent, setNewServicePayoutPercent] = useState("");
  const [newServiceCoachPayWhenRedeemed, setNewServiceCoachPayWhenRedeemed] = useState(false);
  const [newServiceCountsTowardUtilization, setNewServiceCountsTowardUtilization] = useState(true);
  const [newServiceBlocksAvailability, setNewServiceBlocksAvailability] = useState(true);
  const [newServiceCountsTowardSessionCount, setNewServiceCountsTowardSessionCount] = useState(true);
  const [newServiceRequiresClient, setNewServiceRequiresClient] = useState(true);
  const [newServiceIsBookableByClient, setNewServiceIsBookableByClient] = useState(true);
  const [newServiceIsBookableByCoach, setNewServiceIsBookableByCoach] = useState(true);

  const [editServiceCategory, setEditServiceCategory] = useState("paid");
  const [editServiceCountsTowardRevenue, setEditServiceCountsTowardRevenue] = useState(true);
  const [editServiceRevenueRecognition, setEditServiceRevenueRecognition] = useState("at_booking");
  const [editServicePayoutType, setEditServicePayoutType] = useState("percentage");
  const [editServicePayoutValue, setEditServicePayoutValue] = useState("");
  const [editServicePayoutPercent, setEditServicePayoutPercent] = useState("");
  const [editServiceCoachPayWhenRedeemed, setEditServiceCoachPayWhenRedeemed] = useState(false);
  const [editServiceCountsTowardUtilization, setEditServiceCountsTowardUtilization] = useState(true);
  const [editServiceBlocksAvailability, setEditServiceBlocksAvailability] = useState(true);
  const [editServiceCountsTowardSessionCount, setEditServiceCountsTowardSessionCount] = useState(true);
  const [editServiceRequiresClient, setEditServiceRequiresClient] = useState(true);
  const [editServiceIsBookableByClient, setEditServiceIsBookableByClient] = useState(true);
  const [editServiceIsBookableByCoach, setEditServiceIsBookableByCoach] = useState(true);

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

  const [inquiryEmail, setInquiryEmail] = useState("");
  const [inquiryName, setInquiryName] = useState("");
  const [allowInquiries, setAllowInquiries] = useState(true);
  const [inquirySaved, setInquirySaved] = useState(false);

  useEffect(() => {
    if (orgData) {
      setInquiryEmail((orgData as any).schedulingInquiryEmail ?? "");
      setInquiryName((orgData as any).schedulingInquiryName ?? "");
      setAllowInquiries((orgData as any).allowUserInquiryEmails !== false);
    }
  }, [orgData]);

  const [addingProgram, setAddingProgram] = useState(false);
  const [newProgramName, setNewProgramName] = useState("");
  const [newProgramSlug, setNewProgramSlug] = useState("");
  const [newProgramMaxTeams, setNewProgramMaxTeams] = useState("2");
  const [newProgramTrainingTypes, setNewProgramTrainingTypes] = useState("Strength,Speed");
  const [newProgramStartHour, setNewProgramStartHour] = useState("16");
  const [newProgramEndHour, setNewProgramEndHour] = useState("20");

  const [showProgramTypeModal, setShowProgramTypeModal] = useState(false);
  const [showFunnelTypeModal, setShowFunnelTypeModal] = useState(false);
  const [selectedFunnelType, setSelectedFunnelType] = useState<"athlete_application" | "team_training" | "employment_opportunity">("athlete_application");
  const [addingSimpleProgram, setAddingSimpleProgram] = useState(false);
  const [simpleProgramType, setSimpleProgramType] = useState<"pr_tracker" | "workout_builder" | "lead_capture">("pr_tracker");
  const [newSimpleProgramName, setNewSimpleProgramName] = useState("");
  const [newSimpleProgramSlug, setNewSimpleProgramSlug] = useState("");


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

  const applyServiceCategoryDefaults = (
    category: string,
    setters: {
      setCountsTowardRevenue: (v: boolean) => void;
      setRevenueRecognition: (v: string) => void;
      setPayoutType: (v: string) => void;
      setCountsTowardUtilization: (v: boolean) => void;
      setBlocksAvailability: (v: boolean) => void;
      setRequiresClient: (v: boolean) => void;
      setIsBookableByClient: (v: boolean) => void;
      setIsBookableByCoach: (v: boolean) => void;
      setCoachPayWhenRedeemed: (v: boolean) => void;
      setPrice?: (v: string) => void;
    }
  ) => {
    const defaults: Record<string, any> = {
      paid: { countsTowardRevenue: true, revenueRecognition: "at_booking", payoutType: "percentage", countsTowardUtilization: true, blocksAvailability: true, requiresClient: true, isBookableByClient: true, isBookableByCoach: true, coachPayWhenRedeemed: false },
      intro: { countsTowardRevenue: false, revenueRecognition: "none", payoutType: "fixed", countsTowardUtilization: true, blocksAvailability: true, requiresClient: true, isBookableByClient: true, isBookableByCoach: true, coachPayWhenRedeemed: false, price: "0" },
      internal: { countsTowardRevenue: false, revenueRecognition: "none", payoutType: "hourly", countsTowardUtilization: true, blocksAvailability: true, requiresClient: false, isBookableByClient: false, isBookableByCoach: true, coachPayWhenRedeemed: false, price: "0" },
      meeting: { countsTowardRevenue: false, revenueRecognition: "none", payoutType: "none", countsTowardUtilization: false, blocksAvailability: true, requiresClient: false, isBookableByClient: false, isBookableByCoach: true, coachPayWhenRedeemed: false, price: "0" },
      membership: { countsTowardRevenue: false, revenueRecognition: "at_purchase", payoutType: "percentage", countsTowardUtilization: true, blocksAvailability: true, requiresClient: true, isBookableByClient: true, isBookableByCoach: true, coachPayWhenRedeemed: true, price: "0" },
      package_redemption: { countsTowardRevenue: false, revenueRecognition: "at_purchase", payoutType: "fixed", countsTowardUtilization: true, blocksAvailability: true, requiresClient: true, isBookableByClient: true, isBookableByCoach: true, coachPayWhenRedeemed: true, price: "0" },
      comp: { countsTowardRevenue: false, revenueRecognition: "none", payoutType: "none", countsTowardUtilization: true, blocksAvailability: true, requiresClient: true, isBookableByClient: true, isBookableByCoach: true, coachPayWhenRedeemed: false, price: "0" },
    };
    const d = defaults[category] ?? defaults.paid;
    setters.setCountsTowardRevenue(d.countsTowardRevenue);
    setters.setRevenueRecognition(d.revenueRecognition);
    setters.setPayoutType(d.payoutType);
    setters.setCountsTowardUtilization(d.countsTowardUtilization);
    setters.setBlocksAvailability(d.blocksAvailability);
    setters.setRequiresClient(d.requiresClient);
    setters.setIsBookableByClient(d.isBookableByClient);
    setters.setIsBookableByCoach(d.isBookableByCoach);
    setters.setCoachPayWhenRedeemed(d.coachPayWhenRedeemed);
    if (d.price !== undefined && setters.setPrice) setters.setPrice(d.price);
  };

  const applyTemplate = (template: string) => {
    const templates: Record<string, { category: string; price: string; payoutType: string; payoutValue?: string; payoutPercent?: string; sessionType?: string; name?: string; duration?: string }> = {
      "paid_1on1": { category: "paid", price: "70", payoutType: "percentage", payoutPercent: "50", sessionType: "1_ON_1", name: "1-on-1 Session" },
      "paid_group": { category: "paid", price: "30", payoutType: "percentage", payoutPercent: "50", sessionType: "GROUP", name: "Group Session" },
      "free_intro": { category: "intro", price: "0", payoutType: "fixed", payoutValue: "20", name: "Free Intro Session", duration: "30" },
      "floor_hours": { category: "internal", price: "0", payoutType: "hourly", payoutValue: "25", name: "Floor Hours", duration: "60" },
      "meeting": { category: "meeting", price: "0", payoutType: "none", name: "Coach Meeting", duration: "30" },
      "package_redemption": { category: "package_redemption", price: "0", payoutType: "fixed", payoutValue: "35", name: "Package Session" },
      "comp": { category: "comp", price: "0", payoutType: "none", name: "Comp Session" },
    };
    const t = templates[template];
    if (!t) return;
    if (t.name) setNewServiceName(t.name);
    if (t.duration) setNewServiceDuration(t.duration);
    setNewServiceCategory(t.category);
    setNewServicePrice(t.price);
    setNewServicePayoutType(t.payoutType);
    setNewServicePayoutValue(t.payoutValue ?? "");
    setNewServicePayoutPercent(t.payoutPercent ?? "");
    if (t.sessionType) setNewServiceType(t.sessionType as "1_ON_1" | "GROUP");
    applyServiceCategoryDefaults(t.category, {
      setCountsTowardRevenue: setNewServiceCountsTowardRevenue,
      setRevenueRecognition: setNewServiceRevenueRecognition,
      setPayoutType: setNewServicePayoutType,
      setCountsTowardUtilization: setNewServiceCountsTowardUtilization,
      setBlocksAvailability: setNewServiceBlocksAvailability,
      setRequiresClient: setNewServiceRequiresClient,
      setIsBookableByClient: setNewServiceIsBookableByClient,
      setIsBookableByCoach: setNewServiceIsBookableByCoach,
      setCoachPayWhenRedeemed: setNewServiceCoachPayWhenRedeemed,
    });
    // Override payout type from template
    setNewServicePayoutType(t.payoutType);
  };

  const createServiceMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
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
      setNewServicePrice("0");
      setNewServiceCategory("paid");
      setNewServicePayoutType("percentage");
      setNewServicePayoutValue("");
      setNewServicePayoutPercent("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateServiceMutation = useMutation({
    mutationFn: async ({ id, ...data }: Record<string, any>) => {
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

  const [deleteOrgDialogOpen, setDeleteOrgDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"business" | "coaches" | "booking" | "programs" | "billing" | "advanced">("business");
  const contentRef = useRef<HTMLDivElement>(null);

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

  const startEditService = (service: Service) => {
    setEditingServiceId(service.id);
    setEditServiceName(service.name);
    setEditServiceDesc(service.description || "");
    setEditServiceDuration(String(service.durationMin));
    setEditServicePrice(String((service.priceCents || 0) / 100));
    setEditServiceActive(service.active ?? true);
    setEditServiceType((service.sessionType as "1_ON_1" | "GROUP") || "1_ON_1");
    setEditServiceCategory((service as any).category || "paid");
    setEditServiceCountsTowardRevenue((service as any).countsTowardRevenue !== false);
    setEditServiceRevenueRecognition((service as any).revenueRecognition || "at_booking");
    setEditServicePayoutType((service as any).payoutType || "percentage");
    setEditServicePayoutValue(String((service as any).payoutValueCents !== null && (service as any).payoutValueCents !== undefined ? (service as any).payoutValueCents / 100 : ""));
    setEditServicePayoutPercent(String((service as any).payoutPercent ?? ""));
    setEditServiceCoachPayWhenRedeemed((service as any).coachPayWhenRedeemed || false);
    setEditServiceCountsTowardUtilization((service as any).countsTowardUtilization !== false);
    setEditServiceBlocksAvailability((service as any).blocksAvailability !== false);
    setEditServiceCountsTowardSessionCount((service as any).countsTowardSessionCount !== false);
    setEditServiceRequiresClient((service as any).requiresClient !== false);
    setEditServiceIsBookableByClient((service as any).isBookableByClient !== false);
    setEditServiceIsBookableByCoach((service as any).isBookableByCoach !== false);
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
      category: editServiceCategory,
      countsTowardRevenue: editServiceCountsTowardRevenue,
      revenueRecognition: editServiceRevenueRecognition,
      payoutType: editServicePayoutType,
      payoutValueCents: editServicePayoutValue ? Math.round(parseFloat(editServicePayoutValue) * 100) : null,
      payoutPercent: editServicePayoutPercent ? parseInt(editServicePayoutPercent) : null,
      coachPayWhenRedeemed: editServiceCoachPayWhenRedeemed,
      countsTowardUtilization: editServiceCountsTowardUtilization,
      blocksAvailability: editServiceBlocksAvailability,
      countsTowardSessionCount: editServiceCountsTowardSessionCount,
      requiresClient: editServiceRequiresClient,
      isBookableByClient: editServiceIsBookableByClient,
      isBookableByCoach: editServiceIsBookableByCoach,
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

  const saveInquirySettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/organizations/${orgId}`, {
        schedulingInquiryEmail: inquiryEmail.trim() || null,
        schedulingInquiryName: inquiryName.trim() || null,
        allowUserInquiryEmails: allowInquiries,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/by-id", orgId] });
      setInquirySaved(true);
      setTimeout(() => setInquirySaved(false), 2500);
      toast({ title: "Inquiry settings saved" });
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

  const createSimpleProgramMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/athletic/programs", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Program created" });
      queryClient.invalidateQueries({ queryKey: ["/api/athletic/programs", orgId] });
      setAddingSimpleProgram(false);
      setNewSimpleProgramName("");
      setNewSimpleProgramSlug("");
      if (simpleProgramType === "lead_capture") {
        navigate(`/lead-capture/programs/${data.id}?funnelType=${selectedFunnelType}`);
      }
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
      type: "scheduling",
      maxTeamsPerSlot: parseInt(newProgramMaxTeams) || 2,
      trainingTypes: types,
      startHour: start,
      endHour: end,
    });
  };

  const handleCreateSimpleProgram = () => {
    if (!newSimpleProgramName.trim() || !newSimpleProgramSlug.trim()) {
      toast({ title: "Missing fields", description: "Name and slug are required.", variant: "destructive" });
      return;
    }
    createSimpleProgramMutation.mutate({
      name: newSimpleProgramName.trim(),
      slug: newSimpleProgramSlug.trim(),
      type: simpleProgramType,
      maxTeamsPerSlot: 1,
      trainingTypes: [],
      startHour: 6,
      endHour: 22,
      active: true,
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

  const TAB_LIST = [
    { id: "business" as const, label: "Business", icon: Building2 },
    { id: "coaches" as const, label: "Coaches", icon: Users },
    { id: "booking" as const, label: "Booking", icon: CalendarCheck },
    { id: "programs" as const, label: "Programs", icon: Trophy },
    { id: "billing" as const, label: "Billing", icon: CreditCard },
    { id: "advanced" as const, label: "Advanced", icon: Wrench },
  ];

  return (
    <div className="min-h-0" data-testid="page-admin-configuration">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="pb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-config-title">
          <Settings className="h-6 w-6" />
          Options
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage coaches, training options, pricing, and organization settings.</p>
      </div>

      {/* ── Sticky Tab Nav ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border/60 -mx-4 sm:-mx-6 px-4 sm:px-6 mb-6">
        <div className="flex overflow-x-auto gap-0 -mb-px" style={{ scrollbarWidth: "none" }}>
          {TAB_LIST.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  const mainEl = document.querySelector("main.main-scroll");
                  if (mainEl) mainEl.scrollTop = 0;
                }}
                data-testid={`tab-${tab.id}`}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                }`}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────────────── */}
      <div ref={contentRef}>

        {/* ════════════════════ BUSINESS ════════════════════ */}
        <div className={activeTab !== "business" ? "hidden" : "space-y-8"}>

          {/* Inquiry Contact Settings */}
          <section>
            <h2 className="text-base font-semibold flex items-center gap-2 mb-4">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Inquiry Contact
            </h2>
            <Card className="p-4 space-y-5" data-testid="card-inquiry-settings">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Allow User Scheduling Inquiries</p>
                  <p className="text-xs text-muted-foreground">Let the AI assistant offer to email your scheduling contact when users ask about availability or booking.</p>
                </div>
                <Switch
                  checked={allowInquiries}
                  onCheckedChange={setAllowInquiries}
                  data-testid="switch-allow-inquiry-emails"
                />
              </div>
              {allowInquiries && (
                <div className="space-y-4 pt-1 border-t">
                  <div className="space-y-1.5">
                    <Label htmlFor="inquiry-email" className="text-sm">Scheduling Inquiry Email</Label>
                    <Input
                      id="inquiry-email"
                      placeholder="e.g. scheduling@yourgym.com"
                      value={inquiryEmail}
                      onChange={(e) => setInquiryEmail(e.target.value)}
                      data-testid="input-inquiry-email"
                    />
                    <p className="text-xs text-muted-foreground">Where user inquiries will be sent. If blank, inquiry emails are disabled even if the toggle is on.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inquiry-name" className="text-sm">Scheduling Contact Name</Label>
                    <Input
                      id="inquiry-name"
                      placeholder="e.g. Bryan or the Scheduling Team"
                      value={inquiryName}
                      onChange={(e) => setInquiryName(e.target.value)}
                      data-testid="input-inquiry-name"
                    />
                    <p className="text-xs text-muted-foreground">The name the AI uses when offering to send an inquiry. E.g. "Want me to send this to Bryan?"</p>
                  </div>
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => saveInquirySettingsMutation.mutate()}
                  disabled={saveInquirySettingsMutation.isPending}
                  data-testid="button-save-inquiry-settings"
                >
                  {saveInquirySettingsMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving...</>
                  ) : inquirySaved ? (
                    <><Check className="h-4 w-4 mr-1" /> Saved</>
                  ) : (
                    <><Save className="h-4 w-4 mr-1" /> Save Settings</>
                  )}
                </Button>
              </div>
            </Card>
          </section>

          {/* Session Locations */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
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

          {/* Athletic Scheduling Toggle */}
          <section>
            <h2 className="text-base font-semibold flex items-center gap-2 mb-4">
              <Trophy className="h-4 w-4 text-muted-foreground" />
              Athletic Scheduling
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
              {athleticEnabled && (
                <p className="text-xs text-muted-foreground border-t pt-3">
                  Athletic scheduling is enabled. Manage programs in the{" "}
                  <button
                    className="underline font-medium text-primary"
                    onClick={() => setActiveTab("programs")}
                    data-testid="link-go-to-programs"
                  >
                    Programs
                  </button>{" "}
                  tab.
                </p>
              )}
            </Card>
          </section>
        </div>

        {/* ════════════════════ COACHES ════════════════════ */}
        <div className={activeTab !== "coaches" ? "hidden" : "space-y-8"}>

          {/* Coaches Roster */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
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

          {/* Default Coach Payout */}
          <section>
            <h2 className="text-base font-semibold flex items-center gap-2 mb-4">
              <Percent className="h-4 w-4 text-muted-foreground" />
              Default Coach Payout
            </h2>
            <Card className="p-4" data-testid="card-payout-percentage">
              <p className="text-sm text-muted-foreground mb-3">
                The default percentage for coaches without a custom payout set. Individual coach percentages override this value. The owner always receives 100%.
              </p>
              {settingsLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : payoutEditing ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Input type="number" min="0" max="100" className="w-24" value={payoutPercentage} onChange={(e) => setPayoutPercentage(e.target.value)} data-testid="input-payout-percentage" />
                    <span className="text-sm font-medium">%</span>
                  </div>
                  <Button size="sm" disabled={updateSettingMutation.isPending} onClick={savePayout} data-testid="button-save-payout">
                    <Save className="h-4 w-4 mr-1" />
                    {updateSettingMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPayoutEditing(false)} data-testid="button-cancel-payout">
                    <X className="h-4 w-4 mr-1" /> Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold" data-testid="text-payout-value">{settings?.coach_payout_percentage || "50"}%</span>
                  <Button size="sm" variant="outline" onClick={startEditPayout} data-testid="button-edit-payout">
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                </div>
              )}
            </Card>
          </section>

          {/* Coach Transactions */}
          <section>
            <h2 className="text-base font-semibold flex items-center gap-2 mb-4">
              <Wallet className="h-4 w-4 text-muted-foreground" />
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
        </div>

        {/* ════════════════════ BOOKING ════════════════════ */}
        <div className={activeTab !== "booking" ? "hidden" : "space-y-8"}>
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Dumbbell className="h-4 w-4 text-muted-foreground" />
                Training Options
              </h2>
          <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-service">
                <Plus className="h-4 w-4 mr-1" /> Add Option
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Training Option</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {/* Quick Templates */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Quick Templates</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {[
                      { key: "paid_1on1", label: "Paid 1:1" },
                      { key: "paid_group", label: "Paid Group" },
                      { key: "free_intro", label: "Free Intro" },
                      { key: "floor_hours", label: "Floor Hours" },
                      { key: "meeting", label: "Meeting" },
                      { key: "package_redemption", label: "Package Redemption" },
                      { key: "comp", label: "Comp Session" },
                    ].map(t => (
                      <Button key={t.key} size="sm" variant="outline" className="text-xs h-7" onClick={() => applyTemplate(t.key)} data-testid={`button-template-${t.key}`}>
                        {t.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Basic Info */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Basic Info</h3>
                  <div>
                    <Label>Name</Label>
                    <Input value={newServiceName} onChange={(e) => setNewServiceName(e.target.value)} placeholder="e.g. 1-on-1 Strength Training" data-testid="input-service-name" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={newServiceDesc} onChange={(e) => setNewServiceDesc(e.target.value)} rows={2} data-testid="input-service-description" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Session Format</Label>
                      <Select value={newServiceType} onValueChange={(v) => setNewServiceType(v as "1_ON_1" | "GROUP")}>
                        <SelectTrigger data-testid="select-new-service-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1_ON_1">1 on 1</SelectItem>
                          <SelectItem value="GROUP">Group</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Duration (minutes)</Label>
                      <Input type="number" value={newServiceDuration} onChange={(e) => setNewServiceDuration(e.target.value)} data-testid="input-service-duration" />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Business Type */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Business Type</h3>
                  <div>
                    <Label>Category</Label>
                    <Select value={newServiceCategory} onValueChange={(v) => {
                      setNewServiceCategory(v);
                      applyServiceCategoryDefaults(v, {
                        setCountsTowardRevenue: setNewServiceCountsTowardRevenue,
                        setRevenueRecognition: setNewServiceRevenueRecognition,
                        setPayoutType: setNewServicePayoutType,
                        setCountsTowardUtilization: setNewServiceCountsTowardUtilization,
                        setBlocksAvailability: setNewServiceBlocksAvailability,
                        setRequiresClient: setNewServiceRequiresClient,
                        setIsBookableByClient: setNewServiceIsBookableByClient,
                        setIsBookableByCoach: setNewServiceIsBookableByCoach,
                        setCoachPayWhenRedeemed: setNewServiceCoachPayWhenRedeemed,
                        setPrice: setNewServicePrice,
                      });
                    }}>
                      <SelectTrigger data-testid="select-new-service-category"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid Session</SelectItem>
                        <SelectItem value="intro">Free Intro</SelectItem>
                        <SelectItem value="internal">Floor Hours / Internal Time</SelectItem>
                        <SelectItem value="meeting">Meeting</SelectItem>
                        <SelectItem value="membership">Membership Redemption</SelectItem>
                        <SelectItem value="package_redemption">Package Redemption</SelectItem>
                        <SelectItem value="comp">Comp Session</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                {/* Revenue Section */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Revenue</h3>
                  <p className="text-xs text-muted-foreground">Client price controls revenue. Coach payout controls compensation. A session can cost the client $0 and still pay the coach.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Client Price ($)</Label>
                      <Input type="number" step="0.01" value={newServicePrice} onChange={(e) => setNewServicePrice(e.target.value)} data-testid="input-service-price"
                        disabled={["internal", "meeting"].includes(newServiceCategory) && !newServiceCountsTowardRevenue} />
                    </div>
                    <div>
                      <Label>Revenue Recognition</Label>
                      <Select value={newServiceRevenueRecognition} onValueChange={setNewServiceRevenueRecognition}>
                        <SelectTrigger data-testid="select-new-service-revenue-recognition"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="at_booking">At Booking</SelectItem>
                          <SelectItem value="at_purchase">At Purchase</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={newServiceCountsTowardRevenue} onCheckedChange={setNewServiceCountsTowardRevenue} data-testid="switch-new-service-counts-revenue" />
                    <Label>Counts toward revenue</Label>
                  </div>
                </div>

                <Separator />

                {/* Payout Section */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Coach Payout</h3>
                  <div>
                    <Label>Payout Type</Label>
                    <Select value={newServicePayoutType} onValueChange={setNewServicePayoutType}>
                      <SelectTrigger data-testid="select-new-service-payout-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage of revenue</SelectItem>
                        <SelectItem value="fixed">Fixed amount</SelectItem>
                        <SelectItem value="hourly">Hourly rate</SelectItem>
                        <SelectItem value="none">No payout</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newServicePayoutType === "percentage" && (
                    <div>
                      <Label>Payout % (leave blank to use coach default)</Label>
                      <Input type="number" placeholder="e.g. 50" value={newServicePayoutPercent} onChange={(e) => setNewServicePayoutPercent(e.target.value)} data-testid="input-new-service-payout-percent" />
                    </div>
                  )}
                  {(newServicePayoutType === "fixed" || newServicePayoutType === "hourly") && (
                    <div>
                      <Label>{newServicePayoutType === "hourly" ? "Hourly Rate ($)" : "Fixed Amount ($)"}</Label>
                      <Input type="number" step="0.01" placeholder="e.g. 25" value={newServicePayoutValue} onChange={(e) => setNewServicePayoutValue(e.target.value)} data-testid="input-new-service-payout-value" />
                    </div>
                  )}
                  {/* Payout preview */}
                  {newServicePayoutType !== "none" && (
                    <div className="bg-muted rounded p-2 text-xs text-muted-foreground">
                      {newServicePayoutType === "hourly" && newServicePayoutValue && `Coach earns $${newServicePayoutValue}/hr for this session type.`}
                      {newServicePayoutType === "fixed" && newServicePayoutValue && `Coach earns $${newServicePayoutValue} when this session is completed.`}
                      {newServicePayoutType === "percentage" && newServicePayoutPercent && newServicePrice && `Coach earns ${newServicePayoutPercent}% of $${newServicePrice} = $${(parseFloat(newServicePrice) * parseFloat(newServicePayoutPercent) / 100).toFixed(2)}.`}
                      {newServicePayoutType === "percentage" && !newServicePayoutPercent && "Coach earns their default % of client price."}
                    </div>
                  )}
                  {(newServiceCategory === "membership" || newServiceCategory === "package_redemption") && (
                    <div className="flex items-center gap-3">
                      <Switch checked={newServiceCoachPayWhenRedeemed} onCheckedChange={setNewServiceCoachPayWhenRedeemed} data-testid="switch-new-service-coach-pay-redeemed" />
                      <Label>Pay coach when redeemed (even at $0 booking)</Label>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Operations Section */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Operations</h3>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { label: "Blocks calendar availability", value: newServiceBlocksAvailability, setter: setNewServiceBlocksAvailability, testId: "switch-new-blocks-availability" },
                      { label: "Counts toward utilization", value: newServiceCountsTowardUtilization, setter: setNewServiceCountsTowardUtilization, testId: "switch-new-counts-utilization" },
                      { label: "Counts toward session count", value: newServiceCountsTowardSessionCount, setter: setNewServiceCountsTowardSessionCount, testId: "switch-new-counts-session" },
                      { label: "Requires a client", value: newServiceRequiresClient, setter: setNewServiceRequiresClient, testId: "switch-new-requires-client" },
                      { label: "Bookable by client", value: newServiceIsBookableByClient, setter: setNewServiceIsBookableByClient, testId: "switch-new-bookable-client" },
                      { label: "Bookable by coach", value: newServiceIsBookableByCoach, setter: setNewServiceIsBookableByCoach, testId: "switch-new-bookable-coach" },
                    ].map(item => (
                      <div key={item.testId} className="flex items-center gap-3">
                        <Switch checked={item.value} onCheckedChange={item.setter} data-testid={item.testId} />
                        <Label className="text-sm">{item.label}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full"
                  disabled={createServiceMutation.isPending}
                  data-testid="button-submit-service"
                  onClick={() => createServiceMutation.mutate({
                    name: newServiceName,
                    description: newServiceDesc,
                    durationMin: parseInt(newServiceDuration) || 60,
                    priceCents: Math.round(parseFloat(newServicePrice || "0") * 100),
                    sessionType: newServiceType,
                    category: newServiceCategory,
                    countsTowardRevenue: newServiceCountsTowardRevenue,
                    revenueRecognition: newServiceRevenueRecognition,
                    payoutType: newServicePayoutType,
                    payoutValueCents: newServicePayoutValue ? Math.round(parseFloat(newServicePayoutValue) * 100) : null,
                    payoutPercent: newServicePayoutPercent ? parseInt(newServicePayoutPercent) : null,
                    coachPayWhenRedeemed: newServiceCoachPayWhenRedeemed,
                    countsTowardUtilization: newServiceCountsTowardUtilization,
                    blocksAvailability: newServiceBlocksAvailability,
                    countsTowardSessionCount: newServiceCountsTowardSessionCount,
                    requiresClient: newServiceRequiresClient,
                    isBookableByClient: newServiceIsBookableByClient,
                    isBookableByCoach: newServiceIsBookableByCoach,
                  })}
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
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Name</Label>
                      <Input value={editServiceName} onChange={(e) => setEditServiceName(e.target.value)} data-testid={`input-edit-service-name-${service.id}`} />
                    </div>
                    <div>
                      <Label>Duration (minutes)</Label>
                      <Input type="number" value={editServiceDuration} onChange={(e) => setEditServiceDuration(e.target.value)} data-testid={`input-edit-service-duration-${service.id}`} />
                    </div>
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={editServiceDesc} onChange={(e) => setEditServiceDesc(e.target.value)} rows={2} data-testid={`input-edit-service-desc-${service.id}`} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Session Format</Label>
                      <Select value={editServiceType} onValueChange={(v) => setEditServiceType(v as "1_ON_1" | "GROUP")}>
                        <SelectTrigger data-testid={`select-edit-service-type-${service.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1_ON_1">1 on 1</SelectItem>
                          <SelectItem value="GROUP">Group</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Select value={editServiceCategory} onValueChange={(v) => {
                        setEditServiceCategory(v);
                        applyServiceCategoryDefaults(v, {
                          setCountsTowardRevenue: setEditServiceCountsTowardRevenue,
                          setRevenueRecognition: setEditServiceRevenueRecognition,
                          setPayoutType: setEditServicePayoutType,
                          setCountsTowardUtilization: setEditServiceCountsTowardUtilization,
                          setBlocksAvailability: setEditServiceBlocksAvailability,
                          setRequiresClient: setEditServiceRequiresClient,
                          setIsBookableByClient: setEditServiceIsBookableByClient,
                          setIsBookableByCoach: setEditServiceIsBookableByCoach,
                          setCoachPayWhenRedeemed: setEditServiceCoachPayWhenRedeemed,
                          setPrice: setEditServicePrice,
                        });
                      }}>
                        <SelectTrigger data-testid={`select-edit-service-category-${service.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="paid">Paid Session</SelectItem>
                          <SelectItem value="intro">Free Intro</SelectItem>
                          <SelectItem value="internal">Floor Hours / Internal</SelectItem>
                          <SelectItem value="meeting">Meeting</SelectItem>
                          <SelectItem value="membership">Membership Redemption</SelectItem>
                          <SelectItem value="package_redemption">Package Redemption</SelectItem>
                          <SelectItem value="comp">Comp Session</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Client Price ($)</Label>
                      <Input type="number" step="0.01" value={editServicePrice} onChange={(e) => setEditServicePrice(e.target.value)} data-testid={`input-edit-service-price-${service.id}`} />
                    </div>
                    <div>
                      <Label>Revenue Recognition</Label>
                      <Select value={editServiceRevenueRecognition} onValueChange={setEditServiceRevenueRecognition}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="at_booking">At Booking</SelectItem>
                          <SelectItem value="at_purchase">At Purchase</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Payout Type</Label>
                      <Select value={editServicePayoutType} onValueChange={setEditServicePayoutType}>
                        <SelectTrigger data-testid={`select-edit-service-payout-type-${service.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">Percentage</SelectItem>
                          <SelectItem value="fixed">Fixed</SelectItem>
                          <SelectItem value="hourly">Hourly</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      {editServicePayoutType === "percentage" && (
                        <>
                          <Label>Payout %</Label>
                          <Input type="number" placeholder="Default" value={editServicePayoutPercent} onChange={(e) => setEditServicePayoutPercent(e.target.value)} />
                        </>
                      )}
                      {(editServicePayoutType === "fixed" || editServicePayoutType === "hourly") && (
                        <>
                          <Label>{editServicePayoutType === "hourly" ? "Rate ($/hr)" : "Fixed ($)"}</Label>
                          <Input type="number" step="0.01" value={editServicePayoutValue} onChange={(e) => setEditServicePayoutValue(e.target.value)} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Counts toward revenue", value: editServiceCountsTowardRevenue, setter: setEditServiceCountsTowardRevenue },
                      { label: "Counts toward utilization", value: editServiceCountsTowardUtilization, setter: setEditServiceCountsTowardUtilization },
                      { label: "Blocks availability", value: editServiceBlocksAvailability, setter: setEditServiceBlocksAvailability },
                      { label: "Requires client", value: editServiceRequiresClient, setter: setEditServiceRequiresClient },
                      { label: "Client bookable", value: editServiceIsBookableByClient, setter: setEditServiceIsBookableByClient },
                      { label: "Active", value: editServiceActive, setter: setEditServiceActive },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-2">
                        <Switch checked={item.value} onCheckedChange={item.setter} />
                        <Label className="text-xs">{item.label}</Label>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" data-testid={`button-delete-service-${service.id}`}>
                          <Trash2 className="h-4 w-4 mr-1" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Training Option</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete "{service.name}". If this option has existing bookings, it cannot be deleted — deactivate it instead.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid="button-cancel-delete-service">Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteServiceMutation.mutate(service.id)} data-testid="button-confirm-delete-service">
                            {deleteServiceMutation.isPending ? "Deleting..." : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={cancelEditService} data-testid={`button-cancel-edit-${service.id}`}>
                        <X className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                      <Button size="sm" disabled={updateServiceMutation.isPending} onClick={saveEditService} data-testid={`button-save-service-${service.id}`}>
                        <Save className="h-4 w-4 mr-1" />
                        {updateServiceMutation.isPending ? "Saving..." : "Save & Sync Stripe"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium" data-testid={`text-service-name-${service.id}`}>{service.name}</p>
                    {service.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {/* Category badge */}
                      <Badge className={`text-xs ${
                        (service as any).category === "paid" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                        (service as any).category === "intro" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                        (service as any).category === "internal" ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" :
                        (service as any).category === "meeting" ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" :
                        (service as any).category === "membership" || (service as any).category === "package_redemption" ? "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200" :
                        "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                      }`} data-testid={`badge-category-${service.id}`}>
                        {{ paid: "Paid", intro: "Intro", internal: "Internal", meeting: "Meeting", membership: "Membership", package_redemption: "Package", comp: "Comp" }[(service as any).category as string] ?? "Paid"}
                      </Badge>
                      {/* Duration */}
                      <Badge variant="secondary" className="text-xs" data-testid={`badge-duration-${service.id}`}>{service.durationMin} min</Badge>
                      {/* Price badge */}
                      <Badge variant="secondary" className="text-xs" data-testid={`badge-price-${service.id}`}>
                        {(service as any).revenueRecognition === "at_purchase" ? "Revenue at purchase" :
                         (service.priceCents || 0) === 0 ? "$0 client price" :
                         `$${((service.priceCents || 0) / 100).toFixed(0)} client price`}
                      </Badge>
                      {/* Payout badge */}
                      <Badge variant="outline" className="text-xs" data-testid={`badge-payout-${service.id}`}>
                        {(service as any).payoutType === "none" ? "No payout" :
                         (service as any).payoutType === "fixed" ? `$${(((service as any).payoutValueCents ?? 0) / 100).toFixed(0)} fixed` :
                         (service as any).payoutType === "hourly" ? `$${(((service as any).payoutValueCents ?? 0) / 100).toFixed(0)}/hr` :
                         `${(service as any).payoutPercent ?? "?"}% payout`}
                      </Badge>
                      {/* Operational badges */}
                      {(service as any).requiresClient === false && (
                        <Badge variant="outline" className="text-xs text-orange-600" data-testid={`badge-coach-only-${service.id}`}>Coach-only</Badge>
                      )}
                      {(service as any).isBookableByClient && (
                        <Badge variant="outline" className="text-xs" data-testid={`badge-client-bookable-${service.id}`}>Client-bookable</Badge>
                      )}
                      {(service as any).countsTowardUtilization === false && (
                        <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-no-utilization-${service.id}`}>No utilization</Badge>
                      )}
                      <Badge variant={service.active ? "default" : "outline"} className="text-xs" data-testid={`badge-active-${service.id}`}>
                        {service.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => startEditService(service)} data-testid={`button-edit-service-${service.id}`}>
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
        </div>

        {/* ════════════════════ BILLING ════════════════════ */}
        <div className={activeTab !== "billing" ? "hidden" : "space-y-8"}>
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
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
                                  <><Mail className="h-3 w-3 mr-2" />Invite Stripe Subscribers to Join Platform</>
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Invite Existing Stripe Subscribers</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will look up all active <strong>{plan.name}</strong> subscribers in your Stripe account and send each one an email to create their platform account. When they sign up, their existing Stripe subscription is automatically connected — no new payment required. Subscribers who are already connected will be skipped.
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
        </div>

        {/* ════════════════════ PROGRAMS ════════════════════ */}
        <div className={activeTab !== "programs" ? "hidden" : "space-y-8"}>
          {!athleticEnabled && (
            <Card className="p-4" data-testid="card-programs-disabled">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Athletic scheduling is not enabled</p>
                  <p className="text-xs text-muted-foreground">Enable it in the Business tab first, then return here to manage programs.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setActiveTab("business")} data-testid="link-enable-athletic">
                  Go to Business
                </Button>
              </div>
            </Card>
          )}
          {athleticEnabled && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  Program Tools
                </h2>
            <Button size="sm" onClick={() => setShowProgramTypeModal(true)} data-testid="button-add-program">
              <Plus className="h-4 w-4 mr-1" /> Add Program
            </Button>
          </div>

          {/* Type-selection modal */}
          <Dialog open={showProgramTypeModal} onOpenChange={setShowProgramTypeModal}>
            <DialogContent data-testid="dialog-program-type">
              <DialogHeader>
                <DialogTitle>Choose Program Type</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                {[
                  { type: "scheduling", label: "Scheduling Program", desc: "Create a bookable training schedule for teams or groups.", icon: <CalendarCheck className="h-5 w-5" /> },
                  { type: "pr_tracker", label: "PR Tracker", desc: "Let athletes log and track personal records.", icon: <BarChart2 className="h-5 w-5" /> },
                  { type: "workout_builder", label: "Workout Builder", desc: "Create structured workouts athletes can access.", icon: <Hammer className="h-5 w-5" /> },
                  { type: "lead_capture", label: "Lead Capture Program", desc: "Create high-converting athlete application funnels and paid-ad landing pages.", icon: <Zap className="h-5 w-5" />, badge: "NEW" },
                ].map((opt) => (
                  <button
                    key={opt.type}
                    className={`w-full flex items-start gap-3 rounded-lg border p-4 text-left hover:bg-muted transition-colors ${opt.type === "lead_capture" ? "border-orange-500/40 bg-orange-50/40 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/30" : ""}`}
                    onClick={() => {
                      setShowProgramTypeModal(false);
                      if (opt.type === "scheduling") {
                        setAddingProgram(true);
                      } else if (opt.type === "lead_capture") {
                        setSimpleProgramType("lead_capture");
                        setNewSimpleProgramName("");
                        setNewSimpleProgramSlug("");
                        setShowFunnelTypeModal(true);
                      } else {
                        setSimpleProgramType(opt.type as "pr_tracker" | "workout_builder");
                        setNewSimpleProgramName("");
                        setNewSimpleProgramSlug("");
                        setAddingSimpleProgram(true);
                      }
                    }}
                    data-testid={`button-select-type-${opt.type}`}
                  >
                    <span className={`mt-0.5 ${opt.type === "lead_capture" ? "text-orange-500" : "text-muted-foreground"}`}>{opt.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{opt.label}</p>
                        {"badge" in opt && opt.badge && (
                          <span className="text-[10px] font-bold bg-orange-500 text-white px-1.5 py-0.5 rounded-full tracking-wide">{opt.badge}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          {/* Funnel Type selection modal (second step after choosing Lead Capture) */}
          <Dialog open={showFunnelTypeModal} onOpenChange={setShowFunnelTypeModal}>
            <DialogContent data-testid="dialog-funnel-type">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-orange-500" /> Choose Funnel Type
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground -mt-1">Select the purpose of this funnel. Each type comes pre-loaded with optimized fields, automations, and AI scoring.</p>
              <div className="space-y-3 pt-1">
                {[
                  {
                    value: "athlete_application" as const,
                    label: "Athlete Application",
                    desc: "High-converting B2C funnels for individual athlete recruiting. Captures goals, experience, commitment, and AI qualifies each lead.",
                    icon: <Dumbbell className="h-5 w-5" />,
                    color: "border-orange-500/40 bg-orange-50/30 dark:bg-orange-950/20",
                    iconColor: "text-orange-500",
                    badge: "bg-orange-500",
                    badgeLabel: "B2C",
                  },
                  {
                    value: "team_training" as const,
                    label: "Team Training",
                    desc: "B2B outreach to schools and organizations. Captures budget, team size, decision-maker info, and auto-creates pipeline deals.",
                    icon: <Users className="h-5 w-5" />,
                    color: "border-cyan-500/40 bg-cyan-50/30 dark:bg-cyan-950/20",
                    iconColor: "text-cyan-500",
                    badge: "bg-cyan-500",
                    badgeLabel: "B2B",
                  },
                  {
                    value: "employment_opportunity" as const,
                    label: "Employment Opportunities",
                    desc: "Recruit coaches and staff. Collects certifications, experience, availability, and triggers an AI-powered candidate scoring workflow.",
                    icon: <Award className="h-5 w-5" />,
                    color: "border-purple-500/40 bg-purple-50/30 dark:bg-purple-950/20",
                    iconColor: "text-purple-500",
                    badge: "bg-purple-500",
                    badgeLabel: "HIRING",
                  },
                ].map((ft) => (
                  <button
                    key={ft.value}
                    className={`w-full flex items-start gap-3 rounded-lg border p-4 text-left hover:opacity-90 transition-all ${ft.color} ${selectedFunnelType === ft.value ? "ring-2 ring-offset-1 ring-offset-background ring-current" : ""}`}
                    onClick={() => {
                      setSelectedFunnelType(ft.value);
                      setShowFunnelTypeModal(false);
                      setAddingSimpleProgram(true);
                    }}
                    data-testid={`button-funnel-type-${ft.value}`}
                  >
                    <span className={`mt-0.5 ${ft.iconColor}`}>{ft.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{ft.label}</p>
                        <span className={`text-[10px] font-bold ${ft.badge} text-white px-1.5 py-0.5 rounded-full tracking-wide`}>{ft.badgeLabel}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{ft.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          {addingSimpleProgram && (
            <Card
              className={`p-4 space-y-3 mb-4 ${
                simpleProgramType === "lead_capture" && selectedFunnelType === "team_training"
                  ? "border-cyan-500/40 bg-cyan-50/30 dark:bg-cyan-950/10"
                  : simpleProgramType === "lead_capture" && selectedFunnelType === "employment_opportunity"
                  ? "border-purple-500/40 bg-purple-50/30 dark:bg-purple-950/10"
                  : simpleProgramType === "lead_capture"
                  ? "border-orange-500/40 bg-orange-50/30 dark:bg-orange-950/10"
                  : ""
              }`}
              data-testid="card-add-simple-program"
            >
              <div className="flex items-center gap-2">
                {simpleProgramType === "lead_capture" && selectedFunnelType === "team_training" && <Users className="h-4 w-4 text-cyan-500" />}
                {simpleProgramType === "lead_capture" && selectedFunnelType === "employment_opportunity" && <Award className="h-4 w-4 text-purple-500" />}
                {simpleProgramType === "lead_capture" && selectedFunnelType === "athlete_application" && <Zap className="h-4 w-4 text-orange-500" />}
                <p className="text-sm font-semibold">
                  New {simpleProgramType === "pr_tracker" ? "PR Tracker" : simpleProgramType === "workout_builder" ? "Workout Builder" :
                    selectedFunnelType === "team_training" ? "Team Training Funnel" :
                    selectedFunnelType === "employment_opportunity" ? "Employment Funnel" :
                    "Athlete Application Funnel"}
                </p>
              </div>
              {simpleProgramType === "lead_capture" && (
                <p className="text-xs text-muted-foreground">
                  {selectedFunnelType === "team_training"
                    ? "Generates B2B team/school leads at"
                    : selectedFunnelType === "employment_opportunity"
                    ? "Recruits coaches & staff at"
                    : "Creates a public athlete application funnel at"}{" "}
                  <code className="bg-muted px-1 rounded">/apply/[your-org]/[slug]</code>
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{simpleProgramType === "lead_capture" ? "Program Name" : "Tool Name"}</Label>
                  <Input
                    placeholder={simpleProgramType === "pr_tracker" ? "e.g., Varsity PRs" : simpleProgramType === "workout_builder" ? "e.g., Team Workouts" : "e.g., Athlete Recruiting"}
                    value={newSimpleProgramName}
                    onChange={(e) => { setNewSimpleProgramName(e.target.value); setNewSimpleProgramSlug(slugify(e.target.value)); }}
                    data-testid="input-simple-program-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">URL Slug</Label>
                  <Input
                    placeholder="e.g., varsity-prs"
                    value={newSimpleProgramSlug}
                    onChange={(e) => setNewSimpleProgramSlug(e.target.value)}
                    data-testid="input-simple-program-slug"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={createSimpleProgramMutation.isPending} onClick={handleCreateSimpleProgram} data-testid="button-save-simple-program">
                  <Save className="h-4 w-4 mr-1" />
                  {createSimpleProgramMutation.isPending ? "Creating..." : "Create Tool"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAddingSimpleProgram(false)} data-testid="button-cancel-simple-program">
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
              </div>
            </Card>
          )}

          {addingProgram && (
            <Card className="p-4 space-y-3 mb-4" data-testid="card-add-program">
              <p className="text-sm font-semibold">New Scheduling Program</p>
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold" data-testid={`text-program-name-${p.id}`}>{p.name}</p>
                          {(() => {
                            const t = p.type ?? "scheduling";
                            if (t === "pr_tracker") return <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0" data-testid={`badge-type-${p.id}`}>PR Tracker</Badge>;
                            if (t === "workout_builder") return <Badge className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-0" data-testid={`badge-type-${p.id}`}>Workout Builder</Badge>;
                            if (t === "lead_capture") return <Badge className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-0 flex items-center gap-1" data-testid={`badge-type-${p.id}`}><Zap className="h-2.5 w-2.5" />Lead Capture</Badge>;
                            return <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0" data-testid={`badge-type-${p.id}`}>Scheduling Program</Badge>;
                          })()}
                          {!p.active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">/{p.slug}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {(p.type === "scheduling" || !p.type) ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => startEditProgram(p)} data-testid={`button-edit-program-${p.id}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => { setSchedulesProgramId(schedulesProgramId === p.id ? null : p.id); setAddingSchedule(false); }} data-testid={`button-schedules-program-${p.id}`}>
                              <Clock className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : p.type === "lead_capture" ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 text-orange-500 hover:text-orange-600" onClick={() => navigate(`/lead-capture/programs/${p.id}`)} data-testid={`button-configure-program-${p.id}`}>
                              <Settings className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-foreground" onClick={() => window.open(`/apply/${orgData?.slug}/${p.slug}`, "_blank")} data-testid={`button-open-program-${p.id}`}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => navigate(`/org/${orgData?.slug}/programs/${p.slug}`)} data-testid={`button-open-program-${p.id}`}>
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
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
                    {(p.type === "scheduling" || !p.type) && (
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatHourLabel(p.startHour)} - {formatHourLabel(p.endHour)}</span>
                        <span className="flex items-center gap-1"><Dumbbell className="h-3.5 w-3.5" /> {(p.trainingTypes || []).join(", ")}</span>
                        <span>Max {p.maxTeamsPerSlot} teams/slot</span>
                      </div>
                    )}
                    {p.type === "pr_tracker" && (
                      <p className="text-xs text-muted-foreground">Athletes log and track personal records. Click the link icon to open.</p>
                    )}
                    {p.type === "workout_builder" && (
                      <p className="text-xs text-muted-foreground">Create structured workouts athletes can access. Click the link icon to open.</p>
                    )}
                    {p.type === "lead_capture" && (
                      <LeadCaptureStats programId={p.id} orgSlug={orgData?.slug} programSlug={p.slug} />
                    )}
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
              <p className="text-sm text-muted-foreground text-center py-6">No program tools yet. Click "Add Program" to create one.</p>
            )}
          </div>
          </section>
          )}
        </div>

        {/* ════════════════════ ADVANCED ════════════════════ */}
        <div className={activeTab !== "advanced" ? "hidden" : "space-y-8"}>
          {/* ── Platform Infrastructure ──────────────────────────────────────── */}
          <IntegrationsSection />

          {/* ── Divider ──────────────────────────────────────────────────────── */}
          <div className="border-t border-border/20" />

          {/* ── Organization Integrations ─────────────────────────────────────── */}
          <OrgIntegrationsSection />

          {/* ── Danger Zone ─────────────────────────────────────────────────────── */}
          <section className="mt-4">
        <Card className="border-destructive/50 bg-destructive/5">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              <h2 className="text-base font-semibold text-destructive">Danger Zone</h2>
            </div>
            <p className="text-sm text-muted-foreground">Permanent organization actions live here.</p>
            <Separator className="border-destructive/20" />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Delete Organization</p>
                <p className="text-xs text-muted-foreground">Permanently remove this organization and all associated data.</p>
              </div>
              <Button
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
                onClick={() => setDeleteOrgDialogOpen(true)}
                data-testid="button-delete-organization"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Organization
              </Button>
            </div>
          </div>
        </Card>
          </section>
        </div>
      </div>

      {/* ── Delete org confirmation dialog ───────────────────────────────────── */}
      <AlertDialog open={deleteOrgDialogOpen} onOpenChange={setDeleteOrgDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-org-dialog-title">
              Delete this organization?
            </AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-org-dialog-description">
              This will permanently delete your organization, all services, coach profiles, and user data
              associated with it. If you have an active subscription, it will also be canceled.{" "}
              <span className="font-semibold text-destructive">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-org-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteOrgMutation.mutate()}
              disabled={deleteOrgMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-org-confirm"
            >
              {deleteOrgMutation.isPending ? "Deleting..." : "Yes, delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
