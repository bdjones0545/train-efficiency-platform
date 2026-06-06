import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen, Search, RefreshCw, CheckCircle, XCircle, Upload,
  Download, FileText, FolderOpen, Link, AlertTriangle, Zap, Eye
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────
const LS_KEY_API = "obsidian_api_key";
const LS_KEY_URL = "obsidian_base_url";
const DEFAULT_URL = "https://127.0.0.1:27124";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function useObsidianConfig() {
  const [apiKey, setApiKeyState] = useState(() => localStorage.getItem(LS_KEY_API) || "");
  const [baseUrl, setBaseUrlState] = useState(() => localStorage.getItem(LS_KEY_URL) || DEFAULT_URL);

  const setApiKey = (v: string) => { setApiKeyState(v); localStorage.setItem(LS_KEY_API, v); };
  const setBaseUrl = (v: string) => { setBaseUrlState(v); localStorage.setItem(LS_KEY_URL, v); };

  return { apiKey, setApiKey, baseUrl, setBaseUrl };
}

async function obsidianFetch(baseUrl: string, apiKey: string, path: string, opts: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "text/markdown",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

// ─── ConnectionTab ────────────────────────────────────────────────────────────
function ConnectionTab({ apiKey, setApiKey, baseUrl, setBaseUrl }: {
  apiKey: string; setApiKey: (v: string) => void;
  baseUrl: string; setBaseUrl: (v: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [vaultInfo, setVaultInfo] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const { toast } = useToast();

  const testConnection = async () => {
    if (!apiKey) { toast({ title: "Enter your API key first", variant: "destructive" }); return; }
    setStatus("testing");
    setErrorMsg("");
    try {
      const res = await obsidianFetch(baseUrl, apiKey, "/");
      const data = await res.json();
      setVaultInfo(data);
      setStatus("ok");
      toast({ title: "Connected to Obsidian!" });
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e.message || "Connection failed");
    }
  };

  return (
    <div className="space-y-4">
      {/* Certificate warning */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">First-time setup: Trust the certificate</p>
              <p className="text-xs text-muted-foreground">
                The Obsidian API uses a self-signed certificate. Visit{" "}
                <a href={baseUrl} target="_blank" rel="noreferrer" className="underline text-primary">
                  {baseUrl}
                </a>{" "}
                in your browser and click <strong>Advanced → Proceed</strong> to trust it. Do this once.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Obsidian API Settings</CardTitle>
          <CardDescription>Settings are saved in your browser and never sent to our server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://127.0.0.1:27124"
              data-testid="input-obsidian-url"
            />
            <p className="text-xs text-muted-foreground">Default: https://127.0.0.1:27124 — find this in Obsidian → Settings → Local REST API</p>
          </div>
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Paste your API key here"
              data-testid="input-obsidian-key"
            />
            <p className="text-xs text-muted-foreground">Find this in Obsidian → Settings → Local REST API → Copy API key</p>
          </div>
          <Button onClick={testConnection} disabled={status === "testing"} data-testid="button-test-connection">
            {status === "testing" ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
            Test Connection
          </Button>

          {status === "ok" && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">Connected</p>
                {vaultInfo && <p className="text-xs text-muted-foreground">Vault: {vaultInfo.vaultName || "Unknown"} · Version: {vaultInfo.versions?.obsidian || "—"}</p>}
              </div>
            </div>
          )}
          {status === "error" && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <XCircle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Connection failed</p>
                <p className="text-xs text-muted-foreground">{errorMsg}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Setup Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            "Install the \"Local REST API\" plugin in Obsidian (Community Plugins)",
            "Enable the plugin and note the API key and port number",
            "Visit the API URL above in your browser to trust the certificate",
            "Paste your API key above and click Test Connection",
          ].map((step, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-medium">{i + 1}</span>
              <span className="text-muted-foreground">{step}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── SearchTab ────────────────────────────────────────────────────────────────
function SearchTab({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const { toast } = useToast();

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults([]);
    try {
      const res = await obsidianFetch(baseUrl, apiKey, `/search/simple/?query=${encodeURIComponent(query)}&contextLength=100`, { headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast({ title: "Search failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openFile = async (filename: string) => {
    setSearching(true);
    try {
      const res = await obsidianFetch(baseUrl, apiKey, `/vault/${encodeURIComponent(filename)}`);
      const text = await res.text();
      setSelectedFile({ name: filename, content: text });
    } catch (e: any) {
      toast({ title: "Could not open file", description: e.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      {selectedFile ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <CardTitle className="text-sm truncate">{selectedFile.name}</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)} data-testid="button-close-file">← Back</Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap font-mono">
              {selectedFile.content}
            </pre>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search()}
              placeholder="Search your Obsidian vault..."
              data-testid="input-obsidian-search"
            />
            <Button onClick={search} disabled={loading || !apiKey} data-testid="button-obsidian-search">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {!apiKey && (
            <p className="text-sm text-muted-foreground text-center py-6">Connect your Obsidian vault in the Connection tab first.</p>
          )}

          {results.length === 0 && query && !loading && (
            <p className="text-sm text-muted-foreground text-center py-6">No results for "{query}"</p>
          )}

          {results.map((r, i) => (
            <Card key={i} className="cursor-pointer hover:bg-muted/40 transition-colors" onClick={() => openFile(r.filename)} data-testid={`card-search-result-${i}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium truncate">{r.filename}</p>
                    {r.matches?.map((m: any, j: number) => (
                      <p key={j} className="text-xs text-muted-foreground line-clamp-2">…{m.context}…</p>
                    ))}
                  </div>
                  <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

// ─── PushTab ──────────────────────────────────────────────────────────────────
function PushTab({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }) {
  const [noteTitle, setNoteTitle] = useState("");
  const [folder, setFolder] = useState("TrainEfficiency");
  const [content, setContent] = useState("");
  const [pushing, setPushing] = useState(false);
  const [mode, setMode] = useState<"overwrite" | "append">("overwrite");
  const { toast } = useToast();

  const { data: clients } = useQuery<any[]>({ queryKey: ["/api/users?role=CLIENT"], staleTime: 60_000 });
  const { data: sessions } = useQuery<any[]>({ queryKey: ["/api/bookings?limit=20"], staleTime: 60_000 });

  const insertTemplate = (type: "session" | "client" | "blank") => {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    if (type === "session") {
      setNoteTitle(`Session Note ${dateStr}`);
      setContent(`# Session Note — ${dateStr}\n\n**Date:** ${dateStr}  \n**Time:** ${timeStr}  \n**Coach:**  \n**Client:**  \n**Service:**  \n\n---\n\n## Session Overview\n\n\n## Key Observations\n\n\n## Progress Notes\n\n\n## Next Session Goals\n\n\n## Tags\n#train-efficiency #session-note\n`);
    } else if (type === "client") {
      setNoteTitle("Client Profile");
      setContent(`# Client Profile\n\n**Name:**  \n**Email:**  \n**Start Date:** ${dateStr}  \n**Program:**  \n\n---\n\n## Goals\n\n\n## Medical/Physical Notes\n\n\n## Progress History\n\n\n## Session History\n\n\n## Tags\n#train-efficiency #client\n`);
    } else {
      setContent(`# ${noteTitle || "New Note"}\n\n_Created from Train Efficiency on ${dateStr}_\n\n`);
    }
  };

  const pushNote = async () => {
    if (!noteTitle.trim() || !content.trim()) {
      toast({ title: "Title and content required", variant: "destructive" }); return;
    }
    if (!apiKey) {
      toast({ title: "Connect Obsidian first", variant: "destructive" }); return;
    }
    setPushing(true);
    const filePath = folder ? `${folder}/${noteTitle}.md` : `${noteTitle}.md`;
    try {
      const method = mode === "append" ? "POST" : "PUT";
      await obsidianFetch(baseUrl, apiKey, `/vault/${encodeURIComponent(filePath)}`, {
        method,
        body: content,
      });
      toast({ title: "Note pushed to Obsidian!", description: filePath });
    } catch (e: any) {
      toast({ title: "Push failed", description: e.message, variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Push Note to Obsidian</CardTitle>
          <CardDescription>Create or update a note in your vault from here.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => insertTemplate("session")} data-testid="button-template-session">
              📋 Session Note
            </Button>
            <Button variant="outline" size="sm" onClick={() => insertTemplate("client")} data-testid="button-template-client">
              👤 Client Profile
            </Button>
            <Button variant="outline" size="sm" onClick={() => insertTemplate("blank")} data-testid="button-template-blank">
              📄 Blank Note
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Folder in Vault</Label>
              <Input
                value={folder}
                onChange={e => setFolder(e.target.value)}
                placeholder="e.g. TrainEfficiency/Sessions"
                data-testid="input-obsidian-folder"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note Title</Label>
              <Input
                value={noteTitle}
                onChange={e => setNoteTitle(e.target.value)}
                placeholder="Note title (no .md needed)"
                data-testid="input-obsidian-title"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Content (Markdown)</Label>
              <Select value={mode} onValueChange={v => setMode(v as any)}>
                <SelectTrigger className="w-36 h-7 text-xs" data-testid="select-push-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overwrite">Overwrite</SelectItem>
                  <SelectItem value="append">Append</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Write markdown here or pick a template above..."
              className="min-h-[220px] font-mono text-xs"
              data-testid="textarea-obsidian-content"
            />
          </div>

          <Button onClick={pushNote} disabled={pushing || !apiKey} className="w-full" data-testid="button-push-obsidian">
            {pushing ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Push to Obsidian
          </Button>

          {!apiKey && (
            <p className="text-xs text-muted-foreground text-center">Connect your Obsidian vault in the Connection tab first.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── VaultTab ─────────────────────────────────────────────────────────────────
function VaultTab({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const { toast } = useToast();

  const loadVault = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const res = await obsidianFetch(baseUrl, apiKey, "/vault/");
      const data = await res.json();
      const list: string[] = data.files || [];
      setFiles(list.filter(f => f.endsWith(".md")).sort());
    } catch (e: any) {
      toast({ title: "Could not load vault", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [apiKey, baseUrl]);

  useEffect(() => { loadVault(); }, [loadVault]);

  const openFile = async (filename: string) => {
    setOpeningFile(true);
    try {
      const res = await obsidianFetch(baseUrl, apiKey, `/vault/${encodeURIComponent(filename)}`);
      const text = await res.text();
      setSelectedFile({ name: filename, content: text });
    } catch (e: any) {
      toast({ title: "Could not open file", description: e.message, variant: "destructive" });
    } finally {
      setOpeningFile(false);
    }
  };

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content);
    toast({ title: "Copied to clipboard" });
  };

  const filtered = files.filter(f => f.toLowerCase().includes(filterText.toLowerCase()));

  if (selectedFile) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFile(null)} data-testid="button-back-vault">← Vault</Button>
          <Badge variant="outline" className="text-xs truncate max-w-[200px]">{selectedFile.name}</Badge>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => copyToClipboard(selectedFile.content)} data-testid="button-copy-note">
            Copy
          </Button>
        </div>
        <Card>
          <CardContent className="pt-4">
            <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto max-h-[65vh] whitespace-pre-wrap font-mono">
              {selectedFile.content}
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filter notes..."
          data-testid="input-vault-filter"
        />
        <Button variant="outline" size="icon" onClick={loadVault} disabled={loading} data-testid="button-refresh-vault">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {!apiKey && (
        <p className="text-sm text-muted-foreground text-center py-8">Connect your Obsidian vault in the Connection tab first.</p>
      )}

      {apiKey && files.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground text-center py-8">No markdown files found in vault root.</p>
      )}

      <div className="space-y-1.5">
        {filtered.map((f, i) => {
          const parts = f.split("/");
          const name = parts[parts.length - 1].replace(".md", "");
          const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
          return (
            <div
              key={i}
              className="flex items-center gap-2 p-2.5 rounded-lg border bg-card hover:bg-muted/40 cursor-pointer transition-colors"
              onClick={() => openFile(f)}
              data-testid={`row-vault-file-${i}`}
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{name}</p>
                {folder && <p className="text-xs text-muted-foreground">{folder}</p>}
              </div>
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          );
        })}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">{filtered.length} note{filtered.length !== 1 ? "s" : ""}</p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminObsidianPage() {
  const { apiKey, setApiKey, baseUrl, setBaseUrl } = useObsidianConfig();

  const isConnected = !!apiKey;

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-serif font-bold">Obsidian Vault</h1>
            <Badge variant={isConnected ? "default" : "secondary"} className="text-xs">
              {isConnected ? "Key Saved" : "Not Connected"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">Search, push, and sync notes with your local Obsidian vault</p>
        </div>
        <a href="https://obsidian.md/plugins?id=obsidian-local-rest-api" target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm" data-testid="button-obsidian-plugin-link">
            <Link className="h-3.5 w-3.5 mr-1.5" />
            Get Plugin
          </Button>
        </a>
      </div>

      <Tabs defaultValue="connection">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="connection" data-testid="tab-connection">Connect</TabsTrigger>
          <TabsTrigger value="search" data-testid="tab-search">Search</TabsTrigger>
          <TabsTrigger value="push" data-testid="tab-push">Push</TabsTrigger>
          <TabsTrigger value="vault" data-testid="tab-vault">Vault</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="mt-4">
          <ConnectionTab apiKey={apiKey} setApiKey={setApiKey} baseUrl={baseUrl} setBaseUrl={setBaseUrl} />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <SearchTab apiKey={apiKey} baseUrl={baseUrl} />
        </TabsContent>

        <TabsContent value="push" className="mt-4">
          <PushTab apiKey={apiKey} baseUrl={baseUrl} />
        </TabsContent>

        <TabsContent value="vault" className="mt-4">
          <VaultTab apiKey={apiKey} baseUrl={baseUrl} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
