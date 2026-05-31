import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Star, Users, Zap, DollarSign, ArrowUpRight } from "lucide-react";

function n(v: unknown) { return Number(v ?? 0); }

function RankBadge({ rank }: { rank: number }) {
  const bg = rank === 0 ? "bg-yellow-500 text-black" : rank === 1 ? "bg-slate-300 text-black" : rank === 2 ? "bg-amber-600 text-white" : "bg-slate-700 text-muted-foreground";
  return <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${bg}`}>{rank + 1}</div>;
}

function LeaderboardCard({ title, icon, items, metricKey, metricLabel, testPrefix }: {
  title: string; icon: React.ReactNode; items: any[]; metricKey: string; metricLabel: string; testPrefix: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">{icon}{title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0
          ? <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
          : items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0" data-testid={`${testPrefix}-${i}`}>
              <RankBadge rank={i} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.name ?? item.agentId ?? item.developerId ?? item.orgId ?? item.id ?? "—"}</p>
                {item.subtitle && <p className="text-xs text-muted-foreground">{item.subtitle}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-primary">{item[metricKey] ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{metricLabel}</p>
              </div>
            </div>
          ))
        }
      </CardContent>
    </Card>
  );
}

export default function CommunityLeaderboards() {
  const { data: lb }      = useQuery<any>({ queryKey: ["/api/platform/agent-economy-leaderboard"] });
  const { data: ps }      = useQuery<any>({ queryKey: ["/api/platform/participant-success"] });
  const { data: ref }     = useQuery<any>({ queryKey: ["/api/platform/referral-growth"] });
  const { data: score }   = useQuery<any>({ queryKey: ["/api/platform/activation-score"] });

  const topReviewers = (ps?.activeReviewers ?? []).map((r: any) => ({ ...r, name: r.orgId }));
  const topReferrers = (ps?.activeReferrers ?? []).map((r: any) => ({ ...r, name: `${r.id} (${r.type})` }));
  const topRevOrgs   = (ps?.orgsGeneratingValue ?? []).map((o: any) => ({ ...o, name: o.orgId, installs: o.installs }));
  const topDevRevPro = (ps?.devsGeneratingInstalls ?? []).map((d: any) => ({ ...d, name: d.devId, earned: `$${d.earned}`, subtitle: `${d.installs} installs` }));

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="page-title-leaderboards">Community Leaderboards</h1>
          <p className="text-sm text-muted-foreground mt-1">Developers · Organizations · Agents · Referrers</p>
        </div>
        {score && (
          <Badge className="border border-primary/30 bg-primary/10 text-primary font-semibold">
            Ecosystem: {score.status} · {score.score}/100 ({score.grade})
          </Badge>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Top Developer Installs", val: lb?.topDevelopers?.[0]?.totalInstalls ?? 0, icon: <Users className="h-4 w-4 text-primary" /> },
          { label: "Top Agent Installs",     val: lb?.topByInstalls?.[0]?.installs ?? 0,      icon: <Zap className="h-4 w-4 text-yellow-400" /> },
          { label: "Top Reviewer Count",     val: topReviewers[0]?.reviews ?? 0,              icon: <Star className="h-4 w-4 text-yellow-400" /> },
          { label: "Total Referrals",        val: n(ref?.invitations?.total),                 icon: <ArrowUpRight className="h-4 w-4 text-emerald-400" /> },
        ].map((s, i) => (
          <Card key={i} className="bg-card border-border" data-testid={`lb-summary-${i}`}>
            <CardContent className="p-4 flex items-center gap-3">
              {s.icon}
              <div><p className="text-xl font-bold text-foreground">{s.val}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="agents">
        <TabsList className="grid grid-cols-3 md:grid-cols-6 h-auto gap-1 bg-muted/40 p-1">
          <TabsTrigger value="agents"     className="text-xs" data-testid="tab-lb-agents">Top Agents</TabsTrigger>
          <TabsTrigger value="developers" className="text-xs" data-testid="tab-lb-developers">Developers</TabsTrigger>
          <TabsTrigger value="orgs"       className="text-xs" data-testid="tab-lb-orgs">Organizations</TabsTrigger>
          <TabsTrigger value="reviewers"  className="text-xs" data-testid="tab-lb-reviewers">Reviewers</TabsTrigger>
          <TabsTrigger value="referrers"  className="text-xs" data-testid="tab-lb-referrers">Referrers</TabsTrigger>
          <TabsTrigger value="revenue"    className="text-xs" data-testid="tab-lb-revenue">Revenue</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <LeaderboardCard title="Most Installed" icon={<Zap className="h-4 w-4 text-primary" />}
            items={(lb?.topByInstalls ?? []).map((a: any) => ({ ...a }))}
            metricKey="installs" metricLabel="installs" testPrefix="agent-install" />
          <LeaderboardCard title="Highest Rated" icon={<Star className="h-4 w-4 text-yellow-400" />}
            items={(lb?.topByRating ?? []).map((a: any) => ({ ...a, subtitle: `${a.reviews} reviews` }))}
            metricKey="avgRating" metricLabel="stars" testPrefix="agent-rating" />
          <LeaderboardCard title="Most Trusted" icon={<Trophy className="h-4 w-4 text-blue-400" />}
            items={lb?.topByTrust ?? []}
            metricKey="trustScore" metricLabel="trust" testPrefix="agent-trust" />
          <LeaderboardCard title="Top Revenue" icon={<DollarSign className="h-4 w-4 text-primary" />}
            items={(lb?.topByRevenue ?? []).map((a: any) => ({ ...a, revenue: `$${a.revenue}` }))}
            metricKey="revenue" metricLabel="revenue" testPrefix="agent-revenue" />
        </TabsContent>

        <TabsContent value="developers" className="mt-4">
          <LeaderboardCard title="Top Developers by Royalties" icon={<Trophy className="h-4 w-4 text-yellow-400" />}
            items={(lb?.topDevelopers ?? []).map((d: any) => ({
              ...d, name: d.developerId,
              subtitle: `${d.agentsPublished} agents · ${d.totalInstalls} installs`,
              lifetimeEarned: `$${d.lifetimeEarned}`,
            }))}
            metricKey="lifetimeEarned" metricLabel="earned" testPrefix="dev-lb" />
        </TabsContent>

        <TabsContent value="orgs" className="mt-4">
          <LeaderboardCard title="Top Organizations by Installs" icon={<Users className="h-4 w-4 text-primary" />}
            items={topRevOrgs}
            metricKey="installs" metricLabel="installs" testPrefix="org-lb" />
        </TabsContent>

        <TabsContent value="reviewers" className="mt-4">
          <LeaderboardCard title="Most Active Reviewers" icon={<Star className="h-4 w-4 text-yellow-400" />}
            items={topReviewers}
            metricKey="reviews" metricLabel="reviews" testPrefix="reviewer-lb" />
        </TabsContent>

        <TabsContent value="referrers" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Referrals",    val: n(ref?.invitations?.total) },
              { label: "Conversion Rate",    val: `${n(ref?.rates?.overall)}%` },
              { label: "Referral Revenue",   val: `$${n(ref?.revenue?.total)}` },
            ].map((s, i) => (
              <Card key={i} className="bg-card border-border"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-bold text-primary">{s.val}</p></CardContent></Card>
            ))}
          </div>
          <LeaderboardCard title="Top Referrers" icon={<ArrowUpRight className="h-4 w-4 text-emerald-400" />}
            items={topReferrers}
            metricKey="count" metricLabel="referrals" testPrefix="referrer-lb" />
        </TabsContent>

        <TabsContent value="revenue" className="mt-4">
          <LeaderboardCard title="Top Revenue Producers" icon={<DollarSign className="h-4 w-4 text-primary" />}
            items={topDevRevPro}
            metricKey="earned" metricLabel="lifetime earned" testPrefix="revenue-lb" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
