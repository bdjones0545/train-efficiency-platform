import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, TrendingDown, AlertTriangle, Zap, Brain, DollarSign,
  Users, Activity, Target, BarChart3, RefreshCw, Loader2, Play,
  Shield, Eye, Star, ChevronRight, ArrowUp, ArrowDown, Minus,
  Lightbulb, Calendar, CheckCircle, Clock, Award, Cpu,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  critical: "border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-950/20",
  high:     "border-l-4 border-red-500 bg-red-50 dark:bg-red-950/20",
  medium:   "border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20",
  low:      "border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-950/20",
};
const RISK_BADGE: Record<string, string> = {
  critical: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  high:     "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  medium:   "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  low:      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};
const OPP_BADGE: Record<string, string> = {
  high:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  low:    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const HORIZON_LABELS: Record<number, string> = { 30: "30 Days", 60: "60 Days", 90: "90 Days", 180: "180 Days" };

const METRIC_META: Record<string, { label: string; icon: typeof DollarSign; format: (v: number) => string; color: string }> = {
  revenue:              { label: "Monthly Revenue",    icon: DollarSign,  format: (v) => `$${v.toLocaleString("en", { maximumFractionDigits: 0 })}`, color: "text-emerald-600" },
  lead_volume:          { label: "Lead Volume (30d)",  icon: Users,       format: (v) => v.toFixed(0),     color: "text-blue-600" },
  active_clients:       { label: "Active Clients",     icon: Users,       format: (v) => v.toFixed(0),     color: "text-purple-600" },
  capacity_utilization: { label: "Capacity %",         icon: Activity,    format: (v) => `${v.toFixed(1)}%`, color: "text-amber-600" },
  sessions_per_week:    { label: "Sessions/Week",      icon: Calendar,    format: (v) => v.toFixed(1),     color: "text-cyan-600" },
};

function TrendArrow({ pct }: { pct: number }) {
  if (pct > 0.5)  return <ArrowUp   className="w-4 h-4 text-green-500 inline" />;
  if (pct < -0.5) return <ArrowDown className="w-4 h-4 text-red-500 inline" />;
  return <Minus className="w-4 h-4 text-slate-400 inline" />;
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 70 ? "bg-green-500" : value >= 45 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-1.5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8">{value}%</span>
    </div>
  );
}

// ─── OS Score Tab ─────────────────────────────────────────────────────────────
function OSScoreWidget() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/forecast/os-score"] });

  const refresh = useMutation({
    mutationFn: () => apiRequest("POST", "/api/forecast/refresh-twin", {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/forecast"] }); toast({ title: "Digital twin refreshed" }); },
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const total = data?.total ?? 0;
  const components = data?.components ?? [];
  const scoreColor = total >= 75 ? "text-green-600" : total >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2"><Cpu className="w-5 h-5 text-primary" /> Business OS Score</CardTitle>
            <CardDescription>Composite readiness across memory, learning, trust, forecast, autonomy, efficiency, and growth</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-refresh-twin">
            {refresh.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />} Refresh Data
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6 mb-6">
          <div className={`text-7xl font-black ${scoreColor}`}>{total}</div>
          <div className="flex-1">
            <Progress value={total} className="h-5 mb-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Record</span><span>Learning</span><span>Trust</span><span>Prediction</span><span>Execution</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {components.map((c: any) => (
            <div key={c.name} className="bg-muted/50 rounded-lg p-2 text-center" data-testid={`os-component-${c.name}`}>
              <div className="text-lg font-bold">{c.score}</div>
              <div className="text-[10px] text-muted-foreground leading-tight mb-1">{c.name}</div>
              <div className="text-[9px] text-muted-foreground opacity-70">{(c.weight * 100).toFixed(0)}% weight</div>
              <Progress value={c.score} className="h-1 mt-1" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const { data: dash, isLoading } = useQuery<any>({ queryKey: ["/api/forecast/dashboard"] });
  const { data: twin } = useQuery<any>({ queryKey: ["/api/forecast/digital-twin"] });

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  const t = twin ?? {};
  const rev = parseFloat(t.monthly_revenue ?? "0");
  const revTrend = parseFloat(t.revenue_trend_pct ?? "0");
  const leadTrend = parseFloat(t.lead_trend_pct ?? "0");

  const twinMetrics = [
    { label: "Monthly Revenue",      value: `$${rev.toLocaleString("en", { maximumFractionDigits: 0 })}`,    trend: revTrend,   icon: DollarSign, color: "text-emerald-600" },
    { label: "Active Clients",        value: t.active_clients ?? 0,                                            trend: 3,          icon: Users,      color: "text-blue-600" },
    { label: "Active Coaches",        value: t.active_coaches ?? 0,                                            trend: 0,          icon: Award,      color: "text-purple-600" },
    { label: "Sessions / Week",       value: parseFloat(t.sessions_per_week ?? "0").toFixed(1),               trend: 2,          icon: Calendar,   color: "text-cyan-600" },
    { label: "Lead Volume (30d)",     value: t.lead_volume_30d ?? 0,                                           trend: leadTrend,  icon: Target,     color: "text-amber-600" },
    { label: "Conversion Rate",       value: `${(parseFloat(t.conversion_rate ?? "0") * 100).toFixed(1)}%`,  trend: 1,          icon: TrendingUp, color: "text-teal-600" },
    { label: "Retention Rate",        value: `${(parseFloat(t.retention_rate ?? "0.82") * 100).toFixed(0)}%`, trend: 0.5,       icon: Shield,     color: "text-indigo-600" },
    { label: "Capacity Utilization",  value: `${(parseFloat(t.capacity_utilization ?? "0") * 100).toFixed(0)}%`, trend: 0,    icon: Activity,   color: "text-rose-600" },
  ];

  const d = dash ?? {};

  return (
    <div className="space-y-6">
      <OSScoreWidget />

      {/* Digital Twin Live State */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Brain className="w-4 h-4 text-primary" /> Business Digital Twin — Live State</CardTitle>
          <CardDescription>Continuously updated model of your business. Agents consult this before making recommendations.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {twinMetrics.map((m) => (
              <div key={m.label} className="border rounded-lg p-3" data-testid={`twin-metric-${m.label}`}>
                <m.icon className={`w-4 h-4 mb-1 ${m.color}`} />
                <div className="text-xl font-bold">{m.value}</div>
                <div className="text-xs text-muted-foreground mb-1">{m.label}</div>
                <div className="flex items-center gap-1 text-xs">
                  <TrendArrow pct={m.trend} />
                  <span className={m.trend > 0 ? "text-green-600" : m.trend < 0 ? "text-red-600" : "text-slate-500"}>
                    {m.trend >= 0 ? "+" : ""}{m.trend.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          {t.last_updated && (
            <p className="text-xs text-muted-foreground mt-3">Last updated: {new Date(t.last_updated).toLocaleString()}</p>
          )}
        </CardContent>
      </Card>

      {/* Quick summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Risks",        value: d.activeRisks ?? 0,         danger: (d.highRisks ?? 0) > 0, icon: AlertTriangle, note: `${d.highRisks ?? 0} high/critical` },
          { label: "Opportunities",        value: d.activeOpportunities ?? 0, danger: false,                  icon: Lightbulb,     note: "Action ready" },
          { label: "Strategic Plans",      value: d.strategicPlans ?? 0,      danger: false,                  icon: Calendar,      note: "Generated" },
          { label: "Simulations Run",      value: d.simulations ?? 0,         danger: false,                  icon: Play,          note: "Scenarios tested" },
        ].map((m) => (
          <Card key={m.label} className={m.danger ? "border-red-300 dark:border-red-700" : ""}>
            <CardContent className="p-4 text-center">
              <m.icon className={`w-6 h-6 mx-auto mb-1 ${m.danger ? "text-red-500" : "text-primary"}`} />
              <div className="text-3xl font-bold">{m.value}</div>
              <div className="text-sm text-muted-foreground">{m.label}</div>
              <div className="text-xs text-muted-foreground opacity-70 mt-0.5">{m.note}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Projections Tab ──────────────────────────────────────────────────────────
function ProjectionsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedHorizon, setSelectedHorizon] = useState<number>(30);
  const { data: projections, isLoading } = useQuery<any[]>({ queryKey: ["/api/forecast/projections"] });

  const generate = useMutation({
    mutationFn: () => apiRequest("POST", "/api/forecast/generate", {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/forecast/projections"] }); toast({ title: "Forecasts regenerated" }); },
  });

  const filtered = projections?.filter((p: any) => p.horizon_days === selectedHorizon) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold">Revenue & Growth Projections</h3>
          <p className="text-sm text-muted-foreground">AI-generated forecasts with confidence scores and variance ranges</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[30, 60, 90, 180].map((h) => (
              <Button key={h} size="sm" variant={selectedHorizon === h ? "default" : "outline"} onClick={() => setSelectedHorizon(h)} data-testid={`button-horizon-${h}`}>
                {HORIZON_LABELS[h]}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-regenerate">
            {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />} Regenerate
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : !filtered.length ? (
        <Card><CardContent className="text-center py-12 text-muted-foreground"><BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>Click Regenerate to generate forecasts.</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p: any) => {
            const meta = METRIC_META[p.metric] ?? { label: p.metric, icon: BarChart3, format: (v: number) => v.toFixed(1), color: "text-primary" };
            const Icon = meta.icon;
            const changePct = parseFloat(p.change_pct ?? "0");
            const isPositive = changePct >= 0;
            const factors: string[] = Array.isArray(p.supporting_factors) ? p.supporting_factors : JSON.parse(p.supporting_factors ?? "[]");

            return (
              <Card key={p.id ?? p.metric} className="border" data-testid={`card-forecast-${p.metric}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Icon className={`w-4 h-4 ${meta.color}`} /> {meta.label}
                    </CardTitle>
                    <Badge className={`text-xs border-0 ${isPositive ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"}`}>
                      {isPositive ? <ArrowUp className="w-3 h-3 inline" /> : <ArrowDown className="w-3 h-3 inline" />} {Math.abs(changePct).toFixed(1)}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-end">
                    <div>
                      <div className="text-xs text-muted-foreground">Current</div>
                      <div className="text-lg font-bold">{meta.format(parseFloat(p.current_value ?? "0"))}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">{HORIZON_LABELS[p.horizon_days]}</div>
                      <div className={`text-2xl font-black ${meta.color}`}>{meta.format(parseFloat(p.projected_value ?? "0"))}</div>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Range: {meta.format(parseFloat(p.variance_low ?? "0"))} – {meta.format(parseFloat(p.variance_high ?? "0"))}
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Confidence</div>
                    <ConfidenceBar value={parseInt(p.confidence ?? "0")} />
                  </div>

                  {factors.length > 0 && (
                    <div className="border-t pt-2">
                      <div className="text-xs font-medium text-muted-foreground mb-1">Supporting factors</div>
                      <ul className="space-y-0.5">
                        {factors.map((f: string, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground flex gap-1.5"><span className="text-primary mt-0.5">•</span>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Risk Radar Tab ───────────────────────────────────────────────────────────
function RiskRadarTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: risks, isLoading } = useQuery<any[]>({ queryKey: ["/api/forecast/risks"] });

  const detect = useMutation({
    mutationFn: () => apiRequest("POST", "/api/forecast/detect-risks", {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/forecast/risks"] }); toast({ title: "Risk scan complete" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold">Business Risk Radar</h3>
          <p className="text-sm text-muted-foreground">Continuously monitoring for emerging risks before they become problems</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => detect.mutate()} disabled={detect.isPending} data-testid="button-detect-risks">
          {detect.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Eye className="w-3 h-3 mr-1" />} Scan Now
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : !risks?.length ? (
        <Card><CardContent className="text-center py-12 text-muted-foreground"><Shield className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>No active risks detected. Business health looks good.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {risks.map((r: any) => (
            <div key={r.id} className={`rounded-lg p-4 ${RISK_COLORS[r.risk_level] ?? RISK_COLORS.medium}`} data-testid={`risk-${r.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge className={`text-xs border-0 ${RISK_BADGE[r.risk_level] ?? ""} uppercase`}>{r.risk_level}</Badge>
                    <Badge variant="outline" className="text-xs capitalize">{r.category}</Badge>
                  </div>
                  <h4 className="font-semibold text-sm">{r.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                  {r.metric_value != null && (
                    <div className="mt-2 text-xs">
                      <span className="text-muted-foreground">Current: </span>
                      <span className="font-medium">{parseFloat(r.metric_value).toFixed(1)}</span>
                      <span className="text-muted-foreground ml-3">Threshold: </span>
                      <span className="font-medium">{parseFloat(r.threshold).toFixed(1)}</span>
                      {r.trend_pct != null && parseFloat(r.trend_pct) !== 0 && (
                        <>
                          <span className="text-muted-foreground ml-3">Trend: </span>
                          <span className={`font-medium ${parseFloat(r.trend_pct) < 0 ? "text-red-600" : "text-green-600"}`}>
                            {parseFloat(r.trend_pct) >= 0 ? "+" : ""}{parseFloat(r.trend_pct).toFixed(1)}%
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <AlertTriangle className={`w-5 h-5 shrink-0 ${r.risk_level === "critical" ? "text-purple-600" : r.risk_level === "high" ? "text-red-600" : r.risk_level === "medium" ? "text-amber-600" : "text-blue-600"}`} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">Detected: {new Date(r.detected_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Opportunities Tab ────────────────────────────────────────────────────────
function OpportunitiesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: opps, isLoading } = useQuery<any[]>({ queryKey: ["/api/forecast/opportunities"] });

  const detect = useMutation({
    mutationFn: () => apiRequest("POST", "/api/forecast/detect-opportunities", {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/forecast/opportunities"] }); toast({ title: "Opportunity scan complete" }); },
  });

  const CAT_ICON: Record<string, typeof Lightbulb> = {
    expansion: TrendingUp, hiring: Users, pricing: DollarSign,
    marketing: Star, retention: Shield, capacity: Activity,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold">Opportunity Intelligence</h3>
          <p className="text-sm text-muted-foreground">Continuously identifying growth levers and expansion opportunities from business data</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => detect.mutate()} disabled={detect.isPending} data-testid="button-detect-opps">
          {detect.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Lightbulb className="w-3 h-3 mr-1" />} Scan Now
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : !opps?.length ? (
        <Card><CardContent className="text-center py-12 text-muted-foreground"><Lightbulb className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>No opportunities detected yet. Click Scan Now.</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {opps.map((o: any) => {
            const Icon = CAT_ICON[o.category] ?? Lightbulb;
            return (
              <Card key={o.id} className="border" data-testid={`opp-${o.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge className={`text-xs border-0 ${OPP_BADGE[o.impact_level] ?? ""} capitalize`}>{o.impact_level} impact</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{o.category}</Badge>
                        {o.trend_pct > 0 && (
                          <Badge className="text-xs bg-green-600 text-white border-0">
                            <TrendingUp className="w-3 h-3 mr-1" />+{parseFloat(o.trend_pct).toFixed(1)}%
                          </Badge>
                        )}
                      </div>
                      <h4 className="font-semibold text-sm">{o.title}</h4>
                      <p className="text-xs text-muted-foreground mt-1">{o.description}</p>
                      {o.recommended_action && (
                        <div className="mt-2 bg-primary/5 rounded p-2 flex items-start gap-1.5">
                          <CheckCircle className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                          <span className="text-xs font-medium">{o.recommended_action}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Scenario Simulator Tab ───────────────────────────────────────────────────
const SCENARIO_TYPES = [
  { value: "ad_spend_increase",  label: "📈 Ad Spend +25%" },
  { value: "ad_spend_decrease",  label: "📉 Ad Spend -25%" },
  { value: "new_coach_hired",    label: "👤 New Coach Hired" },
  { value: "coach_leaves",       label: "🚪 Coach Leaves" },
  { value: "price_increase",     label: "💰 Price Increase 10%" },
  { value: "capacity_expand",    label: "🏋️ Capacity Expansion" },
  { value: "new_location",       label: "📍 New Location Opens" },
];

function ScenarioSimulatorTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: simulations } = useQuery<any[]>({ queryKey: ["/api/forecast/simulations"] });
  const [scenarioType, setScenarioType] = useState("ad_spend_increase");
  const [changePct, setChangePct] = useState("25");
  const [lastResult, setLastResult] = useState<any>(null);

  const simulate = useMutation({
    mutationFn: () => apiRequest("POST", "/api/forecast/simulate", {
      name: SCENARIO_TYPES.find((s) => s.value === scenarioType)?.label ?? scenarioType,
      scenarioType,
      parameters: { changePct: parseFloat(changePct) },
    }),
    onSuccess: async (res) => {
      const data = await res.json();
      setLastResult(data);
      qc.invalidateQueries({ queryKey: ["/api/forecast/simulations"] });
      toast({ title: "Simulation complete" });
    },
  });

  const formatCurrency = (v: number) => `$${Math.abs(v).toLocaleString("en", { maximumFractionDigits: 0 })}`;
  const formatPct = (v: number) => `${v >= 0 ? "+" : ""}${v}%`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scenario builder */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Play className="w-4 h-4 text-primary" /> Scenario Simulator</CardTitle>
            <CardDescription>What happens if you change one business variable?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-2 block">Scenario</label>
              <Select value={scenarioType} onValueChange={setScenarioType}>
                <SelectTrigger data-testid="select-scenario">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCENARIO_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(scenarioType.includes("ad_spend") || scenarioType === "price_increase") && (
              <div>
                <label className="text-xs font-medium mb-2 block">Change % (magnitude)</label>
                <Input type="number" value={changePct} onChange={(e) => setChangePct(e.target.value)} min={1} max={100} data-testid="input-change-pct" />
              </div>
            )}
            <Button className="w-full" onClick={() => simulate.mutate()} disabled={simulate.isPending} data-testid="button-run-simulation">
              {simulate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />} Run Simulation
            </Button>
          </CardContent>
        </Card>

        {/* Result */}
        {lastResult && (() => {
          const impact = lastResult.impact_summary ?? {};
          const baseline = lastResult.baseline ?? {};
          return (
            <Card className={`border-2 ${impact.riskLevel === "high" ? "border-red-300 dark:border-red-700" : "border-primary/30"}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{lastResult.name}</CardTitle>
                <div className="flex gap-2">
                  <Badge className={`text-xs border-0 ${impact.riskLevel === "high" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"}`}>
                    {impact.riskLevel} risk
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Revenue Impact",    delta: impact.revenueDelta,    pct: impact.revenuePct,    format: formatCurrency },
                    { label: "Lead Impact",        delta: impact.leadsDelta,       pct: impact.leadsPct,      format: (v: number) => `${Math.abs(v)} leads` },
                    { label: "Profit Impact",      delta: impact.profitDelta,     pct: impact.profitPct,     format: formatCurrency },
                    { label: "Capacity Change",    delta: impact.utilizationDelta, pct: impact.utilizationDelta, format: (v: number) => `${v >= 0 ? "+" : ""}${v}pp` },
                  ].map((row) => (
                    <div key={row.label} className="bg-muted/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-1">{row.label}</div>
                      <div className={`text-lg font-bold ${(row.delta ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {(row.delta ?? 0) >= 0 ? "+" : "-"}{row.format(row.delta ?? 0)}
                      </div>
                      <div className={`text-xs ${(row.pct ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {formatPct(row.pct ?? 0)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  Baseline monthly revenue: ${parseFloat(baseline.revenue ?? 0).toLocaleString("en", { maximumFractionDigits: 0 })}
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </div>

      {/* History */}
      {(simulations?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Simulation History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {simulations?.slice(0, 8).map((s: any) => {
                const impact = s.impact_summary ?? {};
                return (
                  <div key={s.id} className="flex items-center gap-3 p-2 border rounded text-sm" data-testid={`sim-${s.id}`}>
                    <Play className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="flex-1">{s.name}</span>
                    <span className={`font-medium ${(impact.revenuePct ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {(impact.revenuePct ?? 0) >= 0 ? "+" : ""}{impact.revenuePct ?? 0}% rev
                    </span>
                    <Badge className={`text-xs border-0 ${impact.riskLevel === "high" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>{impact.riskLevel}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Strategic Plans Tab ──────────────────────────────────────────────────────
function StrategicPlansTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: plans, isLoading } = useQuery<any[]>({ queryKey: ["/api/forecast/strategic-plans"] });
  const [horizon, setHorizon] = useState(30);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: () => apiRequest("POST", "/api/forecast/generate-plan", { horizonDays: horizon }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/forecast/strategic-plans"] }); toast({ title: `${horizon}-Day strategic plan generated` }); },
  });

  const parseArr = (v: any) => {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v ?? "[]"); } catch { return []; }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold">Strategic Planning Workspace</h3>
          <p className="text-sm text-muted-foreground">AI-generated 30/60/90-day plans with objectives, risks, opportunities, and recommended actions. Saved to Obsidian.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[30, 60, 90].map((h) => (
              <Button key={h} size="sm" variant={horizon === h ? "default" : "outline"} onClick={() => setHorizon(h)} data-testid={`button-plan-${h}`}>{h}d</Button>
            ))}
          </div>
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-generate-plan">
            {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Brain className="w-3 h-3 mr-1" />} Generate {horizon}-Day Plan
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : !plans?.length ? (
        <Card><CardContent className="text-center py-12 text-muted-foreground"><Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" /><p>No plans generated yet. Click Generate to build your first strategic plan.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {plans.map((plan: any) => {
            const isExpanded = expandedId === plan.id;
            const objectives = parseArr(plan.objectives);
            const risks = parseArr(plan.risks);
            const actions = parseArr(plan.actions);
            const outcomes = parseArr(plan.expected_outcomes);
            const opps = parseArr(plan.opportunities);

            return (
              <Card key={plan.id} className="border" data-testid={`plan-${plan.id}`}>
                <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : plan.id)}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge className="text-xs bg-primary text-white border-0">{plan.horizon_days}d</Badge>
                      <CardTitle className="text-sm">{plan.title}</CardTitle>
                      {plan.obsidian_path && <Badge variant="outline" className="text-xs">📓 Obsidian</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{new Date(plan.generated_at).toLocaleDateString()}</span>
                      <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      <div>
                        <h5 className="text-xs font-semibold text-primary mb-2 flex items-center gap-1"><Target className="w-3 h-3" /> Objectives</h5>
                        <ul className="space-y-1">
                          {objectives.map((o: string, i: number) => (
                            <li key={i} className="text-xs flex gap-1.5"><CheckCircle className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />{o}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-red-600 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Risks</h5>
                        <ul className="space-y-1">
                          {risks.map((r: string, i: number) => (
                            <li key={i} className="text-xs flex gap-1.5"><AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />{r}</li>
                          ))}
                          {risks.length === 0 && <li className="text-xs text-muted-foreground">No significant risks detected</li>}
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-amber-600 mb-2 flex items-center gap-1"><Zap className="w-3 h-3" /> Recommended Actions</h5>
                        <ul className="space-y-1">
                          {actions.map((a: string, i: number) => (
                            <li key={i} className="text-xs flex gap-1.5"><ChevronRight className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />{a}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Expected Outcomes</h5>
                        <ul className="space-y-1">
                          {outcomes.map((o: string, i: number) => (
                            <li key={i} className="text-xs flex gap-1.5"><Star className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />{o}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Forecast Accuracy Tab ────────────────────────────────────────────────────
function AccuracyTab() {
  const { data: accuracy, isLoading } = useQuery<any[]>({ queryKey: ["/api/forecast/accuracy"] });
  const [recordForm, setRecordForm] = useState({ metric: "revenue", horizonDays: "30", predictedValue: "", actualValue: "" });
  const qc = useQueryClient();
  const { toast } = useToast();

  const record = useMutation({
    mutationFn: () => apiRequest("POST", "/api/forecast/record-actual", { ...recordForm, horizonDays: parseInt(recordForm.horizonDays) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/forecast/accuracy"] });
      setRecordForm((f) => ({ ...f, predictedValue: "", actualValue: "" }));
      toast({ title: "Actual outcome recorded" });
    },
  });

  const avgAccuracy = accuracy?.length
    ? Math.round(accuracy.reduce((acc: number, r: any) => acc + parseInt(r.avg_accuracy ?? "0"), 0) / accuracy.length)
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Forecast Accuracy Tracking</h3>
        <p className="text-sm text-muted-foreground">Record actual outcomes against predictions. The engine improves as accuracy data accumulates.</p>
      </div>

      {avgAccuracy != null && (
        <Card className="border-2 border-primary/30">
          <CardContent className="p-4 flex items-center gap-6">
            <div className="text-center">
              <div className="text-5xl font-black text-primary">{avgAccuracy}</div>
              <div className="text-xs text-muted-foreground">Avg Accuracy Score</div>
            </div>
            <div className="flex-1">
              <Progress value={avgAccuracy} className="h-4 mb-1" />
              <p className="text-xs text-muted-foreground">Based on {accuracy?.reduce((acc: number, r: any) => acc + parseInt(r.data_points ?? "0"), 0)} recorded predictions</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : accuracy?.length ? (
        <div className="space-y-2">
          {accuracy.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-4 p-3 border rounded-lg text-sm" data-testid={`accuracy-${r.metric}-${r.horizon_days}`}>
              <Badge variant="outline" className="text-xs">{r.horizon_days}d</Badge>
              <span className="flex-1 font-medium capitalize">{r.metric.replace(/_/g, " ")}</span>
              <div className="text-right">
                <div className="font-bold">{r.avg_accuracy}% accuracy</div>
                <div className="text-xs text-muted-foreground">±{r.avg_variance}% variance · {r.data_points} samples</div>
              </div>
              <div className="w-20">
                <ConfidenceBar value={parseInt(r.avg_accuracy ?? "0")} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Record actual form */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Record Actual Outcome</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-xs font-medium mb-1 block">Metric</label>
              <Select value={recordForm.metric} onValueChange={(v) => setRecordForm((f) => ({ ...f, metric: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(METRIC_META).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Horizon (days)</label>
              <Select value={recordForm.horizonDays} onValueChange={(v) => setRecordForm((f) => ({ ...f, horizonDays: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[30, 60, 90, 180].map((h) => <SelectItem key={h} value={String(h)}>{h} days</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Predicted Value</label>
              <Input type="number" value={recordForm.predictedValue} onChange={(e) => setRecordForm((f) => ({ ...f, predictedValue: e.target.value }))} placeholder="0" data-testid="input-predicted" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Actual Value</label>
              <Input type="number" value={recordForm.actualValue} onChange={(e) => setRecordForm((f) => ({ ...f, actualValue: e.target.value }))} placeholder="0" data-testid="input-actual" />
            </div>
          </div>
          <Button className="mt-3" size="sm" onClick={() => record.mutate()} disabled={record.isPending || !recordForm.actualValue} data-testid="button-record-actual">
            {record.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Record Outcome
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminForecastPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" /> Predictive Intelligence & Business Simulation
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Phase 5 — What is likely to happen? What risks are emerging? What action today creates the best future outcome?
          </p>
        </div>
        <Badge className="text-xs gap-1 bg-green-600 text-white">
          <Activity className="w-3 h-3" /> Live
        </Badge>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview"     data-testid="tab-overview">🧠 Overview</TabsTrigger>
          <TabsTrigger value="projections"  data-testid="tab-projections">📈 Projections</TabsTrigger>
          <TabsTrigger value="risks"        data-testid="tab-risks">⚠️ Risk Radar</TabsTrigger>
          <TabsTrigger value="opportunities" data-testid="tab-opportunities">💡 Opportunities</TabsTrigger>
          <TabsTrigger value="simulator"    data-testid="tab-simulator">🎮 Simulator</TabsTrigger>
          <TabsTrigger value="plans"        data-testid="tab-plans">📋 Strategic Plans</TabsTrigger>
          <TabsTrigger value="accuracy"     data-testid="tab-accuracy">🎯 Accuracy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"      className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="projections"   className="mt-4"><ProjectionsTab /></TabsContent>
        <TabsContent value="risks"         className="mt-4"><RiskRadarTab /></TabsContent>
        <TabsContent value="opportunities" className="mt-4"><OpportunitiesTab /></TabsContent>
        <TabsContent value="simulator"     className="mt-4"><ScenarioSimulatorTab /></TabsContent>
        <TabsContent value="plans"         className="mt-4"><StrategicPlansTab /></TabsContent>
        <TabsContent value="accuracy"      className="mt-4"><AccuracyTab /></TabsContent>
      </Tabs>
    </div>
  );
}
