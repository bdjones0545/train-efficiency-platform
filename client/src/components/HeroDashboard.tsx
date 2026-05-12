import { useEffect, useState } from "react";
import {
  Calendar, Users, DollarSign, BarChart3, Building2, Wallet,
  UserCog, Mail, Zap, ChevronRight, Bell, Search, TrendingUp,
  Clock, CheckCircle2, AlertCircle, ArrowUpRight, Activity,
  Target, Dumbbell, CreditCard, Star,
} from "lucide-react";

const pulse = "animate-pulse";

function LiveDot({ color = "bg-primary" }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-50`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  );
}

const sidebarItems = [
  { icon: Activity, label: "Dashboard", active: true },
  { icon: Calendar, label: "Schedule" },
  { icon: Users, label: "Clients" },
  { icon: Building2, label: "Team Training" },
  { icon: DollarSign, label: "Payments" },
  { icon: UserCog, label: "Coaches" },
  { icon: Mail, label: "Outreach" },
  { icon: BarChart3, label: "Analytics" },
];

const aiRecs = [
  { icon: Users, text: "3 athletes overdue for package renewal", type: "action", badge: "Revenue" },
  { icon: Calendar, text: "Thursday has 4 unfilled prime-hour slots", type: "schedule", badge: "Scheduling" },
  { icon: CreditCard, text: "2 team invoices scheduled for tomorrow", type: "billing", badge: "Billing" },
  { icon: TrendingUp, text: "Projected monthly revenue up 14%", type: "positive", badge: "Insight" },
];

const pipeline = [
  { name: "Bluffton Football", status: "Proposal Sent", stage: 2, color: "text-primary" },
  { name: "Hilton Head Volleyball", status: "Awaiting Reply", stage: 1, color: "text-yellow-400" },
  { name: "Beaufort Baseball", status: "Lead Identified", stage: 0, color: "text-muted-foreground" },
];

const activity = [
  { icon: UserCog, text: "Marcus T. signed up as new athlete", time: "2m ago", dot: "bg-primary" },
  { icon: CheckCircle2, text: "Session completed — Jordan R.", time: "18m ago", dot: "bg-primary" },
  { icon: Wallet, text: "Package renewed — Sarah K. $240", time: "1h ago", dot: "bg-primary" },
  { icon: Mail, text: "Outreach draft generated for Bluffton FB", time: "2h ago", dot: "bg-muted-foreground" },
];

const coachUtil = [
  { name: "Bryan J.", pct: 91, sessions: 8 },
  { name: "Dani M.", pct: 74, sessions: 6 },
  { name: "Chris W.", pct: 58, sessions: 5 },
];

export default function HeroDashboard() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="relative rounded-xl border border-border/70 overflow-hidden shadow-2xl text-xs"
      style={{ background: "hsl(var(--background))", fontFamily: "var(--font-sans)" }}
    >
      {/* Soft ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-24 bg-primary/6 blur-3xl pointer-events-none z-0" />

      {/* ── Laser scan line ── */}
      <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden" aria-hidden="true">
        <div className="laser-scan-line" />
      </div>

      {/* ── Corner precision marks ── */}
      <div className="absolute top-2 left-2 w-4 h-4 pointer-events-none z-30" aria-hidden="true"
        style={{ borderTop: "1px solid hsl(var(--primary) / 0.3)", borderLeft: "1px solid hsl(var(--primary) / 0.3)" }} />
      <div className="absolute top-2 right-2 w-4 h-4 pointer-events-none z-30" aria-hidden="true"
        style={{ borderTop: "1px solid hsl(var(--primary) / 0.3)", borderRight: "1px solid hsl(var(--primary) / 0.3)" }} />
      <div className="absolute bottom-2 left-2 w-4 h-4 pointer-events-none z-30" aria-hidden="true"
        style={{ borderBottom: "1px solid hsl(var(--primary) / 0.3)", borderLeft: "1px solid hsl(var(--primary) / 0.3)" }} />
      <div className="absolute bottom-2 right-2 w-4 h-4 pointer-events-none z-30" aria-hidden="true"
        style={{ borderBottom: "1px solid hsl(var(--primary) / 0.3)", borderRight: "1px solid hsl(var(--primary) / 0.3)" }} />

      {/* ── Browser chrome ── */}
      <div
        className="relative z-10 flex items-center gap-2 px-4 py-2.5 border-b border-border/60"
        style={{ background: "hsl(var(--card))" }}
      >
        <div className="flex gap-1.5 flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        </div>
        <div className="flex-1 mx-3 h-4 rounded-md bg-muted/40 max-w-xs text-[10px] flex items-center px-2 text-muted-foreground/50 select-none">
          app.trainefficiency.com/dashboard
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-5 h-5 rounded bg-muted/40" />
          <div className="w-5 h-5 rounded bg-muted/40" />
        </div>
      </div>

      {/* ── Layout: Sidebar + Main ── */}
      <div className="relative z-10 flex" style={{ minHeight: "420px" }}>

        {/* ── SIDEBAR ── */}
        <div
          className="w-36 border-r border-border/50 flex flex-col flex-shrink-0 hidden sm:flex"
          style={{ background: "hsl(var(--sidebar))" }}
        >
          {/* Brand */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-border/40">
            <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
              <Dumbbell className="h-2.5 w-2.5 text-primary-foreground" />
            </div>
            <span className="text-[10px] font-semibold truncate">TrainEfficiency</span>
          </div>

          {/* Nav items */}
          <nav className="flex-1 px-2 py-2 space-y-0.5">
            {sidebarItems.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-default transition-colors ${
                  active
                    ? "bg-primary/12 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Icon className="h-3 w-3 flex-shrink-0" />
                <span className="text-[10px] truncate">{label}</span>
                {label === "Outreach" && (
                  <span className="ml-auto text-[9px] bg-primary/20 text-primary rounded px-1">3</span>
                )}
              </div>
            ))}
          </nav>

          {/* Coach profile */}
          <div className="px-3 py-3 border-t border-border/40 flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[8px] font-bold text-primary">BJ</span>
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-medium truncate">Bryan Jones</div>
              <div className="text-[8px] text-muted-foreground">Admin</div>
            </div>
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="flex-1 overflow-hidden flex flex-col" style={{ background: "hsl(var(--background))" }}>

          {/* ── TOP HEADER ── */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50" style={{ background: "hsl(var(--card)/0.6)" }}>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold">Dashboard</span>
              <span className="text-muted-foreground text-[10px]">/ May 2026</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Search bar */}
              <div className="hidden sm:flex items-center gap-1.5 h-6 px-2.5 rounded-md border border-border/50 bg-muted/30 text-muted-foreground/60">
                <Search className="h-2.5 w-2.5" />
                <span className="text-[9px]">Search...</span>
              </div>
              {/* Notifications */}
              <div className="relative">
                <div className="w-6 h-6 rounded-md border border-border/50 bg-muted/30 flex items-center justify-center">
                  <Bell className="h-3 w-3 text-muted-foreground" />
                </div>
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary text-primary-foreground text-[7px] flex items-center justify-center font-bold">3</span>
              </div>
              {/* Avatar */}
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-[8px] font-bold text-primary">BJ</span>
              </div>
            </div>
          </div>

          {/* ── CONTENT SCROLL AREA ── */}
          <div className="flex-1 overflow-hidden p-3 space-y-3">

            {/* ── KPI STRIP ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "This Month", value: "$6,890", sub: "+14% vs last month", icon: TrendingUp, accent: true },
                { label: "Today's Sessions", value: "8 / 10", sub: "2 slots open", icon: Calendar },
                { label: "Pending Payouts", value: "$1,240", sub: "3 coaches", icon: Wallet },
                { label: "Active Clients", value: "34", sub: "2 new this week", icon: Users },
              ].map(({ label, value, sub, icon: Icon, accent }) => (
                <div
                  key={label}
                  className={`rounded-lg border p-2.5 space-y-1.5 relative overflow-hidden ${
                    accent ? "border-primary/35 bg-primary/6" : "border-border/50 bg-card/60"
                  }`}
                >
                  {accent && <div className="absolute top-0 right-0 w-12 h-12 bg-primary/8 rounded-full -translate-y-1/2 translate-x-1/2" />}
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
                    <Icon className={`h-2.5 w-2.5 ${accent ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div className={`text-sm font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
                  <div className="text-[9px] text-muted-foreground flex items-center gap-1">
                    {accent && <ArrowUpRight className="h-2 w-2 text-primary" />}
                    {sub}
                  </div>
                </div>
              ))}
            </div>

            {/* ── TWO COLUMN GRID ── */}
            <div className="grid sm:grid-cols-2 gap-2.5">

              {/* AI RECOMMENDATIONS */}
              <div className="rounded-lg border border-border/50 bg-card/60 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-md bg-primary/15 flex items-center justify-center">
                      <Zap className="h-2.5 w-2.5 text-primary" />
                    </div>
                    <span className="text-[10px] font-semibold">AI Recommendations</span>
                  </div>
                  <LiveDot />
                </div>
                <div className="divide-y divide-border/30">
                  {aiRecs.map(({ icon: Icon, text, type, badge }, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/20 transition-colors cursor-default"
                    >
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        type === "positive" ? "bg-primary/15" : type === "action" ? "bg-orange-500/10" : "bg-muted/50"
                      }`}>
                        <Icon className={`h-2.5 w-2.5 ${
                          type === "positive" ? "text-primary" : type === "action" ? "text-orange-400" : "text-muted-foreground"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-[10px] leading-snug">{text}</p>
                        <span className={`inline-block text-[8px] px-1 rounded font-medium ${
                          type === "positive" ? "bg-primary/15 text-primary" :
                          type === "action" ? "bg-orange-500/15 text-orange-400" :
                          "bg-muted/60 text-muted-foreground"
                        }`}>{badge}</span>
                      </div>
                      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40 flex-shrink-0 mt-1" />
                    </div>
                  ))}
                </div>
              </div>

              {/* TEAM TRAINING PIPELINE */}
              <div className="rounded-lg border border-border/50 bg-card/60 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-md bg-muted/60 flex items-center justify-center">
                      <Building2 className="h-2.5 w-2.5 text-muted-foreground" />
                    </div>
                    <span className="text-[10px] font-semibold">Team Training Pipeline</span>
                  </div>
                  <span className="text-[9px] text-primary font-medium">3 active</span>
                </div>
                <div className="p-3 space-y-2.5">
                  {pipeline.map(({ name, status, stage, color }) => (
                    <div key={name} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium">{name}</span>
                        <span className={`text-[9px] ${color}`}>{status}</span>
                      </div>
                      <div className="flex gap-1">
                        {["Lead", "Proposal", "Signed"].map((s, i) => (
                          <div
                            key={s}
                            className={`flex-1 h-1 rounded-full ${
                              i <= stage ? "bg-primary" : "bg-border/60"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="pt-1 border-t border-border/40">
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>Pipeline value</span>
                      <span className="font-semibold text-foreground">$18,400</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── BOTTOM ROW ── */}
            <div className="grid sm:grid-cols-3 gap-2.5">

              {/* COACH UTILIZATION */}
              <div className="rounded-lg border border-border/50 bg-card/60 overflow-hidden">
                <div className="px-3 py-2 border-b border-border/40 flex items-center gap-1.5">
                  <UserCog className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className="text-[10px] font-semibold">Coach Utilization</span>
                </div>
                <div className="p-3 space-y-2.5">
                  {coachUtil.map(({ name, pct, sessions }) => (
                    <div key={name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-medium">{name}</span>
                        <span className="text-[9px] text-muted-foreground">{sessions} sessions</span>
                      </div>
                      <div className="h-1 bg-border/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-1000"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-[8px] text-muted-foreground">{pct}% capacity</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SCHEDULING INTELLIGENCE */}
              <div className="rounded-lg border border-border/50 bg-card/60 overflow-hidden">
                <div className="px-3 py-2 border-b border-border/40 flex items-center gap-1.5">
                  <Calendar className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className="text-[10px] font-semibold">This Week</span>
                </div>
                <div className="p-3 space-y-1.5">
                  {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, i) => {
                    const booked = [6, 8, 7, 4, 5][i];
                    const cap = 10;
                    const pct = (booked / cap) * 100;
                    return (
                      <div key={day} className="flex items-center gap-2">
                        <span className="text-[9px] text-muted-foreground w-6">{day}</span>
                        <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct >= 80 ? "bg-primary" : pct >= 50 ? "bg-primary/60" : "bg-primary/30"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground w-8 text-right">{booked}/{cap}</span>
                      </div>
                    );
                  })}
                  <div className="pt-1.5 border-t border-border/40 flex items-center justify-between text-[9px]">
                    <span className="text-muted-foreground">Avg occupancy</span>
                    <span className="text-primary font-semibold">60%</span>
                  </div>
                </div>
              </div>

              {/* ACTIVITY FEED */}
              <div className="rounded-lg border border-border/50 bg-card/60 overflow-hidden">
                <div className="px-3 py-2 border-b border-border/40 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[10px] font-semibold">Live Activity</span>
                  </div>
                  <LiveDot />
                </div>
                <div className="divide-y divide-border/30">
                  {activity.map(({ icon: Icon, text, time, dot }, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2">
                      <div className={`w-4 h-4 rounded-full ${i === 0 ? "bg-primary/15" : "bg-muted/50"} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon className={`h-2 w-2 ${i === 0 ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] leading-snug">{text}</p>
                        <span className="text-[8px] text-muted-foreground/60">{time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
