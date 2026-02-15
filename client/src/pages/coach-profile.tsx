import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { useAuth } from "@/hooks/use-auth";
import { Save, Plus, X, User } from "lucide-react";
import type { CoachProfile } from "@shared/schema";

export default function CoachProfilePage() {
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: profile, isLoading } = useQuery<CoachProfile>({
    queryKey: ["/api/coach/profile"],
  });

  const [bio, setBio] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [newSpecialty, setNewSpecialty] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [timezone, setTimezone] = useState("");

  useEffect(() => {
    if (profile) {
      setBio(profile.bio || "");
      setSpecialties(profile.specialties || []);
      setPhotoUrl(profile.photoUrl || "");
      setTimezone(profile.timezone || "America/New_York");
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<CoachProfile>) => {
      const res = await apiRequest("PATCH", "/api/coach/profile", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile Updated", description: "Your profile has been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coaches"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({ bio, specialties, photoUrl: photoUrl || null, timezone });
  };

  const addSpecialty = () => {
    const trimmed = newSpecialty.trim();
    if (trimmed && !specialties.includes(trimmed)) {
      setSpecialties([...specialties, trimmed]);
      setNewSpecialty("");
    }
  };

  const removeSpecialty = (spec: string) => {
    setSpecialties(specialties.filter((s) => s !== spec));
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-coach-profile-title">My Profile</h1>
        <p className="text-muted-foreground mt-1">
          Edit your profile information visible to clients
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 space-y-5">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Bio</label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell clients about your coaching experience, approach, and areas of focus..."
                className="min-h-[120px] text-sm"
                data-testid="input-coach-bio"
              />
              <p className="text-xs text-muted-foreground mt-1">
                This appears on your coach card and profile page.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Specialties</label>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {specialties.map((spec) => (
                  <Badge key={spec} variant="secondary" className="gap-1 pr-1" data-testid={`badge-specialty-${spec}`}>
                    {spec}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-4 w-4 no-default-hover-elevate no-default-active-elevate"
                      onClick={() => removeSpecialty(spec)}
                      data-testid={`button-remove-specialty-${spec}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
                {specialties.length === 0 && (
                  <p className="text-sm text-muted-foreground">No specialties added yet.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newSpecialty}
                  onChange={(e) => setNewSpecialty(e.target.value)}
                  placeholder="Add a specialty (e.g. Speed & Agility)"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSpecialty())}
                  data-testid="input-new-specialty"
                />
                <Button
                  variant="outline"
                  onClick={addSpecialty}
                  disabled={!newSpecialty.trim()}
                  data-testid="button-add-specialty"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Photo URL</label>
              <Input
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
                data-testid="input-photo-url"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Link to your profile photo. This appears on your coach card.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Timezone</label>
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/New_York"
                data-testid="input-timezone"
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid="button-save-profile"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <h3 className="font-semibold text-sm">Preview</h3>
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                <AvatarImage src={photoUrl || user?.profileImageUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                  {(user?.firstName?.[0] || "C").toUpperCase()}
                  {(user?.lastName?.[0] || "").toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-sm" data-testid="text-preview-name">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{timezone}</p>
              </div>
            </div>
            {bio && (
              <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed" data-testid="text-preview-bio">
                {bio}
              </p>
            )}
            {specialties.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {specialties.map((spec) => (
                  <Badge key={spec} variant="secondary" className="text-xs">
                    {spec}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span>This is how clients will see your profile on the coaches page.</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
