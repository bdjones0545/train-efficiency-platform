import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, MapPin } from "lucide-react";
import { useLocation } from "wouter";
import type { CoachWithUser } from "@/lib/types";
import {
  PortalPageHero,
  PortalFadeUp,
  PortalStaggerGrid,
  PortalStaggerItem,
  PremiumCard,
  BookingCTAWrap,
} from "@/components/ClientPortalMotion";

export default function CoachesPage() {
  const [, navigate] = useLocation();
  const { data: profile } = useQuery<{ organizationId?: string | null }>({
    queryKey: ["/api/profile"],
  });
  const orgId = profile?.organizationId;
  const coachesUrl = orgId ? `/api/coaches?organizationId=${orgId}` : "/api/coaches";
  const { data: coaches, isLoading } = useQuery<CoachWithUser[]>({
    queryKey: ["/api/coaches", orgId],
    queryFn: async () => {
      const res = await fetch(coachesUrl);
      if (!res.ok) throw new Error("Failed to fetch coaches");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <PortalPageHero className="rounded-xl mb-2 px-5 py-6 border border-border/40 bg-card/50">
        <PortalFadeUp>
          <h1
            className="text-2xl font-serif font-bold"
            data-testid="text-coaches-title"
          >
            Our Coaches
          </h1>
          <p className="text-muted-foreground mt-1">
            Choose a coach and view their available schedule
          </p>
        </PortalFadeUp>
      </PortalPageHero>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-9 w-full" />
            </Card>
          ))}
        </div>
      ) : coaches && coaches.length > 0 ? (
        <PortalStaggerGrid className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {coaches.map((coach) => (
            <PortalStaggerItem key={coach.id}>
              <PremiumCard
                className="rounded-lg border border-border bg-card p-6 space-y-4 h-full"
                glowOnHover
                data-testid={`card-coach-${coach.id}`}
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage
                      src={coach.photoUrl || coach.user?.profileImageUrl || undefined}
                    />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {(coach.user?.firstName?.[0] || "C").toUpperCase()}
                      {(coach.user?.lastName?.[0] || "").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3
                      className="font-semibold"
                      data-testid={`text-coach-name-${coach.id}`}
                    >
                      {coach.user?.firstName} {coach.user?.lastName}
                    </h3>
                    {(coach.location || coach.timezone) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {coach.location || coach.timezone?.replace("_", " ")}
                      </p>
                    )}
                  </div>
                </div>

                {coach.bio && (
                  <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                    {coach.bio}
                  </p>
                )}

                {coach.specialties && coach.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {coach.specialties.map((spec) => (
                      <Badge key={spec} variant="secondary" className="text-xs">
                        {spec}
                      </Badge>
                    ))}
                  </div>
                )}

                <BookingCTAWrap>
                  <Button
                    className="w-full"
                    onClick={() => navigate(`/coaches/${coach.id}`)}
                    data-testid={`button-view-schedule-${coach.id}`}
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    View Schedule
                  </Button>
                </BookingCTAWrap>
              </PremiumCard>
            </PortalStaggerItem>
          ))}
        </PortalStaggerGrid>
      ) : (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">No coaches available at the moment.</p>
        </Card>
      )}
    </div>
  );
}
