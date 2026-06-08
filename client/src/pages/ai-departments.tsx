import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Target,
  Users,
  Handshake,
  Trophy,
  ArrowRight,
  ChevronDown,
  Activity,
  Zap,
  BarChart3,
  Shield,
  Building2,
  CheckCircle2,
  Menu,
  X,
  ArrowDown,
  Cpu,
  Network,
  Eye,
  TrendingUp,
  Layers,
  AlertCircle,
  Star,
  Clock,
} from "lucide-react";
import { Link } from "wouter";

const DEPARTMENTS = [
  {
    icon: Target,
    name: "Opportunity Acquisition",
    color: "from-emerald-500 to-green-600",
    glow: "shadow-emerald-500/20",
    border: "border-emerald-500/30",
    finds: ["Revenue opportunities", "New prospect signals", "Market gaps", "Conversion patterns"],
    reports: ["Qualified lead pipeline", "Outreach drafts ready", "Reply tracking summary", "Top opportunity today"],
  },
  {
    icon: Users,
    name: "Hiring Department",
    color: "from-blue-500 to-cyan-600",
    glow: "shadow-blue-500/20",
    border: "border-blue-500/30",
    finds: ["Candidate signals", "Role fit scores", "Talent pipeline gaps", "Culture alignment data"],
    reports: ["Ranked candidates", "Outreach drafts", "Interview priorities", "Hiring velocity trends"],
  },
  {
    icon: Handshake,
    name: "Partnerships Department",
    color: "from-violet-500 to-purple-600",
    glow: "shadow-violet-500/20",
    border: "border-violet-500/30",
    finds: ["Strategic partner signals", "Co-marketing opportunities", "Referral network gaps", "Alliance fits"],
    reports: ["Partner pipeline status", "Relationship next actions", "Proposal queue", "Partnership health"],
  },
  {
    icon: Trophy,
    name: "Sponsorship Department",
    color: "from-amber-500 to-orange-600",
    glow: "shadow-amber-500/20",
    border: "border-amber-500/30",
    finds: ["Sponsor prospects", "Brand alignment scores", "Sponsorship market intel", "Deal value estimates"],
    reports: ["Proposal pipeline", "Sponsor outreach status", "Outcome tracking", "Revenue projections"],
  },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Create your organization", desc: "Set up your performance organization with your branding, team structure, and goals in minutes." },
  { step: "02", title: "Deploy AI departments", desc: "Choose which departments to activate — Opportunity Acquisition, Hiring, Partnerships, or Sponsorships." },
  { step: "03", title: "Review opportunities", desc: "Departments surface qualified leads, candidates, and partners ranked by fit, value, and urgency." },
  { step: "04", title: "Act from one command center", desc: "Approve outreach, prioritize actions, and track outcomes from a single executive dashboard." },
];

export default function AiDepartmentsPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#080c10] text-white overflow-x-hidden">

      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#080c10]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5" data-testid="link-nav-home">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white" data-testid="text-brand-name">TrainEfficiency</span>
          </a>

          <div className="hidden md:flex items-center gap-1">
            {[
              { label: "Departments", href: "#departments" },
              { label: "How It Works", href: "#how-it-works" },
              { label: "Command Center", href: "#command-center" },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="px-4 py-2 text-sm text-white/60 hover:text-white rounded-lg hover:bg-white/[0.05] transition-all"
                data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/[0.05]" data-testid="button-nav-login">
                Login
              </Button>
            </Link>
            <Link href="/">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white border-0" data-testid="button-nav-deploy">
                Deploy Department
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>

          <button
            className="md:hidden p-2 text-white/60 hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-[#080c10] px-6 py-4 flex flex-col gap-3">
            <a href="#departments" className="text-sm text-white/60 py-2" onClick={() => setMobileOpen(false)}>Departments</a>
            <a href="#how-it-works" className="text-sm text-white/60 py-2" onClick={() => setMobileOpen(false)}>How It Works</a>
            <a href="#command-center" className="text-sm text-white/60 py-2" onClick={() => setMobileOpen(false)}>Command Center</a>
            <Link href="/">
              <Button variant="outline" size="sm" className="w-full border-white/20 text-white bg-transparent hover:bg-white/5" data-testid="button-mobile-login">Login</Button>
            </Link>
            <Link href="/">
              <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white border-0" data-testid="button-mobile-deploy">Deploy Department</Button>
            </Link>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-24 px-6">
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] bg-emerald-500/[0.07] rounded-full blur-[120px]" />
        </div>

        <div className="max-w-7xl mx-auto relative">
          <div className="text-center mb-16">
            <Badge className="mb-6 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 px-4 py-1.5 text-xs font-medium tracking-wide uppercase">
              AI Operating System
            </Badge>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6" data-testid="text-hero-headline">
              AI Departments<br />
              <span className="bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent">
                Looking For Work
              </span>
            </h1>
            <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto leading-relaxed mb-10" data-testid="text-hero-subheadline">
              Deploy AI departments that discover opportunities, qualify them, build relationships,
              learn from outcomes, and report directly to leadership.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/">
                <Button size="lg" className="bg-emerald-600 hover:bg-emerald-500 text-white border-0 px-8 h-12 text-sm font-semibold" data-testid="button-hero-primary">
                  Deploy Your First Department
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button size="lg" variant="outline" className="border-white/20 text-white bg-transparent hover:bg-white/[0.05] px-8 h-12 text-sm" data-testid="button-hero-secondary">
                  See How It Works
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </div>
          </div>

          {/* Matching Engine Visual */}
          <div className="relative max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">

              {/* Left — AI Departments */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-2 text-center md:text-left">AI Departments</p>
                {[
                  { icon: Target, label: "Opportunity Acquisition", color: "text-emerald-400", bg: "bg-emerald-500/10" },
                  { icon: Users, label: "Hiring", color: "text-blue-400", bg: "bg-blue-500/10" },
                  { icon: Handshake, label: "Partnerships", color: "text-violet-400", bg: "bg-violet-500/10" },
                  { icon: Trophy, label: "Sponsorships", color: "text-amber-400", bg: "bg-amber-500/10" },
                ].map((dept) => (
                  <div key={dept.label} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.08] rounded-xl p-3.5 hover:border-white/20 transition-all group" data-testid={`card-dept-${dept.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className={`w-8 h-8 rounded-lg ${dept.bg} flex items-center justify-center flex-shrink-0`}>
                      <dept.icon className={`w-4 h-4 ${dept.color}`} />
                    </div>
                    <span className="text-sm text-white/70 group-hover:text-white/90 transition-colors font-medium">{dept.label}</span>
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  </div>
                ))}
              </div>

              {/* Center — Matching Engine */}
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-emerald-500/20 rounded-2xl blur-xl" />
                  <div className="relative bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/[0.12] rounded-2xl p-6 text-center">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center mx-auto mb-3">
                      <Cpu className="w-6 h-6 text-white" />
                    </div>
                    <p className="text-sm font-bold text-white mb-1">Matching Engine</p>
                    <p className="text-xs text-white/40">CEO Heartbeat</p>
                    <div className="mt-3 flex items-center justify-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs text-emerald-400 font-medium">Active</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-px h-8 bg-gradient-to-b from-emerald-500/50 to-transparent" />
                  <Network className="w-4 h-4 text-white/20" />
                  <div className="w-px h-8 bg-gradient-to-b from-transparent to-emerald-500/50" />
                </div>
              </div>

              {/* Right — Work Found */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-2 text-center md:text-right">Work Found</p>
                {[
                  { label: "Revenue Opportunities", value: "12 qualified", color: "text-emerald-400" },
                  { label: "Candidates", value: "8 ranked", color: "text-blue-400" },
                  { label: "Partners", value: "5 identified", color: "text-violet-400" },
                  { label: "Sponsors", value: "3 proposals", color: "text-amber-400" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.08] rounded-xl p-3.5 hover:border-white/20 transition-all group" data-testid={`card-result-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <span className="text-sm text-white/60 group-hover:text-white/80 transition-colors">{item.label}</span>
                    <Badge className={`bg-white/[0.05] ${item.color} border-0 text-xs`}>{item.value}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Marketplace Concept ── */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/[0.05] text-white/50 border-white/10 text-xs uppercase tracking-widest">The Concept</Badge>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              A Marketplace Where AI Departments<br className="hidden md:block" /> Find Work
            </h2>
            <p className="text-white/40 text-lg max-w-2xl mx-auto leading-relaxed">
              Traditional software waits for humans to use it. TrainEfficiency deploys AI departments
              that actively look for useful work across the organization.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Eye,
                label: "Discover",
                color: "from-emerald-500 to-green-600",
                glow: "bg-emerald-500/10",
                desc: "AI departments continuously search for opportunities, candidates, partners, and sponsors — surfacing signals humans would miss.",
              },
              {
                icon: BarChart3,
                label: "Qualify",
                color: "from-blue-500 to-cyan-600",
                glow: "bg-blue-500/10",
                desc: "Each opportunity is scored for fit, value, urgency, and risk. Only high-confidence actions reach your command center.",
              },
              {
                icon: Activity,
                label: "Report",
                color: "from-violet-500 to-purple-600",
                glow: "bg-violet-500/10",
                desc: "Departments summarize what matters and surface ranked priorities to the Command Center for executive review.",
              },
            ].map((card) => (
              <div key={card.label} className="relative group bg-white/[0.02] border border-white/[0.08] rounded-2xl p-8 hover:border-white/20 hover:bg-white/[0.04] transition-all" data-testid={`card-concept-${card.label.toLowerCase()}`}>
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center mb-5`}>
                  <card.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{card.label}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Meet the Departments ── */}
      <section id="departments" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/[0.05] text-white/50 border-white/10 text-xs uppercase tracking-widest">The Departments</Badge>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">Meet the Departments</h2>
            <p className="text-white/40 text-lg max-w-xl mx-auto">
              Each department specializes in a specific domain — and actively looks for work within it.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {DEPARTMENTS.map((dept) => (
              <div key={dept.name} className={`relative bg-white/[0.02] border ${dept.border} rounded-2xl p-8 hover:bg-white/[0.04] transition-all group`} data-testid={`card-department-${dept.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className="flex items-start justify-between mb-6">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${dept.color} flex items-center justify-center`}>
                    <dept.icon className="w-6 h-6 text-white" />
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Available to Deploy
                  </Badge>
                </div>

                <h3 className="text-xl font-bold text-white mb-4">{dept.name}</h3>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">What it finds</p>
                    <ul className="space-y-2">
                      {dept.finds.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-xs text-white/50">
                          <div className="w-1 h-1 rounded-full bg-white/30 mt-1.5 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">What it reports</p>
                    <ul className="space-y-2">
                      {dept.reports.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-xs text-white/50">
                          <div className="w-1 h-1 rounded-full bg-white/30 mt-1.5 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Command Center ── */}
      <section id="command-center" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/[0.05] text-white/50 border-white/10 text-xs uppercase tracking-widest">Leadership View</Badge>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              One Command Center<br className="hidden md:block" /> for Every Department
            </h2>
            <p className="text-white/40 text-lg max-w-xl mx-auto">
              All departments report into a unified executive dashboard. You see what matters, ranked by priority.
            </p>
          </div>

          {/* Mock Dashboard */}
          <div className="relative max-w-4xl mx-auto">
            <div className="absolute inset-0 bg-emerald-500/[0.05] rounded-3xl blur-2xl" />
            <div className="relative bg-white/[0.03] border border-white/[0.10] rounded-2xl overflow-hidden">
              {/* Dashboard Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-semibold text-white">Department Command Center</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/30">Live</span>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-0 text-xs">4 Departments Active</Badge>
                </div>
              </div>

              {/* Metric Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/[0.06]">
                {[
                  { label: "Org Health", value: "94%", icon: Activity, color: "text-emerald-400" },
                  { label: "Departments Active", value: "4 / 4", icon: Layers, color: "text-blue-400" },
                  { label: "Open Alerts", value: "3", icon: AlertCircle, color: "text-amber-400" },
                  { label: "Actions Ready", value: "7", icon: Zap, color: "text-violet-400" },
                ].map((metric) => (
                  <div key={metric.label} className="bg-[#080c10] px-6 py-5" data-testid={`metric-${metric.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <metric.icon className={`w-3.5 h-3.5 ${metric.color}`} />
                      <span className="text-xs text-white/30">{metric.label}</span>
                    </div>
                    <p className={`text-2xl font-bold ${metric.color}`}>{metric.value}</p>
                  </div>
                ))}
              </div>

              {/* Best Action */}
              <div className="px-6 py-5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Best Action Today</span>
                </div>
                <div className="flex items-center justify-between bg-emerald-500/[0.07] border border-emerald-500/20 rounded-xl px-4 py-3.5">
                  <div>
                    <p className="text-sm font-semibold text-white">Review 3 qualified sponsorship proposals</p>
                    <p className="text-xs text-white/40 mt-0.5">Sponsorship Dept · Est. value $24,000 · Human approval required</p>
                  </div>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white border-0 ml-4 flex-shrink-0 text-xs">
                    Review
                  </Button>
                </div>
              </div>

              {/* Department Status Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.06]">
                {[
                  { name: "Opportunity Acquisition", status: "Active", actions: 5, color: "text-emerald-400", bg: "bg-emerald-500/10", icon: Target },
                  { name: "Hiring Department", status: "Active", actions: 2, color: "text-blue-400", bg: "bg-blue-500/10", icon: Users },
                  { name: "Partnerships", status: "Active", actions: 1, color: "text-violet-400", bg: "bg-violet-500/10", icon: Handshake },
                  { name: "Sponsorships", status: "Active", actions: 3, color: "text-amber-400", bg: "bg-amber-500/10", icon: Trophy },
                ].map((dept) => (
                  <div key={dept.name} className="bg-[#080c10] px-6 py-4 flex items-center justify-between" data-testid={`status-dept-${dept.name.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg ${dept.bg} flex items-center justify-center`}>
                        <dept.icon className={`w-4 h-4 ${dept.color}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/80">{dept.name}</p>
                        <p className="text-xs text-white/30">{dept.actions} actions queued</p>
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-0 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
                      {dept.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CEO Heartbeat ── */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/[0.05] text-white/50 border-white/10 text-xs uppercase tracking-widest">Intelligence Layer</Badge>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              The CEO Heartbeat<br className="hidden md:block" /> Keeps Everything Moving
            </h2>
            <p className="text-white/40 text-lg max-w-2xl mx-auto leading-relaxed">
              Every department reports into a central heartbeat that monitors health, ranks priorities,
              and surfaces the highest-leverage action for leadership review.
            </p>
          </div>

          {/* Flow Diagram */}
          <div className="flex flex-col items-center gap-0 max-w-sm mx-auto">
            {[
              { label: "AI Departments", sub: "Actively discovering work", icon: Layers, color: "from-emerald-500 to-green-600" },
              { label: "Department Registry", sub: "Aggregating signals", icon: Network, color: "from-blue-500 to-cyan-600" },
              { label: "Command Center", sub: "Ranking & prioritizing", icon: BarChart3, color: "from-violet-500 to-purple-600" },
              { label: "CEO Heartbeat", sub: "Health monitoring", icon: Activity, color: "from-rose-500 to-pink-600" },
              { label: "Best Action Today", sub: "Human decision point", icon: Star, color: "from-amber-500 to-orange-600" },
            ].map((node, i) => (
              <div key={node.label} className="flex flex-col items-center w-full" data-testid={`flow-node-${i}`}>
                <div className="w-full flex items-center gap-4 bg-white/[0.02] border border-white/[0.08] rounded-xl p-4 hover:border-white/20 hover:bg-white/[0.04] transition-all">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${node.color} flex items-center justify-center flex-shrink-0`}>
                    <node.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{node.label}</p>
                    <p className="text-xs text-white/40">{node.sub}</p>
                  </div>
                </div>
                {i < 4 && (
                  <div className="flex flex-col items-center py-1.5">
                    <div className="w-px h-4 bg-white/10" />
                    <ArrowDown className="w-3 h-3 text-white/20" />
                    <div className="w-px h-4 bg-white/10" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Human Control Callout */}
          <div className="mt-12 max-w-2xl mx-auto">
            <div className="flex items-start gap-4 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
              <Shield className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white mb-1">Leadership stays in command</p>
                <p className="text-sm text-white/40 leading-relaxed">
                  AI departments discover where they can create value. Every outreach, proposal, and action
                  is prepared by the department and reviewed by a human before it goes anywhere.
                  No autonomous sends. No surprises.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-white/[0.05] text-white/50 border-white/10 text-xs uppercase tracking-widest">Get Started</Badge>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">How It Works</h2>
            <p className="text-white/40 text-lg max-w-xl mx-auto">Four steps from setup to executive insight.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.step} className="relative group" data-testid={`card-step-${step.step}`}>
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="hidden lg:block absolute top-6 left-full w-full h-px bg-gradient-to-r from-white/10 to-transparent z-10" />
                )}
                <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-7 h-full hover:border-white/20 hover:bg-white/[0.04] transition-all">
                  <div className="text-5xl font-black text-white/[0.04] mb-4 font-mono">{step.step}</div>
                  <h3 className="text-base font-bold text-white mb-3">{step.title}</h3>
                  <p className="text-sm text-white/40 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 px-6 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-500/[0.08] rounded-3xl blur-2xl" />
            <div className="relative bg-gradient-to-b from-white/[0.05] to-white/[0.02] border border-white/[0.10] rounded-2xl p-16">
              <Badge className="mb-6 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs uppercase tracking-widest">
                Ready to deploy
              </Badge>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
                Deploy Your First<br className="hidden md:block" /> AI Department
              </h2>
              <p className="text-white/40 text-lg mb-10 leading-relaxed max-w-xl mx-auto">
                Start with Opportunity Acquisition, Hiring, Partnerships, or Sponsorships —
                then let the system surface what needs your attention.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/">
                  <Button size="lg" className="bg-emerald-600 hover:bg-emerald-500 text-white border-0 px-10 h-12 text-sm font-semibold" data-testid="button-cta-primary">
                    Get Started
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
                <Link href="/">
                  <Button size="lg" variant="outline" className="border-white/20 text-white bg-transparent hover:bg-white/[0.05] px-10 h-12 text-sm" data-testid="button-cta-login">
                    Login
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06] px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-semibold text-white/50">TrainEfficiency</span>
          </div>
          <p className="text-xs text-white/20">AI departments discover where they can create value. Leadership stays in command.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy"><span className="text-xs text-white/30 hover:text-white/50 cursor-pointer">Privacy</span></Link>
            <Link href="/terms"><span className="text-xs text-white/30 hover:text-white/50 cursor-pointer">Terms</span></Link>
            <Link href="/"><span className="text-xs text-white/30 hover:text-white/50 cursor-pointer">Login</span></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
