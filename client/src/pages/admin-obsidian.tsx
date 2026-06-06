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
import {
  BookOpen, Search, RefreshCw, CheckCircle, XCircle,
  FileText, Eye, Brain, Activity, FolderOpen, Upload,
  AlertTriangle, ExternalLink, ChevronRight
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

interface SearchResult {
  filename: string;
  score: number;
  matches: Array<{ context: string }>;
}

const FOLDERS = [
  { key: "CEO Heartbeat",          label: "CEO Heartbeat",         emoji: "💓" },
  { key: "Agent Decisions",        label: "Agent Decisions",        emoji: "🤖" },
  { key: "Software Improvements",  label: "Software Improvements",  emoji: "🔧" },
  { key: "Hermes Learning",        label: "Hermes Learning",        emoji: "🧠" },
  { key: "Revenue Intelligence",   label: "Revenue Intelligence",   emoji: "💰" },
  { key: "Growth Intelligence",    label: "Growth Intelligence",    emoji: "📈" },
  { key: "Scheduling Intelligence",label: "Scheduling Intelligence",emoji: "📅" },
  { key: "Client Success",         label: "Client Success",         emoji: "🏆" },
  { key: "SOPs",                   label: "SOPs",                   emoji: "📋" },
  { key: "Daily Reports",          label: "Daily Reports",          emoji: "📰" },
  { key: "Weekly Reports",         label: "Weekly Reports",         emoji: "📊" },
];

// ─── StatusPanel ─────────────────────────────────────────────────────────────
function StatusPanel() {
  const { data: status, isLoading, refetch, isFetching } = useQuery<ObsidianStatus>({
    queryKey: ["/api/obsidian/status"],
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
            Obsidian Memory Layer
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription>AI workforce organizational memory. TrainEfficiency DB remains the source of truth.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-20 bg-muted animate-pulse rounded-lg" />
        ) : !status?.configured ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Obsidian not configured</p>
                <p className="text-xs text-muted-foreground mt-1">Set these environment variables in your Replit Secrets:</p>
              </div>
            </div>
            <div className="bg-zinc-900 rounded p-3 font-mono text-xs space-y-1 text-zinc-300">
              <p><span className="text-green-400">OBSIDIAN_BASE_URL</span>=https://127.0.0.1:27124</p>
              <p><span className="text-green-400">OBSIDIAN_API_KEY</span>=your-api-key-here</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your API key: Obsidian → Settings → Community Plugins → Local REST API → Copy API Key
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠️ If Obsidian runs on your local machine, you'll also need a tunnel (e.g. ngrok) to expose it to the cloud server.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              {
                label: "Status",
                value: status.connected ? "Connected" : "Offline",
                icon: status.connected ? CheckCircle : XCircle,
                color: status.connected ? "text-green-500" : "text-red-500",
              },
              {
                label: "Notes Today",
                value: status.notesCreatedToday,
                icon: FileText,
                color: "text-purple-400",
              },
              {
                label: "Searches",
                value: status.searchesPerformed,
                icon: Search,
                color: "text-blue-400",
              },
              {
                label: "Last Sync",
                value: status.lastSyncAt
                  ? new Date(status.lastSyncAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                  : "—",
                icon: Activity,
                color: "text-zinc-400",
              },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="rounded-lg border bg-card p-3 text-center" data-testid={`stat-obsidian-${s.label.toLowerCase().replace(" ", "-")}`}>
                  <Icon className={`h-4 w-4 mx-auto mb-1 ${s.color}`} />
                  <p className={`text-lg font-bold leading-none ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{s.label}</p>
                </div>
              );
            })}
          </div>
        )}

        {status?.vaultName && (
          <p className="text-xs text-muted-foreground">
            Vault: <span className="font-medium text-foreground">{status.vaultName}</span>
            {status.version && <> · Obsidian {status.version}</>}
          </p>
        )}

        {/* Folder structure */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Vault Folders</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {FOLDERS.map(f => (
              <div key={f.key} className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded bg-muted/50 text-muted-foreground">
                <span>{f.emoji}</span>
                <span className="truncate">{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SearchTab ────────────────────────────────────────────────────────────────
function SearchTab() {
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const { toast } = useToast();

  const searchMutation = useMutation({
    mutationFn: (q: string) => apiRequest("POST", "/api/obsidian/search", { query: q }).then(r => r.json()),
  });

  const readMutation = useMutation({
    mutationFn: ({ folder, title }: { folder: string; title: string }) =>
      fetch(`/api/obsidian/read?folder=${encodeURIComponent(folder)}&title=${encodeURIComponent(title)}`, { credentials: "include" }).then(r => r.json()),
  });

  const doSearch = () => {
    if (!query.trim()) return;
    searchMutation.mutate(query);
  };

  const openFile = async (filename: string) => {
    const parts = filename.replace(".md", "").split("/");
    const title = parts[parts.length - 1];
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const result = await readMutation.mutateAsync({ folder, title });
    if (result.content) setSelectedFile({ name: filename, content: result.content });
    else toast({ title: "Could not open note", variant: "destructive" });
  };

  const results: SearchResult[] = searchMutation.data?.results || [];

  if (selectedFile) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)} data-testid="button-back-search">← Search</Button>
          <Badge variant="outline" className="text-xs truncate max-w-[200px]">{selectedFile.name}</Badge>
        </div>
        <Card>
          <CardContent className="pt-4">
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap font-mono">
              {selectedFile.content}
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder="Search agent decisions, heartbeat reports, learnings..."
          data-testid="input-obsidian-search"
        />
        <Button onClick={doSearch} disabled={searchMutation.isPending} data-testid="button-search-obsidian">
          {searchMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {results.length === 0 && searchMutation.isSuccess && (
        <p className="text-sm text-muted-foreground text-center py-8">No results for "{query}"</p>
      )}

      {results.map((r, i) => {
        const parts = r.filename.split("/");
        const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "Vault Root";
        const name = parts[parts.length - 1].replace(".md", "");
        const folderMeta = FOLDERS.find(f => f.key === folder);

        return (
          <Card
            key={i}
            className="cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => openFile(r.filename)}
            data-testid={`card-search-result-${i}`}
          >
            <CardContent className="py-3 px-4">
              <div className="flex items-start gap-2">
                <span className="text-base shrink-0">{folderMeta?.emoji || "📄"}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium truncate">{name}</p>
                  <p className="text-xs text-muted-foreground">{folder}</p>
                  {r.matches?.slice(0, 2).map((m, j) => (
                    <p key={j} className="text-xs text-muted-foreground line-clamp-1">…{m.context}…</p>
                  ))}
                </div>
                <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── VaultTab — browse by folder ──────────────────────────────────────────────
function VaultTab() {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const [filterText, setFilterText] = useState("");
  const { toast } = useToast();

  const { data: vaultData, isLoading, refetch, isFetching } = useQuery<{ files: string[] }>({
    queryKey: ["/api/obsidian/vault"],
    staleTime: 60_000,
  });

  const readMutation = useMutation({
    mutationFn: ({ folder, title }: { folder: string; title: string }) =>
      fetch(`/api/obsidian/read?folder=${encodeURIComponent(folder)}&title=${encodeURIComponent(title)}`, { credentials: "include" }).then(r => r.json()),
  });

  const allFiles = vaultData?.files || [];

  const filesByFolder = FOLDERS.reduce((acc, f) => {
    acc[f.key] = allFiles.filter(file => file.startsWith(f.key + "/"));
    return acc;
  }, {} as Record<string, string[]>);

  const folderFiles = selectedFolder
    ? (filesByFolder[selectedFolder] || []).filter(f =>
        f.toLowerCase().includes(filterText.toLowerCase())
      )
    : [];

  const openFile = async (filename: string) => {
    const parts = filename.replace(".md", "").split("/");
    const title = parts[parts.length - 1];
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const result = await readMutation.mutateAsync({ folder, title });
    if (result.content) setSelectedFile({ name: filename, content: result.content });
    else toast({ title: "Could not open note", variant: "destructive" });
  };

  if (selectedFile) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)} data-testid="button-back-vault">← Vault</Button>
          <Badge variant="outline" className="text-xs truncate max-w-[200px]">{selectedFile.name}</Badge>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => { navigator.clipboard.writeText(selectedFile.content); toast({ title: "Copied" }); }}>
            Copy
          </Button>
        </div>
        <Card>
          <CardContent className="pt-4">
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto max-h-[62vh] whitespace-pre-wrap font-mono">
              {selectedFile.content}
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedFolder) {
    const meta = FOLDERS.find(f => f.key === selectedFolder)!;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFolder(null)} data-testid="button-back-folders">← Folders</Button>
          <span className="font-medium text-sm">{meta.emoji} {meta.label}</span>
          <Badge variant="secondary" className="text-xs">{folderFiles.length} notes</Badge>
        </div>
        <Input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filter notes..."
          data-testid="input-folder-filter"
        />
        {folderFiles.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground space-y-2">
            <FolderOpen className="h-8 w-8 mx-auto opacity-40" />
            <p className="text-sm">No notes in {meta.label} yet.</p>
            <p className="text-xs">Notes are written automatically by the AI agents.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {folderFiles.map((f, i) => {
              const name = f.split("/").pop()?.replace(".md", "") || f;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2.5 rounded-lg border bg-card hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => openFile(f)}
                  data-testid={`row-vault-file-${i}`}
                >
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
        <div className="grid grid-cols-2 gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FOLDERS.map(f => {
            const count = filesByFolder[f.key]?.length || 0;
            return (
              <button
                key={f.key}
                onClick={() => setSelectedFolder(f.key)}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/40 text-left transition-colors"
                data-testid={`card-folder-${f.key.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span className="text-xl">{f.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{f.label}</p>
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

// ─── WriteTab — manual note push ─────────────────────────────────────────────
function WriteTab() {
  const [folder, setFolder] = useState("CEO Heartbeat");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"overwrite" | "append">("append");
  const { toast } = useToast();

  const writeMutation = useMutation({
    mutationFn: (body: { folder: string; title: string; content: string; mode: string }) =>
      apiRequest("POST", "/api/obsidian/write", body).then(r => r.json()),
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Note written to Obsidian" });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/obsidian/vault"] });
        setTitle("");
        setContent("");
      } else {
        toast({ title: "Write failed", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Write failed", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Write to Organizational Memory</CardTitle>
        <CardDescription>Manually push a note into the AI workforce knowledge base.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Folder</Label>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger data-testid="select-obsidian-folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLDERS.map(f => (
                  <SelectItem key={f.key} value={f.key}>{f.emoji} {f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note Title</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. 2026-06-06 SOP Update"
              data-testid="input-note-title"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Content (Markdown)</Label>
            <Select value={mode} onValueChange={v => setMode(v as any)}>
              <SelectTrigger className="w-32 h-7 text-xs" data-testid="select-write-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">Append</SelectItem>
                <SelectItem value="overwrite">Overwrite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Write markdown content here..."
            className="min-h-[200px] font-mono text-xs"
            data-testid="textarea-note-content"
          />
        </div>

        <Button
          onClick={() => writeMutation.mutate({ folder, title, content, mode })}
          disabled={writeMutation.isPending || !title || !content}
          className="w-full"
          data-testid="button-write-note"
        >
          {writeMutation.isPending
            ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            : <Upload className="h-4 w-4 mr-2" />}
          Write to {folder}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminObsidianPage() {
  const { data: status } = useQuery<ObsidianStatus>({
    queryKey: ["/api/obsidian/status"],
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-serif font-bold">Organizational Memory</h1>
            <Badge
              variant={status?.connected ? "default" : status?.configured ? "secondary" : "outline"}
              className="text-xs"
            >
              {status?.connected ? "● Connected" : status?.configured ? "Configured" : "Not Configured"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            Obsidian as the AI workforce knowledge layer — agent decisions, reports &amp; learnings in human-readable form
          </p>
        </div>
        <a
          href="https://obsidian.md/plugins?id=obsidian-local-rest-api"
          target="_blank"
          rel="noreferrer"
        >
          <Button variant="outline" size="sm" data-testid="button-plugin-link">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Local REST API Plugin
          </Button>
        </a>
      </div>

      <StatusPanel />

      <Tabs defaultValue="vault">
        <TabsList className="grid grid-cols-3 w-full max-w-sm">
          <TabsTrigger value="vault" data-testid="tab-vault">Browse</TabsTrigger>
          <TabsTrigger value="search" data-testid="tab-search">Search</TabsTrigger>
          <TabsTrigger value="write" data-testid="tab-write">Write</TabsTrigger>
        </TabsList>

        <TabsContent value="vault" className="mt-4">
          <VaultTab />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <SearchTab />
        </TabsContent>

        <TabsContent value="write" className="mt-4">
          <WriteTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
