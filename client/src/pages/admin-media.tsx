import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Upload,
  Trash2,
  Edit,
  ChevronUp,
  ChevronDown,
  Image,
  Video,
  AlertCircle,
  Info,
} from "lucide-react";

type MediaSection = "hero" | "training_showcase" | "facility" | "coaches" | "testimonials" | "results";

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
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const SECTIONS: { key: MediaSection; label: string; limit: number; hint: string }[] = [
  { key: "hero", label: "Hero", limit: 5, hint: "Displayed at the top of your landing page. Up to 5 items." },
  { key: "training_showcase", label: "Training Showcase", limit: 20, hint: "Show how you train. Up to 20 items." },
  { key: "facility", label: "Facility", limit: 20, hint: "Show your gym and equipment. Up to 20 items." },
  { key: "coaches", label: "Coaches", limit: 10, hint: "Showcase your coaching team. Up to 10 items." },
  { key: "testimonials", label: "Testimonials", limit: 10, hint: "Client testimonials and results. Up to 10 items." },
  { key: "results", label: "Results", limit: 10, hint: "Athlete highlights and success stories. Up to 10 items." },
];

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: mediaData, isLoading } = useQuery<{ media: OrgMedia[]; grouped: Record<string, OrgMedia[]> }>({
    queryKey: ["/api/org/media"],
    queryFn: async () => {
      const res = await fetch("/api/org/media");
      if (!res.ok) throw new Error("Failed to fetch media");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/org/media/${id}`, { method: "DELETE" });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/media"] });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (updates: { id: string; orderIndex: number }[]) => {
      const res = await fetch("/api/org/media/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        toast({ title: `Limit reached`, description: `${sectionInfo?.label} supports up to ${sectionInfo?.limit} items.`, variant: "destructive" });
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
        const res = await fetch("/api/org/media", { method: "POST", body: formData });
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
    const updates = [...items];
    const tmp = updates[index - 1].orderIndex;
    const upd = [
      { id: updates[index].id, orderIndex: tmp },
      { id: updates[index - 1].id, orderIndex: updates[index].orderIndex },
    ];
    reorderMutation.mutate(upd);
  };

  const handleMoveDown = (items: OrgMedia[], index: number) => {
    if (index === items.length - 1) return;
    const updates = [...items];
    const tmp = updates[index + 1].orderIndex;
    const upd = [
      { id: updates[index].id, orderIndex: tmp },
      { id: updates[index + 1].id, orderIndex: updates[index].orderIndex },
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
    updateMutation.mutate({ id: editItem.id, data: { caption: editCaption || null, altText: editAltText || null } }, {
      onSuccess: () => {
        toast({ title: "Updated" });
        setEditItem(null);
      },
    });
  };

  const sectionItems = (mediaData?.grouped?.[activeSection] || []).sort((a, b) => a.orderIndex - b.orderIndex);
  const currentSection = SECTIONS.find(s => s.key === activeSection);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-media-title">Media Library</h1>
        <p className="text-sm text-muted-foreground">
          Upload photos and videos to make your landing page feel like your business.
        </p>
      </div>

      <div className="rounded-lg border bg-muted/40 p-4 flex items-start gap-3">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <p className="text-sm text-muted-foreground">
          <strong>Recommended order:</strong> Start with a Hero video, add 3–5 training clips, facility photos, and coach/personality media. This builds trust and drives bookings.
        </p>
      </div>

      <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as MediaSection)}>
        <TabsList className="flex flex-wrap h-auto gap-1 mb-4" data-testid="tabs-media-sections">
          {SECTIONS.map(s => (
            <TabsTrigger key={s.key} value={s.key} data-testid={`tab-section-${s.key}`} className="text-xs">
              {s.label}
              {(mediaData?.grouped?.[s.key]?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {mediaData?.grouped?.[s.key]?.length}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {SECTIONS.map(sec => (
          <TabsContent key={sec.key} value={sec.key} className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-muted-foreground">{sec.hint}</p>
              <Badge variant="outline">
                {(mediaData?.grouped?.[sec.key]?.length ?? 0)} / {sec.limit}
              </Badge>
            </div>

            {sec.key === "hero" && (
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Hero section supports up to 5 items. Videos should be short and compressed for best mobile performance.
                </p>
              </div>
            )}

            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="upload-dropzone"
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
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm font-medium">Drag & drop or click to upload</p>
                  <p className="text-xs text-muted-foreground">
                    Images (jpg, png, webp) up to 10MB · Videos (mp4, mov, webm) up to 100MB
                  </p>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3].map(i => (
                  <div key={i} className="rounded-lg border bg-muted animate-pulse h-48" />
                ))}
              </div>
            ) : sectionItems.length === 0 ? (
              <div className="rounded-lg border border-dashed p-12 text-center">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No media yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload training videos or photos to make your landing page feel like your business.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sectionItems.map((item, index) => (
                  <Card key={item.id} className={`overflow-hidden ${!item.isActive ? "opacity-60" : ""}`} data-testid={`card-media-${item.id}`}>
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
                      <div className="absolute top-2 left-2 flex gap-1">
                        <Badge variant="secondary" className="text-xs px-1.5 py-0">
                          {item.mediaType === "image" ? <Image className="h-3 w-3" /> : <Video className="h-3 w-3" />}
                          <span className="ml-1">{item.mediaType}</span>
                        </Badge>
                      </div>
                      {!item.isActive && (
                        <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                          <Badge variant="outline" className="text-xs">Inactive</Badge>
                        </div>
                      )}
                    </div>
                    <div className="p-3 space-y-3">
                      {item.caption && (
                        <p className="text-xs text-muted-foreground truncate">{item.caption}</p>
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
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleMoveUp(sectionItems, index)}
                            disabled={index === 0}
                            data-testid={`button-move-up-${item.id}`}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleMoveDown(sectionItems, index)}
                            disabled={index === sectionItems.length - 1}
                            data-testid={`button-move-down-${item.id}`}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => openEdit(item)}
                            data-testid={`button-edit-${item.id}`}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteItem(item)}
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">#{index + 1}</p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

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
