import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/authToken";
import {
  Upload,
  Trash2,
  Edit,
  ChevronUp,
  ChevronDown,
  Image,
  Video,
  AlertCircle,
  CheckCircle2,
  Star,
  Camera,
  Film,
  Eye,
  X,
  GripVertical,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";

type MediaSection = "hero" | "training_showcase" | "facility" | "coaches" | "testimonials" | "results";
type FocalPoint = "center" | "top" | "bottom" | "left" | "right";

interface OrgMedia {
  id: string;
  organizationId: string;
  mediaType: "image" | "video";
  section: MediaSection;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  altText: string | null;
  orderIndex: number;
  isActive: boolean;
  focalPoint: FocalPoint | null;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
}

const SECTIONS: {
  key: MediaSection;
  label: string;
  shortLabel: string;
  limit: number;
  hint: string;
  priority?: boolean;
  completionMin: number;
}[] = [
  { key: "hero", label: "Hero Background Underlay", shortLabel: "Hero Background", limit: 5, hint: "This media appears behind the headline and buttons on the first landing-page slide. It behaves as a responsive full-screen background underlay and will crop differently across devices.", priority: true, completionMin: 1 },
  { key: "training_showcase", label: "Training Photos", shortLabel: "Training", limit: 20, hint: "Used in training sections, coach proof, athlete results, and service previews.", priority: true, completionMin: 3 },
  { key: "facility", label: "Facility Photos", shortLabel: "Facility", limit: 20, hint: "Used to show your gym, equipment, space, and training environment.", priority: true, completionMin: 2 },
  { key: "coaches", label: "Coaches", shortLabel: "Coaches", limit: 10, hint: "Showcase your coaching team. Up to 10 items.", priority: false, completionMin: 1 },
  { key: "testimonials", label: "Testimonials / Athlete Proof", shortLabel: "Testimonials", limit: 20, hint: "Upload testimonial graphics, athlete proof, client quotes, parent feedback, results screenshots, and credibility images. These are displayed as social proof on your landing page.", priority: true, completionMin: 2 },
  { key: "results", label: "Results", shortLabel: "Results", limit: 10, hint: "Athlete highlights and results. Up to 10 items.", priority: false, completionMin: 1 },
];

const EMPTY_STATE_CONTENT: Record<MediaSection, { heading: string; sub: string; suggestions: string[] }> = {
  hero: {
    heading: "Start with a strong first impression",
    sub: "Your hero media is the first thing potential clients see. Make it count.",
    suggestions: ["Athlete highlight reel", "Intense lift or speed clip", "High-energy training moment"],
  },
  training_showcase: {
    heading: "Show how you coach",
    sub: "Coaches who show their process convert significantly more clients.",
    suggestions: ["Drill execution & technique", "Your coaching cues in action", "Group training energy"],
  },
  facility: {
    heading: "Show your environment",
    sub: "Clients want to know where they'll be training before they commit.",
    suggestions: ["Equipment and turf layout", "Gym or field overview", "Clean training space shots"],
  },
  coaches: {
    heading: "Put a face to the coaching",
    sub: "Clients book coaches they trust. Show your team.",
    suggestions: ["Individual coach headshots", "Coach-client interaction", "Team photo or warmup"],
  },
  testimonials: {
    heading: "Let your athletes speak for you",
    sub: "Testimonial graphics and athlete proof are your most powerful conversion tool.",
    suggestions: ["Quote graphics & client cards", "Draft-profile / achievement graphics", "Parent feedback screenshots", "Results screenshots & transformations", "Athlete credibility images"],
  },
  results: {
    heading: "Show the transformation",
    sub: "Real results build credibility and drive new client inquiries.",
    suggestions: ["PR attempts and lifts", "Speed or agility wins", "Competition highlights"],
  },
};

function MediaBuildProgress({ grouped }: { grouped: Record<string, OrgMedia[]> }) {
  const heroActive = (grouped?.hero || []).filter(m => m.isActive).length;
  const trainingActive = (grouped?.training_showcase || []).filter(m => m.isActive).length;
  const facilityActive = (grouped?.facility || []).filter(m => m.isActive).length;
  const testimonialsActive = (grouped?.testimonials || []).filter(m => m.isActive).length;

  const steps = [
    {
      key: "hero",
      label: "Hero Media",
      desc: "Add a video or image that represents your training",
      required: true,
      done: heroActive >= 1,
      count: heroActive,
      target: 1,
    },
    {
      key: "testimonials",
      label: "Testimonials / Athlete Proof",
      desc: "Upload quote graphics, screenshots, or athlete proof cards",
      required: false,
      done: testimonialsActive >= 2,
      count: testimonialsActive,
      target: 2,
    },
    {
      key: "training",
      label: "Training Showcase",
      desc: "Show how you coach — 3–5 clips recommended",
      required: false,
      done: trainingActive >= 3,
      count: trainingActive,
      target: 3,
    },
    {
      key: "facility",
      label: "Facility Media",
      desc: "Show your environment and equipment",
      required: false,
      done: facilityActive >= 2,
      count: facilityActive,
      target: 2,
    },
  ];

  const completedCount = steps.filter(s => s.done).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);

  if (completedCount === steps.length) return null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4" data-testid="media-build-progress">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Landing Page Build Progress</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Complete these sections to build a high-converting page</p>
        </div>
        <span className="text-sm font-bold text-primary shrink-0" data-testid="text-progress-pct">{progressPct}%</span>
      </div>
      <Progress value={progressPct} className="h-2" data-testid="progress-bar" />
      <div className="space-y-2.5">
        {steps.map(step => (
          <div key={step.key} className="flex items-start gap-3" data-testid={`build-step-${step.key}`}>
            <div className={`mt-0.5 shrink-0 rounded-full flex items-center justify-center w-5 h-5 ${step.done ? "bg-green-500/15 text-green-600" : "bg-muted text-muted-foreground"}`}>
              {step.done ? <CheckCircle2 className="h-4 w-4" /> : <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-medium ${step.done ? "line-through text-muted-foreground" : ""}`}>{step.label}</span>
                {step.required && <Badge variant="outline" className="text-xs px-1.5 py-0">Required</Badge>}
                {!step.required && <Badge variant="secondary" className="text-xs px-1.5 py-0">Recommended</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
            </div>
            <span className={`text-xs shrink-0 font-medium ${step.done ? "text-green-600" : "text-muted-foreground"}`}>
              {step.count}/{step.target}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const FOCAL_POINTS: { value: FocalPoint; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

function focalToObjectPosition(fp: FocalPoint | null | undefined): string {
  switch (fp) {
    case "top": return "center top";
    case "bottom": return "center bottom";
    case "left": return "left center";
    case "right": return "right center";
    default: return "center center";
  }
}

function HeroCropPreview({ item }: { item: OrgMedia }) {
  if (item.mediaType === "video") return null;
  const objPos = focalToObjectPosition(item.focalPoint);
  return (
    <div className="space-y-2 pt-1" data-testid={`crop-preview-${item.id}`}>
      <p className="text-xs font-medium text-muted-foreground">Crop Preview</p>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <p className="text-[10px] text-muted-foreground text-center">Desktop</p>
          <div className="w-full rounded overflow-hidden border bg-black" style={{ aspectRatio: "16/5" }}>
            <img
              src={item.url}
              alt="Desktop crop"
              className="w-full h-full object-cover"
              style={{ objectPosition: objPos }}
            />
          </div>
        </div>
        <div className="w-16 space-y-1">
          <p className="text-[10px] text-muted-foreground text-center">Mobile</p>
          <div className="w-full rounded overflow-hidden border bg-black" style={{ aspectRatio: "9/16", maxHeight: 72 }}>
            <img
              src={item.url}
              alt="Mobile crop"
              className="w-full h-full object-cover"
              style={{ objectPosition: objPos }}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-2 py-1">
        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
        <p className="text-[10px] text-amber-600 dark:text-amber-500">Text or logos near the edges may be cropped on phones.</p>
      </div>
    </div>
  );
}

function SectionEmptyState({ section }: { section: MediaSection }) {
  const content = EMPTY_STATE_CONTENT[section];
  return (
    <div className="rounded-lg border border-dashed p-10 text-center space-y-4" data-testid={`empty-state-${section}`}>
      <div className="flex justify-center gap-3 text-muted-foreground">
        <Camera className="h-6 w-6" />
        <Film className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{content.heading}</p>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">{content.sub}</p>
      </div>
      <ul className="text-xs text-muted-foreground space-y-1 text-left max-w-[200px] mx-auto">
        {content.suggestions.map((s, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="text-primary mt-0.5">•</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminMediaPage() {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<MediaSection>("hero");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [editItem, setEditItem] = useState<OrgMedia | null>(null);
  const [deleteItem, setDeleteItem] = useState<OrgMedia | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editCaption, setEditCaption] = useState("");
  const [editAltText, setEditAltText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: orgInfo } = useQuery<OrgInfo>({
    queryKey: ["/api/org/info"],
  });

  const { data: mediaData, isLoading } = useQuery<{ media: OrgMedia[]; grouped: Record<string, OrgMedia[]> }>({
    queryKey: ["/api/org/media"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/org/media/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/media"] });
      toast({ title: "Media deleted" });
      setDeleteItem(null);
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<OrgMedia> }) => {
      const res = await fetch(`/api/org/media/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/org/media"] }),
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (updates: { id: string; orderIndex: number }[]) => {
      const res = await fetch("/api/org/media/reorder", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error("Failed to reorder");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/org/media"] }),
  });

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const sectionInfo = SECTIONS.find(s => s.key === activeSection);
    const currentCount = (mediaData?.grouped?.[activeSection] || []).length;

    for (const file of Array.from(files)) {
      if (currentCount >= (sectionInfo?.limit || 10)) {
        toast({ title: "Limit reached", description: `${sectionInfo?.label} supports up to ${sectionInfo?.limit} items.`, variant: "destructive" });
        break;
      }

      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      if (!isImage && !isVideo) {
        toast({ title: "Unsupported file type", description: "Please upload jpg, png, webp, mp4, mov, or webm files.", variant: "destructive" });
        continue;
      }
      if (isImage && file.size > 10 * 1024 * 1024) {
        toast({ title: "Image too large", description: "Images must be under 10MB.", variant: "destructive" });
        continue;
      }
      if (isVideo && file.size > 100 * 1024 * 1024) {
        toast({ title: "Video too large", description: "Videos must be under 100MB.", variant: "destructive" });
        continue;
      }

      setUploading(true);
      setUploadProgress(`Uploading ${file.name}...`);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("section", activeSection);

      try {
        const res = await fetch("/api/org/media", { method: "POST", headers: getAuthHeaders(), body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Upload failed" }));
          toast({ title: "Upload failed", description: err.message, variant: "destructive" });
        } else {
          queryClient.invalidateQueries({ queryKey: ["/api/org/media"] });
          toast({ title: "Uploaded!", description: `${file.name} added to ${sectionInfo?.label}.` });
        }
      } catch {
        toast({ title: "Upload error", description: "Network error during upload.", variant: "destructive" });
      } finally {
        setUploading(false);
        setUploadProgress("");
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [activeSection, mediaData, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const handleToggleActive = (item: OrgMedia) => {
    updateMutation.mutate({ id: item.id, data: { isActive: !item.isActive } });
  };

  const handleMoveUp = (items: OrgMedia[], index: number) => {
    if (index === 0) return;
    const upd = [
      { id: items[index].id, orderIndex: items[index - 1].orderIndex },
      { id: items[index - 1].id, orderIndex: items[index].orderIndex },
    ];
    reorderMutation.mutate(upd);
  };

  const handleMoveDown = (items: OrgMedia[], index: number) => {
    if (index === items.length - 1) return;
    const upd = [
      { id: items[index].id, orderIndex: items[index + 1].orderIndex },
      { id: items[index + 1].id, orderIndex: items[index].orderIndex },
    ];
    reorderMutation.mutate(upd);
  };

  const openEdit = (item: OrgMedia) => {
    setEditItem(item);
    setEditCaption(item.caption || "");
    setEditAltText(item.altText || "");
  };

  const saveEdit = () => {
    if (!editItem) return;
    updateMutation.mutate(
      { id: editItem.id, data: { caption: editCaption || null, altText: editAltText || null } },
      { onSuccess: () => { toast({ title: "Updated" }); setEditItem(null); } }
    );
  };

  const sectionItems = (mediaData?.grouped?.[activeSection] || []).sort((a, b) => a.orderIndex - b.orderIndex);

  const grouped = mediaData?.grouped || {};
  const heroActive = (grouped.hero || []).filter(m => m.isActive).length;
  const hasNoHero = (grouped.hero || []).length === 0;
  const hasHero = heroActive > 0;

  function getTabStatus(sec: typeof SECTIONS[0]) {
    const items = (grouped[sec.key] || []).filter(m => m.isActive);
    const total = (grouped[sec.key] || []).length;
    const done = items.length >= sec.completionMin;
    const needsAttention = sec.priority && total === 0;
    return { done, needsAttention, activeCount: items.length, total };
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl pb-24">

      {/* Phase 8: Conversion signal banner */}
      <div
        className={`rounded-lg border px-4 py-3 flex items-start gap-3 text-sm transition-colors ${
          hasHero
            ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
            : "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
        }`}
        data-testid="conversion-banner"
      >
        {hasHero ? (
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
        ) : (
          <TrendingUp className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
        )}
        <p className={hasHero ? "text-green-700 dark:text-green-400" : "text-blue-700 dark:text-blue-400"}>
          {hasHero
            ? "Great — your landing page now has a strong first impression."
            : "Pages with media convert significantly better. Start with a hero video or photo."}
        </p>
      </div>

      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-media-title">Media Library</h1>
          <p className="text-sm text-muted-foreground">
            Build your landing page with coaching photos and videos.
          </p>
        </div>
        {/* Phase 2: Live preview toggle */}
        {orgInfo?.slug && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            className="gap-2 min-h-[44px]"
            data-testid="button-preview-page"
          >
            <Eye className="h-4 w-4" />
            Preview Page
          </Button>
        )}
      </div>

      {/* Phase 1: Guided build progress */}
      {!isLoading && <MediaBuildProgress grouped={grouped} />}

      {/* Phase 6 + all section tabs */}
      <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as MediaSection)}>
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="flex h-auto gap-1 mb-4 w-max" data-testid="tabs-media-sections">
            {SECTIONS.map(s => {
              const status = getTabStatus(s);
              return (
                <TabsTrigger key={s.key} value={s.key} data-testid={`tab-section-${s.key}`} className="text-xs relative">
                  {s.shortLabel}
                  <span className="ml-1.5 text-[10px] font-normal opacity-70">
                    {status.total}/{s.limit}
                  </span>
                  {status.done && (
                    <CheckCircle2 className="ml-1 h-3 w-3 text-green-500 shrink-0" />
                  )}
                  {status.needsAttention && !status.done && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 inline-block" />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {SECTIONS.map(sec => {
          const secItems = (grouped[sec.key] || []).sort((a, b) => a.orderIndex - b.orderIndex);
          const isActiveSec = sec.key === activeSection;
          return (
            <TabsContent key={sec.key} value={sec.key} className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{sec.label}</p>
                  <p className="text-xs text-muted-foreground max-w-xl">{sec.hint}</p>
                </div>
                <Badge variant="outline">
                  {(grouped[sec.key]?.length ?? 0)} / {sec.limit}
                </Badge>
              </div>

              {/* Hero: Background Layer badge */}
              {sec.key === "hero" && (
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/8 px-3 py-1" data-testid="hero-bg-layer-badge">
                    <Star className="h-3 w-3 text-primary fill-primary" />
                    <span className="text-xs font-semibold text-primary">Background Layer</span>
                  </div>
                  <p className="text-xs text-muted-foreground self-center">Not displayed like a normal image card.</p>
                </div>
              )}

              {/* Hero: How Hero Backgrounds Work — 3-state visual card */}
              {sec.key === "hero" && (
                <div className="rounded-xl border bg-card p-4 space-y-3" data-testid="hero-behavior-card">
                  <p className="text-xs font-semibold">How Hero Backgrounds Work</p>
                  <div className="grid grid-cols-3 gap-3">
                    {/* A — Desktop layout */}
                    <div className="space-y-1.5">
                      <div className="rounded-md overflow-hidden border bg-black" style={{ aspectRatio: "16/5" }}>
                        <div className="w-full h-full bg-gradient-to-r from-slate-700 to-slate-800 flex items-end p-1.5">
                          <div className="space-y-0.5 w-full">
                            <div className="h-1 w-3/4 rounded-full bg-white/60" />
                            <div className="h-0.5 w-1/2 rounded-full bg-white/30" />
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground text-center font-medium">Desktop layout</p>
                    </div>
                    {/* B — Mobile layout */}
                    <div className="space-y-1.5 flex flex-col items-center">
                      <div className="rounded-md overflow-hidden border bg-black" style={{ aspectRatio: "9/14", width: "100%", maxWidth: 56 }}>
                        <div className="w-full h-full bg-gradient-to-b from-slate-700 to-slate-900 flex items-end p-1.5">
                          <div className="space-y-0.5 w-full">
                            <div className="h-1 w-full rounded-full bg-white/60" />
                            <div className="h-0.5 w-2/3 rounded-full bg-white/30" />
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground text-center font-medium">Mobile layout</p>
                    </div>
                    {/* C — Overlay preview */}
                    <div className="space-y-1.5">
                      <div className="rounded-md overflow-hidden border bg-black relative" style={{ aspectRatio: "16/5" }}>
                        <div className="absolute inset-0 bg-gradient-to-r from-slate-700 to-slate-800" />
                        <div className="absolute inset-0 bg-black/50" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 p-1">
                          <div className="h-1 w-2/3 rounded-full bg-white/90" />
                          <div className="h-0.5 w-1/2 rounded-full bg-white/60" />
                          <div className="mt-0.5 h-2 w-1/3 rounded bg-white/80" />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground text-center font-medium">Text appears on top</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Hero: Important warning box */}
              {sec.key === "hero" && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2" data-testid="hero-important-warning">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Important</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                      Hero backgrounds are designed to create atmosphere and branding behind your landing-page content. Avoid placing important text, logos, or faces near the edges of the image.
                    </p>
                  </div>
                </div>
              )}

              {hasNoHero && sec.key !== "hero" && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    We recommend uploading a Hero section first — it's the most impactful part of your landing page.
                  </p>
                </div>
              )}

              {/* Enhanced upload dropzone */}
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer select-none
                  ${dragOver && isActiveSec
                    ? "border-primary bg-primary/5 scale-[1.01] shadow-[0_0_0_4px] shadow-primary/10"
                    : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30 hover:scale-[1.005]"
                  }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                data-testid="upload-dropzone"
                style={{ minHeight: 140 }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUpload(e.target.files)}
                  data-testid="input-file-upload"
                />
                {uploading ? (
                  <div className="space-y-2">
                    <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-muted-foreground">{uploadProgress}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-3 text-muted-foreground">
                      <Film className="h-6 w-6" />
                      <Camera className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      {sec.key === "hero" ? (
                        <>
                          <p className="text-sm font-medium">Upload background media for your first landing-page slide</p>
                          <p className="text-xs text-muted-foreground">
                            This becomes the responsive background underlay behind your headline and buttons.
                          </p>
                        </>
                      ) : sec.key === "testimonials" ? (
                        <>
                          <p className="text-sm font-medium">Upload testimonial or athlete proof</p>
                          <p className="text-xs text-muted-foreground">
                            Best for quote graphics, screenshots, athlete achievements, results, and client feedback. These are shown in proof cards, not used as cropped backgrounds.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium">Drop files here or click to upload</p>
                          <p className="text-xs text-muted-foreground">
                            Show your coaching, athletes, and facility in action
                          </p>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground/70">
                      Images (jpg, png, webp) up to 10MB · Videos (mp4, mov, webm) up to 100MB
                    </p>
                  </div>
                )}
              </div>

              {/* Media grid or empty state */}
              {isLoading ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="rounded-lg border bg-muted animate-pulse h-48" />
                  ))}
                </div>
              ) : secItems.length === 0 ? (
                <SectionEmptyState section={sec.key} />
              ) : (
                <>
                  {/* Phase 7: Reorder hint */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GripVertical className="h-3.5 w-3.5" />
                    <span>Use the arrows to reorder how this appears on your landing page</span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {secItems.map((item, index) => (
                      <Card
                        key={item.id}
                        className={`overflow-hidden transition-opacity ${!item.isActive ? "opacity-55" : ""}`}
                        data-testid={`card-media-${item.id}`}
                      >
                        <div className="relative aspect-video bg-muted">
                          {item.mediaType === "image" ? (
                            <img
                              src={item.url}
                              alt={item.altText || item.caption || "Media"}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-black/80">
                              <video
                                src={item.url}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="rounded-full bg-white/20 p-3">
                                  <Video className="h-6 w-6 text-white" />
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="absolute top-2 left-2">
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 gap-1">
                              {item.mediaType === "image" ? <Image className="h-3 w-3" /> : <Video className="h-3 w-3" />}
                              {item.mediaType}
                            </Badge>
                          </div>
                          {!item.isActive && (
                            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                              <Badge variant="outline" className="text-xs">Hidden</Badge>
                            </div>
                          )}
                        </div>
                        <div className="p-3 space-y-2.5">
                          {item.caption && (
                            <p className="text-xs text-muted-foreground truncate">{item.caption}</p>
                          )}

                          {/* Focal point controls for hero items */}
                          {sec.key === "hero" && (
                            <div className="space-y-1.5" data-testid={`focal-point-controls-${item.id}`}>
                              <p className="text-xs font-medium text-muted-foreground">Focal Point</p>
                              <div className="flex flex-wrap gap-1">
                                {FOCAL_POINTS.map(fp => (
                                  <button
                                    key={fp.value}
                                    onClick={() => updateMutation.mutate({ id: item.id, data: { focalPoint: fp.value } })}
                                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                      (item.focalPoint || "center") === fp.value
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-background text-muted-foreground border-border hover:border-primary/60"
                                    }`}
                                    data-testid={`focal-${fp.value}-${item.id}`}
                                  >
                                    {fp.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Crop preview for hero images */}
                          {sec.key === "hero" && <HeroCropPreview item={item} />}

                          {/* Atmospheric background toggle (UI-only, future-ready) */}
                          {sec.key === "hero" && (
                            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-0.5" data-testid={`atmospheric-toggle-${item.id}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">Use as atmospheric background</span>
                                <Switch checked={true} disabled data-testid={`switch-atmospheric-${item.id}`} />
                              </div>
                              <p className="text-[10px] text-muted-foreground">Best for action shots, training environments, and brand visuals rather than text-heavy graphics.</p>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <Switch
                                checked={item.isActive}
                                onCheckedChange={() => handleToggleActive(item)}
                                data-testid={`toggle-active-${item.id}`}
                              />
                              <span className="text-xs text-muted-foreground">{item.isActive ? "Active" : "Hidden"}</span>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 cursor-grab active:cursor-grabbing"
                                onClick={() => handleMoveUp(secItems, index)}
                                disabled={index === 0}
                                data-testid={`button-move-up-${item.id}`}
                                title="Move up"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 cursor-grab active:cursor-grabbing"
                                onClick={() => handleMoveDown(secItems, index)}
                                disabled={index === secItems.length - 1}
                                data-testid={`button-move-down-${item.id}`}
                                title="Move down"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => openEdit(item)}
                                data-testid={`button-edit-${item.id}`}
                                title="Edit caption"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteItem(item)}
                                data-testid={`button-delete-${item.id}`}
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground/60">Position #{index + 1}</p>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Phase 2: Live preview Sheet */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent
          side="right"
          className="p-0 w-full sm:w-[520px] h-[100dvh] flex flex-col"
          data-testid="preview-sheet"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
            <div>
              <p className="text-sm font-semibold">Live Page Preview</p>
              <p className="text-xs text-muted-foreground">Reflects your current active media</p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setPreviewOpen(false)}
              data-testid="button-close-preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            {orgInfo?.slug && (
              <iframe
                src={`/org/${orgInfo.slug}?preview=1`}
                className="w-full h-full border-0"
                title="Landing page preview"
                data-testid="iframe-preview"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Media</DialogTitle>
            <DialogDescription>Update the caption and alt text for this media item.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Caption</Label>
              <Input
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                placeholder="A short description (shown on landing page)"
                data-testid="input-edit-caption"
              />
            </div>
            <div className="space-y-2">
              <Label>Alt Text</Label>
              <Input
                value={editAltText}
                onChange={(e) => setEditAltText(e.target.value)}
                placeholder="Accessibility description (for screen readers)"
                data-testid="input-edit-alt-text"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditItem(null)} data-testid="button-edit-cancel">
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={updateMutation.isPending} data-testid="button-edit-save">
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Media?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this media item from your library and landing page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
