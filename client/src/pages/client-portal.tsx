import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowRight, Shield, Zap } from "lucide-react";
import type { Organization } from "@shared/schema";
import estLogo from "@assets/IMG_7961_1771105509253.jpeg";

function getOrgLogo(org: Organization): string | undefined {
  if (org.logoUrl) return org.logoUrl;
  if (org.slug === "efficiencystrength") return estLogo;
  return undefined;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function OrgCard({ org, index }: { org: Organization; index: number }) {
  const [visible, setVisible] = useState(false);
  const logoSrc = getOrgLogo(org);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), index * 80);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <a
      href={`/org/${org.slug}`}
      data-testid={`card-org-${org.slug}`}
      className="block group focus:outline-none"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(10px)",
        transition: "opacity 0.35s ease, transform 0.35s ease",
      }}
    >
      <div className="relative rounded-2xl border border-border/60 bg-card overflow-hidden transition-all duration-200 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_30px_rgba(0,0,0,0.10)] group-hover:border-primary/30 group-active:scale-[0.99]">
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
          style={{
            background: org.primaryColor
              ? `radial-gradient(ellipse at top left, ${org.primaryColor}10 0%, transparent 65%)`
              : "radial-gradient(ellipse at top left, hsl(var(--primary) / 0.06) 0%, transparent 65%)",
          }}
        />

        <div className="relative p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <Avatar className="h-14 w-14 rounded-xl ring-1 ring-border/50 shadow-sm">
                {logoSrc ? (
                  <AvatarImage
                    src={logoSrc}
                    alt={org.name}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback
                  className="rounded-xl text-sm font-bold"
                  style={
                    org.primaryColor
                      ? {
                          backgroundColor: `${org.primaryColor}18`,
                          color: org.primaryColor,
                        }
                      : undefined
                  }
                >
                  {getInitials(org.name)}
                </AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-card" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className="font-semibold text-[15px] leading-snug text-foreground truncate"
                  data-testid={`text-org-name-${org.slug}`}
                >
                  {org.name}
                </h3>
                <Badge
                  variant="secondary"
                  className="text-[10px] font-medium px-1.5 py-0 h-4 shrink-0 hidden sm:inline-flex"
                >
                  <Shield className="h-2.5 w-2.5 mr-0.5" />
                  Verified
                </Badge>
              </div>

              {org.tagline ? (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                  {org.tagline}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Coaching &amp; Performance Training
                </p>
              )}

              <div className="flex items-center gap-3 mt-3">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                  Active organization
                </span>
              </div>
            </div>

            <div className="shrink-0 self-center ml-1">
              <div className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center group-hover:bg-primary/10 transition-colors duration-200">
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors duration-200 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-4 border-t border-border/40 pt-3 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/60 font-medium tracking-wide uppercase">
            Powered by TrainEfficiency
          </span>
          <Zap className="h-3 w-3 text-muted-foreground/40" />
        </div>
      </div>
    </a>
  );
}

function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="rounded-2xl border border-border/60 bg-card overflow-hidden animate-pulse"
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-xl bg-muted shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 bg-muted rounded-md w-3/5" />
            <div className="h-3 bg-muted rounded-md w-4/5" />
            <div className="h-3 bg-muted rounded-md w-2/5 mt-3" />
          </div>
        </div>
      </div>
      <div className="px-5 sm:px-6 pb-4 border-t border-border/40 pt-3">
        <div className="h-3 bg-muted rounded-md w-2/5" />
      </div>
    </div>
  );
}

export default function ClientPortalPage() {
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHeaderVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  const { data: orgs, isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
  });

  const filtered = (orgs || []).filter((org) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      org.name.toLowerCase().includes(q) || org.slug.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div
          className="text-center mb-10 sm:mb-12"
          style={{
            opacity: headerVisible ? 1 : 0,
            transform: headerVisible ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}
        >
          <div className="inline-flex items-center gap-2 bg-primary/8 border border-primary/15 text-primary text-xs font-semibold px-3 py-1.5 rounded-full mb-5 tracking-wide uppercase">
            <Shield className="h-3 w-3" />
            Client Portal
          </div>

          <h1
            className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-3 leading-tight"
            data-testid="text-portal-heading"
          >
            Access Your Coaching Portal
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-sm mx-auto">
            Find your training organization to view schedules, sessions,
            payments, and coaching updates.
          </p>
        </div>

        <div
          className="relative max-w-md mx-auto mb-8 sm:mb-10"
          style={{
            opacity: headerVisible ? 1 : 0,
            transform: headerVisible ? "translateY(0)" : "translateY(-4px)",
            transition: "opacity 0.45s ease 0.1s, transform 0.45s ease 0.1s",
          }}
        >
          <div
            className="absolute inset-0 rounded-xl transition-all duration-200 pointer-events-none"
            style={{
              boxShadow: searchFocused
                ? "0 0 0 3px hsl(var(--primary) / 0.15)"
                : "none",
            }}
          />
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors duration-200"
            style={{
              color: searchFocused
                ? "hsl(var(--primary))"
                : "hsl(var(--muted-foreground))",
            }}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search organizations..."
            className="pl-10 pr-4 h-11 rounded-xl border-border/70 bg-card text-sm placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:border-primary/50 transition-all duration-200"
            data-testid="input-search-orgs"
          />
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:gap-4">
            {[0, 1, 2].map((i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="text-center py-16 rounded-2xl border border-dashed border-border/60"
            style={{
              opacity: headerVisible ? 1 : 0,
              transition: "opacity 0.4s ease 0.2s",
            }}
          >
            <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-4">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p
              className="text-sm font-medium text-foreground"
              data-testid="text-no-results"
            >
              {search ? "No organizations found" : "No organizations yet"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {search
                ? `No results for "${search}" — try a different name.`
                : "Check back soon or contact your coach."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4">
            {filtered.map((org, i) => (
              <OrgCard key={org.id} org={org} index={i} />
            ))}
          </div>
        )}

        <div
          className="text-center mt-12 text-[11px] text-muted-foreground/50"
          style={{
            opacity: headerVisible ? 1 : 0,
            transition: "opacity 0.5s ease 0.3s",
          }}
        >
          Secure platform powered by{" "}
          <span className="font-semibold text-muted-foreground/70">
            TrainEfficiency
          </span>
        </div>
      </div>
    </div>
  );
}
