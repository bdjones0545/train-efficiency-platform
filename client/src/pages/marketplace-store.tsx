import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Store, ArrowLeft, Star, Package, DollarSign, Shield, Award,
  Users, TrendingUp, Search, ChevronDown, ChevronUp, RefreshCw,
  CheckCircle2, BarChart3, MessageSquare, Plus,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  "All",
  "Growth",
  "Retention",
  "Scheduling",
  "Communications",
  "Research",
  "Operations",
  "Executive",
  "Analytics",
  "Recruiting",
  "Sales",
];

const DEPT_TO_CATEGORY: Record<string, string> = {
  "Revenue": "Growth",
  "Growth": "Growth",
  "Retention": "Retention",
  "Communications": "Communications",
  "Intelligence": "Research",
  "Research": "Research",
  "Operations": "Operations",
  "Executive": "Executive",
  "Analytics": "Analytics",
  "Recruiting": "Recruiting",
};

const CERT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  platform_recommended: { label: "Platform Recommended", color: "text-yellow-300", bg: "bg-yellow-500/10 border-yellow-500/30" },
  elite_performer:      { label: "Elite Performer",      color: "text-purple-300", bg: "bg-purple-500/10 border-purple-500/30" },
  high_performer:       { label: "High Performer",       color: "text-blue-300",   bg: "bg-blue-500/10 border-blue-500/30" },
  certified:            { label: "Certified",            color: "text-green-300",  bg: "bg-green-500/10 border-green-500/30" },
  uncertified:          { label: "Uncertified",          color: "text-gray-400",   bg: "bg-gray-500/10 border-gray-500/30" },
};

function StarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-3 w-3 ${i <= Math.round(rating) ? "text-yellow-400 fill-yellow-400" : "text-gray-600"}`} />
      ))}
      <span className="text-xs text-gray-400 ml-1">{rating > 0 ? `${rating.toFixed(1)} (${count})` : "No reviews"}</span>
    </div>
  );
}

function AgentStorePage({ agent, reviews, reputation, onInstall, installing, onReview }: any) {
  const [expanded, setExpanded] = useState(false);
  const cert = CERT_CONFIG[agent.certificationLevel] ?? CERT_CONFIG.uncertified;
  const agentReviews = (reviews ?? []).filter((r: any) => r.agentId === agent.agentId);
  const repData = (reputation ?? []).find((r: any) => r.agentId === agent.agentId);

  return (
    <Card className="bg-gray-900 border-gray-800 hover:border-gray-600 transition-colors"
      data-testid={`store-card-${agent.agentId}`}>
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-white text-sm">{agent.agentName}</h3>
              <Badge variant="outline" className="text-xs text-gray-400 border-gray-600">{agent.department}</Badge>
            </div>
            <Badge className={`text-xs border ${cert.bg} ${cert.color}`}>{cert.label}</Badge>
          </div>
          <div className="text-center flex-shrink-0">
            <p className="text-xl font-bold text-white">{agent.benchmarkScore || "—"}</p>
            <p className="text-xs text-gray-500">Score</p>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-gray-400 leading-relaxed mb-3">{agent.description?.substring(0, 120)}...</p>

        {/* Rating */}
        <StarRating rating={repData?.avgRating ?? 0} count={repData?.reviewCount ?? 0} />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mt-3 mb-3">
          <div className="bg-gray-800 rounded p-2 text-center">
            <p className="text-xs text-gray-500">ROI</p>
            <p className="text-sm font-bold text-green-400">{agent.averageRoi > 0 ? `${agent.averageRoi}x` : "—"}</p>
          </div>
          <div className="bg-gray-800 rounded p-2 text-center">
            <p className="text-xs text-gray-500">Success</p>
            <p className="text-sm font-bold text-blue-400">{agent.averageSuccessRate > 0 ? `${agent.averageSuccessRate}%` : "—"}</p>
          </div>
          <div className="bg-gray-800 rounded p-2 text-center">
            <p className="text-xs text-gray-500">Installs</p>
            <p className="text-sm font-bold text-gray-300">{agent.installationCount}</p>
          </div>
        </div>

        {/* Expand */}
        <button onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 mb-3">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Less" : "Full details"} · {(agent.capabilities ?? []).length} capabilities · {agentReviews.length} reviews
        </button>

        {expanded && (
          <div className="space-y-3 mb-3 border-t border-gray-800 pt-3">
            {/* Capabilities */}
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Capabilities</p>
              <div className="flex flex-wrap gap-1">
                {(agent.capabilities ?? []).map((c: string, i: number) => (
                  <Badge key={i} className="text-xs bg-gray-700 text-gray-300 border-none">{c}</Badge>
                ))}
              </div>
            </div>

            {/* Industries */}
            {(agent.supportedIndustries ?? []).length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Industries</p>
                <div className="flex flex-wrap gap-1">
                  {(agent.supportedIndustries ?? []).map((ind: string, i: number) => (
                    <Badge key={i} className="text-xs bg-gray-800 text-gray-400 border-gray-700 border">{ind}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews */}
            {agentReviews.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Reviews</p>
                <div className="space-y-2">
                  {agentReviews.slice(0, 2).map((rev: any, i: number) => (
                    <div key={i} className="p-2 bg-gray-800 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <StarRating rating={rev.rating} count={0} />
                        {rev.verifiedUsage && <Badge className="text-xs bg-green-500/10 text-green-400 border-none h-4 px-1">Verified</Badge>}
                      </div>
                      {rev.review && <p className="text-xs text-gray-400">{rev.review}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reputation */}
            {repData && (
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Reputation</p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-white font-bold">{repData.reputationScore}/100</span>
                  <span className="text-gray-400">{repData.trustTier}</span>
                  <span className="text-gray-500">Rank #{repData.marketplaceRank}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 bg-indigo-600 hover:bg-indigo-700 h-8 text-xs"
            onClick={() => onInstall(agent)} disabled={installing}
            data-testid={`button-store-install-${agent.agentId}`}>
            <Package className="h-3.5 w-3.5 mr-1.5" />Install
          </Button>
          <Button size="sm" variant="outline" className="border-gray-700 text-gray-400 h-8 text-xs"
            onClick={() => onReview(agent.agentId)}
            data-testid={`button-review-${agent.agentId}`}>
            <MessageSquare className="h-3.5 w-3.5 mr-1" />Review
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MarketplaceStore() {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState({ rating: 5, review: "", easeOfUse: 4, businessImpact: 4, reliability: 4 });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: agents = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/marketplace/agents"],
    queryFn: () => fetch("/api/marketplace/agents").then(r => r.json()),
    initialData: [],
  });

  const { data: reviews = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/reviews"],
    queryFn: () => fetch("/api/marketplace/reviews").then(r => r.json()),
    initialData: [],
  });

  const { data: reputation = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/reputation"],
    queryFn: () => fetch("/api/marketplace/reputation").then(r => r.json()),
    initialData: [],
  });

  const install = useMutation({
    mutationFn: (agent: any) => apiRequest("POST", "/api/marketplace/install", { agentId: agent.agentId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/marketplace"] }); toast({ title: "Agent installed" }); },
  });

  const submitReview = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/marketplace/reviews", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/reviews"] });
      setReviewTarget(null);
      toast({ title: "Review submitted" });
    },
  });

  const filtered = agents.filter(a => {
    const matchCat = category === "All" || (DEPT_TO_CATEGORY[a.department] ?? a.department) === category;
    const matchSearch = !search || a.agentName.toLowerCase().includes(search.toLowerCase()) ||
      a.description?.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/agent-marketplace">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-1" /> Marketplace
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Store className="h-6 w-6 text-indigo-400" />
              Agent Store
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">{agents.length} agents available — benchmarked, certified, installable</p>
          </div>
        </div>
        <Link href="/developer">
          <Button variant="outline" size="sm" className="border-emerald-700 text-emerald-400">
            <Plus className="h-4 w-4 mr-1.5" />Publish Agent
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search agents..." className="bg-gray-900 border-gray-700 pl-9"
          data-testid="input-store-search" />
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(cat => (
          <Button key={cat} size="sm" onClick={() => setCategory(cat)}
            className={`h-7 px-3 text-xs ${category === cat ? "bg-indigo-600 hover:bg-indigo-700" : "bg-gray-800 hover:bg-gray-700 text-gray-300"}`}
            data-testid={`button-category-${cat.toLowerCase()}`}>
            {cat}
          </Button>
        ))}
      </div>

      {/* Review Modal */}
      {reviewTarget && (
        <Card className="bg-gray-900 border-indigo-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-indigo-400" />Write a Review</span>
              <Button size="sm" variant="ghost" className="text-gray-400 h-7" onClick={() => setReviewTarget(null)}>✕</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-gray-400 mb-2">Overall Rating</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <button key={i} onClick={() => setReviewForm(f => ({ ...f, rating: i }))}>
                    <Star className={`h-6 w-6 ${i <= reviewForm.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-600"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-2">Review (optional)</p>
              <Textarea value={reviewForm.review} onChange={e => setReviewForm(f => ({ ...f, review: e.target.value }))}
                className="bg-gray-800 border-gray-700 text-sm h-24" placeholder="Share your experience..."
                data-testid="input-review-text" />
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { key: "easeOfUse", label: "Ease of Use" },
                { key: "businessImpact", label: "Business Impact" },
                { key: "reliability", label: "Reliability" },
              ].map(field => (
                <div key={field.key}>
                  <p className="text-gray-400 mb-1">{field.label}</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(i => (
                      <button key={i} onClick={() => setReviewForm(f => ({ ...f, [field.key]: i }))}>
                        <Star className={`h-4 w-4 ${i <= (reviewForm as any)[field.key] ? "text-yellow-400 fill-yellow-400" : "text-gray-600"}`} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700"
                onClick={() => submitReview.mutate({ agentId: reviewTarget, ...reviewForm })}
                disabled={submitReview.isPending} data-testid="button-submit-review">
                <CheckCircle2 className="h-4 w-4 mr-1.5" />Submit Review
              </Button>
              <Button size="sm" variant="ghost" className="text-gray-400" onClick={() => setReviewTarget(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-60 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-10 text-center">
            <Store className="h-12 w-12 mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">{search ? `No agents match "${search}"` : `No agents in ${category} category`}</p>
            <p className="text-xs text-gray-600 mt-1">Try a different category or refresh benchmarks in the marketplace</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((agent: any) => (
            <AgentStorePage
              key={agent.agentId}
              agent={agent}
              reviews={reviews}
              reputation={reputation}
              onInstall={install.mutate}
              installing={install.isPending}
              onReview={setReviewTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}
