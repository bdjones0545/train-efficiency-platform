import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, ArrowRight } from "lucide-react";
import type { Organization } from "@shared/schema";
import estLogo from "@assets/IMG_7961_1771105509253.jpeg";

export default function ClientPortalPage() {
  const [search, setSearch] = useState("");

  const { data: orgs, isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/organizations"],
  });

  const filtered = (orgs || []).filter((org) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return org.name.toLowerCase().includes(q) || org.slug.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-10 space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" data-testid="text-portal-heading">
            Client Portal
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Find your training organization and access your coaching portal.
          </p>
        </div>

        <div className="relative max-w-md mx-auto mb-10">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organizations..."
            className="pl-10"
            data-testid="input-search-orgs"
          />
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-6 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-muted" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground" data-testid="text-no-results">
              {search ? "No organizations found matching your search." : "No organizations available yet."}
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {filtered.map((org) => (
              <a
                key={org.id}
                href={org.slug === "efficiencystrength" ? "/efficiencystrength" : `/org/${org.slug}`}
                className="block group"
                data-testid={`card-org-${org.slug}`}
              >
                <Card className="p-5 h-full transition-all hover:border-primary/40 hover:shadow-md group-hover:bg-accent/30">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12 shrink-0">
                      {(org.logoUrl || org.slug === "efficiencystrength") ? (
                        <AvatarImage src={org.logoUrl || (org.slug === "efficiencystrength" ? estLogo : undefined)} alt={org.name} />
                      ) : null}
                      <AvatarFallback
                        className="text-sm font-semibold"
                        style={org.primaryColor ? { backgroundColor: `${org.primaryColor}20`, color: org.primaryColor } : undefined}
                      >
                        {org.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate" data-testid={`text-org-name-${org.slug}`}>
                        {org.name}
                      </h3>
                      {org.tagline && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{org.tagline}</p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                  </div>
                </Card>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
