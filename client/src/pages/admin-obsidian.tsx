import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchJson } from "@/lib/api-helpers";
import {
  BookOpen, Search, RefreshCw, CheckCircle, XCircle, FileText, Eye,
  Brain, Activity, FolderOpen, Upload, AlertTriangle, ExternalLink,
  ChevronRight, Layers, Link2, Zap, TrendingUp, Wrench, Lightbulb,
  BookMarked, GitBranch, Database, BarChart3,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ObsidianStatus {
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  notesCreatedToday: number;
  searchesPerformed: number;
  vaultName?: string;
  version?: string;
}

interface VaultStats {
  totalNotes: number;
  byFolder: Record<string, number>;
  byType: Record<string, number>;
}

interface SearchResult {
  filename: string;
  folder: string;
  title: string;
  score: number;
  matches: Array<{ context: string }>;
}

interface SimilarNote {
  filename: string;
  score: number;
  context: string;
  folder: string;
  title: string;
}

const NOTE_TYPES = [
  { value: "",                    label: "All Types" },
  { value: "ceo_heartbeat",       label: "CEO Heartbeat" },
  { value: "agent_decision",      label: "Agent Decisions" },
  { value: "hermes_learning",     label: "Hermes Learnings" },
  { value: "software_improvement",label: "Software Improvements" },
  { value: "software_kb",         label: "Software KB" },
  { value: "decision_journal",    label: "Decision Journal" },
  { value: "revenue_intelligence",label: "Revenue Intelligence" },
  { value: "growth_intelligence", label: "Growth Intelligence" },
  { value: "daily_report",        label: "Daily Reports" },
  { value: "weekly_report",       label: "Weekly Reports" },
];

const FOLDERS = [
  { key: "CEO Heartbeat",          emoji: "💓" },
  { key: "Agent Decisions",        emoji: "🤖" },
  { key: "Software Improvements",  emoji: "🔧" },
  { key: "Software KB",            emoji: "📚" },
  { key: "Hermes Learning",        emoji: "🧠" },
  { key: "Decision Journal",       emoji: "📔" },
  { key: "Revenue Intelligence",   emoji: "💰" },
  { key: "Growth Intelligence",    emoji: "📈" },
  { key: "Scheduling Intelligence",emoji: "📅" },
  { key: "Client Success",         emoji: "🏆" },
  { key: "SOPs",                   emoji: "📋" },
  { key: "Daily Reports",          emoji: "📰" },
  { key: "Weekly Reports",         emoji: "📊" },
];

const folderEmoji = (folder: string) =>
  FOLDERS.find(f => f.key === folder)?.emoji || "📄";

// ─── Shared: Note Viewer ──────────────────────────────────────────────────────
function NoteViewer({
  file, content, onBack, backLabel,
}: { file: string; content: string; onBack: () => void; backLabel?: string }) {
  const { toast } = useToast();
  const parts = file.split("/");
  const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  const title = parts[parts.length - 1].replace(".md", "");

  const similarMutation = useMutation<{ results: SimilarNote[] }, Error, void>({
    mutationFn: () =>
      apiRequest("POST", "/api/obsidian/similar", { content, sourceFilename: file }).then(r => r.json()),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-note">
          ← {backLabel || "Back"}
        </Button>
        <Badge variant="outline" className="text-xs truncate max-w-[180px]">{folderEmoji(folder)} {folder}</Badge>
        <div className="flex gap-1.5 ml-auto">
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(content); toast({ title: "Copied" }); }}>
            Copy
          </Button>
          {!similarMutation.data && (
            <Button variant="outline" size="sm" onClick={() => similarMutation.mutate()} disabled={similarMutation.isPending} data-testid="button-find-similar">
              {similarMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Link2 className="h-3.5 w-3.5 mr-1" />}
              Similar
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto max-h-[52vh] whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </CardContent>
      </Card>

      {similarMutation.data && similarMutation.data.results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" /> Related Memory ({similarMutation.data.results.length})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {similarMutation.data.results.map((n, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border bg-card text-xs" data-testid={`card-similar-${i}`}>
                <span>{folderEmoji(n.folder)}</span>
                <div className="min-w-0">
                  <p className="font-medium truncate">{n.title}</p>
                  <p className="text-muted-foreground text-[10px] truncate">{n.folder}</p>
                  {n.context && <p className="text-muted-foreground line-clamp-1 mt-0.5">…{n.context}…</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {similarMutation.data && similarMutation.data.results.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">No similar notes found in vault.</p>
      )}
    </div>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────
function DashboardTab() {
  const { data: status } = useQuery<ObsidianStatus>({
    queryKey: ["/api/obsidian/status"], staleTime: 30_000,
  });
  const { data: stats, isLoading: statsLoading, refetch: refetchStats, isFetching } = useQuery<VaultStats>({
    queryKey: ["/api/obsidian/stats"], staleTime: 60_000,
  });

  if (!status?.configured) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
        <div className="flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Obsidian not configured</p>
            <p className="text-xs text-muted-foreground mt-1">Set OBSIDIAN_BASE_URL and OBSIDIAN_API_KEY in Replit Secrets.</p>
          </div>
        </div>
      </div>
    );
  }

  const topMetrics = [
    { label: "Total Notes",         value: stats?.totalNotes ?? "—",                          icon: Database,    color: "text-zinc-400" },
    { label: "Notes Today",         value: status.notesCreatedToday,                          icon: Activity,    color: "text-purple-400" },
    { label: "CEO Reports",         value: stats?.byType?.ceo_heartbeat ?? "—",               icon: Brain,       color: "text-blue-400" },
    { label: "Agent Decisions",     value: stats?.byType?.agent_decision ?? "—",              icon: Zap,         color: "text-amber-400" },
    { label: "Hermes Learnings",    value: stats?.byType?.hermes_learning ?? "—",             icon: Lightbulb,   color: "text-green-400" },
    { label: "Software Fixes",      value: (stats?.byType?.software_kb ?? 0) + (stats?.byType?.software_improvement ?? 0), icon: Wrench, color: "text-red-400" },
    { label: "Decision Journal",    value: stats?.byType?.decision_journal ?? "—",            icon: BookMarked,  color: "text-indigo-400" },
    { label: "Vault Searches",      value: status.searchesPerformed,                          icon: Search,      color: "text-cyan-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Live vault metrics — AI workforce institutional memory</p>
        <Button variant="ghost" size="sm" onClick={() => refetchStats()} disabled={isFetching} data-testid="button-refresh-stats">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 p-3 rounded-lg border bg-card">
        {status.connected
          ? <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{status.connected ? "Memory layer connected" : "Offline"}</p>
          <p className="text-xs text-muted-foreground truncate">
            {status.vaultName && `${status.vaultName} · `}
            {status.version && `Obsidian ${status.version} · `}
            {status.lastSyncAt
              ? `Last sync ${new Date(status.lastSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
              : "No syncs yet"}
          </p>
        </div>
        <Badge variant={status.connected ? "default" : "destructive"} className="text-xs shrink-0">
          {status.connected ? "Live" : "Offline"}
        </Badge>
      </div>

      {/* Metric grid */}
      {statsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[1,2,3,4,5,6,7,8].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {topMetrics.map(m => {
            const Icon = m.icon;
            return (
              <div key={m.label} className="rounded-lg border bg-card p-3 text-center" data-testid={`stat-${m.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className={`h-4 w-4 mx-auto mb-1 ${m.color}`} />
                <p className={`text-2xl font-bold leading-none ${m.color}`}>{m.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{m.label}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Folder breakdown */}
      {stats && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Folder Breakdown</p>
          <div className="space-y-1.5">
            {FOLDERS.filter(f => (stats.byFolder[f.key] || 0) > 0).map(f => {
              const count = stats.byFolder[f.key] || 0;
              const pct = stats.totalNotes > 0 ? Math.round((count / stats.totalNotes) * 100) : 0;
              return (
                <div key={f.key} className="flex items-center gap-2" data-testid={`folder-stat-${f.key.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="text-sm w-5 text-center">{f.emoji}</span>
                  <p className="text-xs text-muted-foreground w-40 truncate">{f.key}</p>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground w-6 text-right">{count}</p>
                </div>
              );
            })}
            {stats.totalNotes === 0 && (
              <div className="text-center py-6 text-muted-foreground">
                <Database className="h-8 w-8 mx-auto opacity-30 mb-2" />
                <p className="text-sm">Vault is empty — notes will appear automatically as agents run.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Search Tab ───────────────────────────────────────────────────────────────
function SearchTab() {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [selectedNote, setSelectedNote] = useState<{ file: string; content: string } | null>(null);
  const { toast } = useToast();

  const searchMutation = useMutation<{ results: SearchResult[]; total: number }, Error, void>({
    mutationFn: () =>
      apiRequest("POST", "/api/obsidian/search", {
        query,
        typeFilter: typeFilter || undefined,
        agentFilter: agentFilter || undefined,
      }).then(r => r.json()),
  });

  const readMutation = useMutation<{ content: string }, Error, { folder: string; title: string }>({
    mutationFn: ({ folder, title }) =>
      fetchJson(`/api/obsidian/read?folder=${encodeURIComponent(folder)}&title=${encodeURIComponent(title)}`),
  });

  const openNote = async (r: SearchResult) => {
    const result = await readMutation.mutateAsync({ folder: r.folder, title: r.title });
    if (result.content) setSelectedNote({ file: r.filename, content: result.content });
    else toast({ title: "Could not open note", variant: "destructive" });
  };

  if (selectedNote) {
    return <NoteViewer file={selectedNote.file} content={selectedNote.content} onBack={() => setSelectedNote(null)} backLabel="Search" />;
  }

  const results = searchMutation.data?.results || [];

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && query.trim() && searchMutation.mutate()}
            placeholder="Search all institutional memory..."
            data-testid="input-memory-search"
            className="flex-1"
          />
          <Button onClick={() => searchMutation.mutate()} disabled={searchMutation.isPending || !query.trim()} data-testid="button-search-memory">
            {searchMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-type-filter">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {NOTE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            placeholder="Filter by agent..."
            className="h-8 text-xs"
            data-testid="input-agent-filter"
          />
        </div>
      </div>

      {/* Results */}
      {searchMutation.isSuccess && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No results for "{query}"</p>
      )}

      {searchMutation.isSuccess && results.length > 0 && (
        <p className="text-xs text-muted-foreground">{searchMutation.data?.total} results</p>
      )}

      <div className="space-y-1.5">
        {results.map((r, i) => (
          <Card
            key={i}
            className="cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => openNote(r)}
            data-testid={`card-result-${i}`}
          >
            <CardContent className="py-2.5 px-3">
              <div className="flex items-start gap-2">
                <span className="text-base shrink-0">{folderEmoji(r.folder)}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium truncate">{r.title}</p>
                  <p className="text-[10px] text-muted-foreground">{r.folder}</p>
                  {r.matches?.slice(0, 1).map((m, j) => (
                    <p key={j} className="text-xs text-muted-foreground line-clamp-1">…{m.context}…</p>
                  ))}
                </div>
                <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Vault Browser Tab ────────────────────────────────────────────────────────
function VaultTab() {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [selectedNote, setSelectedNote] = useState<{ file: string; content: string } | null>(null);
  const { toast } = useToast();

  const { data: vaultData, isLoading, refetch, isFetching } = useQuery<{ files: string[] }>({
    queryKey: ["/api/obsidian/vault"], staleTime: 60_000,
  });

  const readMutation = useMutation<{ content: string }, Error, { folder: string; title: string }>({
    mutationFn: ({ folder, title }) =>
      fetchJson(`/api/obsidian/read?folder=${encodeURIComponent(folder)}&title=${encodeURIComponent(title)}`),
  });

  const allFiles = vaultData?.files || [];
  const filesByFolder = FOLDERS.reduce((acc, f) => {
    acc[f.key] = allFiles.filter(file => file.startsWith(f.key + "/"));
    return acc;
  }, {} as Record<string, string[]>);

  const folderFiles = selectedFolder
    ? (filesByFolder[selectedFolder] || []).filter(f => f.toLowerCase().includes(filterText.toLowerCase()))
    : [];

  const openFile = async (filename: string) => {
    const parts = filename.replace(".md", "").split("/");
    const title = parts[parts.length - 1];
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const result = await readMutation.mutateAsync({ folder, title });
    if (result.content) setSelectedNote({ file: filename, content: result.content });
    else toast({ title: "Could not open note", variant: "destructive" });
  };

  if (selectedNote) {
    return (
      <NoteViewer
        file={selectedNote.file}
        content={selectedNote.content}
        onBack={() => setSelectedNote(null)}
        backLabel={selectedFolder || "Vault"}
      />
    );
  }

  if (selectedFolder) {
    const meta = FOLDERS.find(f => f.key === selectedFolder)!;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFolder(null)} data-testid="button-back-folders">← Folders</Button>
          <span className="font-medium text-sm">{meta.emoji} {selectedFolder}</span>
          <Badge variant="secondary" className="text-xs">{folderFiles.length} notes</Badge>
        </div>
        <Input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter…" className="h-8 text-xs" data-testid="input-folder-filter" />
        {folderFiles.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground space-y-1">
            <FolderOpen className="h-8 w-8 mx-auto opacity-30" />
            <p className="text-sm">No notes yet. Agents will write here automatically.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {folderFiles.map((f, i) => {
              const name = f.split("/").pop()?.replace(".md", "") || f;
              return (
                <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg border bg-card hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => openFile(f)} data-testid={`row-file-${i}`}>
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-sm font-medium flex-1 truncate">{name}</p>
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Select a folder to browse agent notes</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-vault">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2">{[1,2,3,4].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FOLDERS.map(f => {
            const count = filesByFolder[f.key]?.length || 0;
            return (
              <button key={f.key} onClick={() => setSelectedFolder(f.key)} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/40 text-left transition-colors" data-testid={`card-folder-${f.key.toLowerCase().replace(/\s+/g, "-")}`}>
                <span className="text-xl">{f.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{f.key}</p>
                  <p className="text-xs text-muted-foreground">{count} note{count !== 1 ? "s" : ""}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Hermes Learning Tab ──────────────────────────────────────────────────────
function HermesTab() {
  const [form, setForm] = useState({ outcome: "", observation: "", learning: "", domain: "", metric: "", metricValue: "" });
  const { toast } = useToast();

  const domains = ["Lead Generation", "Email Outreach", "Booking Conversion", "Client Retention", "Team Training", "Revenue", "Scheduling", "Software"];

  const learnMutation = useMutation({
    mutationFn: (body: typeof form) => apiRequest("POST", "/api/obsidian/learn", body).then(r => r.json()),
    onSuccess: (d) => {
      if (d.success) {
        toast({ title: "Learning recorded in Obsidian" });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/status"] });
        setForm({ outcome: "", observation: "", learning: "", domain: "", metric: "", metricValue: "" });
      } else {
        toast({ title: "Failed to record learning", variant: "destructive" });
      }
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const canSubmit = form.outcome && form.observation && form.learning && form.domain;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 space-y-1">
        <p className="text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5" /> Hermes Learning Pipeline
        </p>
        <p className="text-xs text-muted-foreground">
          Outcome → Observation → Learning → Obsidian. Converts real results into reusable institutional knowledge.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Domain *</Label>
          <Select value={form.domain} onValueChange={v => setForm(f => ({ ...f, domain: v }))}>
            <SelectTrigger data-testid="select-domain"><SelectValue placeholder="Select domain" /></SelectTrigger>
            <SelectContent>{domains.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Metric (optional)</Label>
          <div className="flex gap-1.5">
            <Input value={form.metric} onChange={set("metric")} placeholder="e.g. Booking rate" className="flex-1" data-testid="input-metric-name" />
            <Input value={form.metricValue} onChange={set("metricValue")} placeholder="e.g. +31%" className="w-20" data-testid="input-metric-value" />
          </div>
        </div>
      </div>

      {[
        { key: "outcome" as const, label: "Outcome *", placeholder: "e.g. Lead source converted at 42%" },
        { key: "observation" as const, label: "Observation *", placeholder: "e.g. Parents responded best to athlete stories" },
        { key: "learning" as const, label: "Learning (reusable) *", placeholder: "e.g. Use athlete transformation stories in all parent-facing outreach" },
      ].map(({ key, label, placeholder }) => (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs">{label}</Label>
          <Textarea value={form[key]} onChange={set(key)} placeholder={placeholder} className="min-h-[80px] text-sm" data-testid={`textarea-${key}`} />
        </div>
      ))}

      <Button onClick={() => learnMutation.mutate(form)} disabled={learnMutation.isPending || !canSubmit} className="w-full" data-testid="button-record-learning">
        {learnMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Brain className="h-4 w-4 mr-2" />}
        Record Learning to Memory
      </Button>
    </div>
  );
}

// ─── Decision Journal Tab ─────────────────────────────────────────────────────
function DecisionTab() {
  const [form, setForm] = useState({ decision: "", reasoning: "", outcome: "", followUp: "", agent: "", confidence: "" });
  const { toast } = useToast();

  const agents = [
    "CEO Heartbeat Agent", "Auto-Execution Engine", "Hermes Learning Engine",
    "Software Improvement Agent", "Revenue Intelligence", "Growth Intelligence",
    "Scheduling Agent", "Human (Manual)",
  ];

  const decisionMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/obsidian/decision", body).then(r => r.json()),
    onSuccess: (d) => {
      if (d.success) {
        toast({ title: "Decision recorded in journal" });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/status"] });
        setForm({ decision: "", reasoning: "", outcome: "", followUp: "", agent: "", confidence: "" });
      } else {
        toast({ title: "Failed to record decision", variant: "destructive" });
      }
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const canSubmit = form.decision && form.reasoning && form.agent;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-1">
        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
          <BookMarked className="h-3.5 w-3.5" /> Decision Journal
        </p>
        <p className="text-xs text-muted-foreground">
          Every executive recommendation stored with Decision / Reasoning / Outcome / Follow-up. Permanent operating history.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Agent / Decision Maker *</Label>
          <Select value={form.agent} onValueChange={v => setForm(f => ({ ...f, agent: v }))}>
            <SelectTrigger data-testid="select-decision-agent"><SelectValue placeholder="Select agent" /></SelectTrigger>
            <SelectContent>{agents.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Confidence %</Label>
          <Input value={form.confidence} onChange={set("confidence")} placeholder="e.g. 87" type="number" min="0" max="100" data-testid="input-confidence" />
        </div>
      </div>

      {[
        { key: "decision" as const, label: "Decision *", placeholder: "What was decided?" },
        { key: "reasoning" as const, label: "Reasoning *", placeholder: "Why this decision was made, what data informed it..." },
        { key: "outcome" as const, label: "Outcome (optional)", placeholder: "What actually happened after this decision?" },
        { key: "followUp" as const, label: "Follow-Up (optional)", placeholder: "What action is required next?" },
      ].map(({ key, label, placeholder }) => (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs">{label}</Label>
          <Textarea value={form[key]} onChange={set(key)} placeholder={placeholder} className="min-h-[70px] text-sm" data-testid={`textarea-decision-${key}`} />
        </div>
      ))}

      <Button
        onClick={() => decisionMutation.mutate({ ...form, confidence: form.confidence ? parseInt(form.confidence) : undefined })}
        disabled={decisionMutation.isPending || !canSubmit}
        className="w-full"
        data-testid="button-record-decision"
      >
        {decisionMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <BookMarked className="h-4 w-4 mr-2" />}
        Record in Decision Journal
      </Button>
    </div>
  );
}

// ─── Software KB Tab ──────────────────────────────────────────────────────────
function SoftwareKBTab() {
  const [form, setForm] = useState({ issue: "", rootCause: "", fix: "", filesModified: "", outcome: "", severity: "medium" });
  const [searchQ, setSearchQ] = useState("");
  const { toast } = useToast();

  const kbMutation = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/obsidian/software-kb", body).then(r => r.json()),
    onSuccess: (d) => {
      if (d.success) {
        toast({ title: "Issue recorded in Software KB" });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/status"] });
        setForm({ issue: "", rootCause: "", fix: "", filesModified: "", outcome: "", severity: "medium" });
      } else {
        toast({ title: "Failed to write to KB", variant: "destructive" });
      }
    },
  });

  const searchMutation = useMutation<{ results: Array<{ filename: string; context: string; score: number }> }, Error, void>({
    mutationFn: () =>
      fetchJson(`/api/obsidian/software-kb/search?q=${encodeURIComponent(searchQ)}&limit=5`),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const canSubmit = form.issue && form.rootCause && form.fix && form.outcome;

  return (
    <div className="space-y-4">
      {/* Search existing KB */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5" /> Search KB Before Creating New Entry
        </p>
        <div className="flex gap-2">
          <Input value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === "Enter" && searchMutation.mutate()} placeholder="e.g. trailing slash, 404 error, drizzle..." className="flex-1 text-sm h-8" data-testid="input-kb-search" />
          <Button size="sm" variant="outline" onClick={() => searchMutation.mutate()} disabled={searchMutation.isPending || !searchQ} data-testid="button-kb-search">
            {searchMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {searchMutation.data?.results.map((r, i) => (
          <div key={i} className="text-xs rounded bg-muted/50 p-2 space-y-0.5" data-testid={`kb-result-${i}`}>
            <p className="font-medium truncate">{r.filename.split("/").pop()?.replace(".md", "")}</p>
            {r.context && <p className="text-muted-foreground line-clamp-2">{r.context}</p>}
          </div>
        ))}
        {searchMutation.data?.results.length === 0 && <p className="text-xs text-muted-foreground">No prior fixes found — safe to create new entry.</p>}
      </div>

      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1">
        <p className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5" /> Software Knowledge Base
        </p>
        <p className="text-xs text-muted-foreground">Structured issue/fix entries. Agents search this before creating new improvement tasks.</p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Severity</Label>
          <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
            <SelectTrigger data-testid="select-severity"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["critical", "high", "medium", "low"].map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {[
          { key: "issue" as const, label: "Issue *", placeholder: "What went wrong?" },
          { key: "rootCause" as const, label: "Root Cause *", placeholder: "Why did it happen?" },
          { key: "fix" as const, label: "Fix Applied *", placeholder: "What was done to resolve it?" },
          { key: "filesModified" as const, label: "Files Modified (comma-separated)", placeholder: "e.g. server/services/obsidian-service.ts, client/src/pages/admin.tsx" },
          { key: "outcome" as const, label: "Outcome *", placeholder: "Result after fix was applied?" },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            <Textarea value={form[key]} onChange={set(key)} placeholder={placeholder} className="min-h-[60px] text-sm" data-testid={`textarea-kb-${key}`} />
          </div>
        ))}
      </div>

      <Button
        onClick={() => kbMutation.mutate({ ...form, filesModified: form.filesModified ? form.filesModified.split(",").map(s => s.trim()).filter(Boolean) : [] })}
        disabled={kbMutation.isPending || !canSubmit}
        className="w-full"
        data-testid="button-write-kb"
      >
        {kbMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
        Write to Software KB
      </Button>
    </div>
  );
}

// ─── Write Tab ────────────────────────────────────────────────────────────────
function WriteTab() {
  const [folder, setFolder] = useState("CEO Heartbeat");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"overwrite" | "append">("append");
  const { toast } = useToast();

  const writeMutation = useMutation({
    mutationFn: (body: { folder: string; title: string; content: string; mode: string }) =>
      apiRequest("POST", "/api/obsidian/write", { ...body, meta: { type: "manual" } }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Note written to Obsidian" });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/vault"] });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/stats"] });
        setTitle(""); setContent("");
      } else toast({ title: "Write failed", variant: "destructive" });
    },
    onError: () => toast({ title: "Write failed", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Write to Organizational Memory</CardTitle>
        <CardDescription>Manually push a note into the AI workforce knowledge base. Frontmatter is added automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Folder</Label>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger data-testid="select-folder"><SelectValue /></SelectTrigger>
              <SelectContent>{FOLDERS.map(f => <SelectItem key={f.key} value={f.key}>{f.emoji} {f.key}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. 2026-06-06 SOP Update" data-testid="input-note-title" />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Content (Markdown)</Label>
            <Select value={mode} onValueChange={v => setMode(v as any)}>
              <SelectTrigger className="w-28 h-7 text-xs" data-testid="select-write-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="append">Append</SelectItem>
                <SelectItem value="overwrite">Overwrite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write markdown here..." className="min-h-[180px] font-mono text-xs" data-testid="textarea-note-content" />
        </div>
        <Button onClick={() => writeMutation.mutate({ folder, title, content, mode })} disabled={writeMutation.isPending || !title || !content} className="w-full" data-testid="button-write-note">
          {writeMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          Write to {folder}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminObsidianPage() {
  const { data: status } = useQuery<ObsidianStatus>({
    queryKey: ["/api/obsidian/status"], staleTime: 30_000,
  });

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-serif font-bold">Organizational Memory</h1>
            <Badge variant={status?.connected ? "default" : status?.configured ? "secondary" : "outline"} className="text-xs">
              {status?.connected ? "● Live" : status?.configured ? "Configured" : "Not Configured"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            AI workforce institutional memory — decisions, learnings, fixes &amp; reports in human-readable form
          </p>
        </div>
        <a href="https://obsidian.md/plugins?id=obsidian-local-rest-api" target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm" data-testid="button-plugin-link">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Local REST API Plugin
          </Button>
        </a>
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-transparent p-0">
          {[
            { value: "dashboard", label: "Dashboard",    icon: BarChart3 },
            { value: "search",    label: "Search",       icon: Search },
            { value: "vault",     label: "Browse",       icon: FolderOpen },
            { value: "hermes",    label: "Hermes",       icon: Brain },
            { value: "decision",  label: "Decisions",    icon: BookMarked },
            { value: "software",  label: "Software KB",  icon: Wrench },
            { value: "write",     label: "Write",        icon: Upload },
          ].map(t => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.value} value={t.value} className="text-xs px-3 py-1.5 rounded-md border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary" data-testid={`tab-${t.value}`}>
                <Icon className="h-3 w-3 mr-1.5" />{t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="mt-4">
          <TabsContent value="dashboard"><DashboardTab /></TabsContent>
          <TabsContent value="search"><SearchTab /></TabsContent>
          <TabsContent value="vault"><VaultTab /></TabsContent>
          <TabsContent value="hermes"><HermesTab /></TabsContent>
          <TabsContent value="decision"><DecisionTab /></TabsContent>
          <TabsContent value="software"><SoftwareKBTab /></TabsContent>
          <TabsContent value="write"><WriteTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
