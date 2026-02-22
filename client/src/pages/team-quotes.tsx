import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Users, DollarSign, Send, FileText, Dumbbell, Zap, ExternalLink } from "lucide-react";
import type { TeamQuote } from "@shared/schema";

const FREQUENCY_OPTIONS = [
  { value: "1x/week", label: "1x per week" },
  { value: "2x/week", label: "2x per week" },
  { value: "3x/week", label: "3x per week" },
  { value: "4x/week", label: "4x per week" },
  { value: "5x/week", label: "5x per week" },
];

const DURATION_OPTIONS = [
  { value: 4, label: "4 weeks" },
  { value: 6, label: "6 weeks" },
  { value: 8, label: "8 weeks" },
  { value: 10, label: "10 weeks" },
  { value: 12, label: "12 weeks" },
  { value: 16, label: "16 weeks" },
  { value: 24, label: "24 weeks" },
];

export default function TeamQuotesPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [teamName, setTeamName] = useState("");
  const [numberOfAthletes, setNumberOfAthletes] = useState("");
  const [costPerAthlete, setCostPerAthlete] = useState("");
  const [trainingType, setTrainingType] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("");
  const [durationWeeks, setDurationWeeks] = useState<string>("");
  const [coachEmail, setCoachEmail] = useState(user?.email || "");

  useEffect(() => {
    if (user?.email && !coachEmail) {
      setCoachEmail(user.email);
    }
  }, [user?.email]);

  const { data: quotes, isLoading } = useQuery<TeamQuote[]>({
    queryKey: ["/api/coach/team-quotes"],
  });

  const createQuoteMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/coach/team-quotes", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Quote sent!", description: "The Stripe invoice has been created and emailed." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/team-quotes"] });
      setTeamName("");
      setNumberOfAthletes("");
      setCostPerAthlete("");
      setTrainingType("");
      setFrequency("");
      setDurationWeeks("");
      setCoachEmail(user?.email || "");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create quote", variant: "destructive" });
    },
  });

  const numAthletes = parseInt(numberOfAthletes) || 0;
  const costCents = Math.round((parseFloat(costPerAthlete) || 0) * 100);
  const totalCents = numAthletes * costCents;
  const totalDisplay = `$${(totalCents / 100).toFixed(2)}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!teamName || !numAthletes || !costCents || !trainingType || !frequency || !durationWeeks || !coachEmail) {
      toast({ title: "Missing fields", description: "Please fill in all fields", variant: "destructive" });
      return;
    }

    createQuoteMutation.mutate({
      teamName,
      numberOfAthletes: numAthletes,
      costPerAthleteCents: costCents,
      trainingType,
      frequency,
      durationWeeks: parseInt(durationWeeks),
      coachEmail,
    });
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "DRAFT": return "secondary";
      case "SENT": return "default";
      case "PAID": return "default";
      case "EXPIRED": return "destructive";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-team-quotes-title">Team Quotes</h1>
        <p className="text-muted-foreground mt-1">Generate team training quotes with Stripe invoicing</p>
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="text-new-quote-heading">
          <FileText className="h-5 w-5" />
          New Team Quote
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="teamName">Team Name</Label>
              <Input
                id="teamName"
                placeholder="e.g. Bluffton High Football"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                data-testid="input-team-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="numberOfAthletes">Number of Athletes</Label>
              <Input
                id="numberOfAthletes"
                type="number"
                min="1"
                placeholder="e.g. 25"
                value={numberOfAthletes}
                onChange={(e) => setNumberOfAthletes(e.target.value)}
                data-testid="input-number-athletes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="costPerAthlete">Cost per Athlete ($)</Label>
              <Input
                id="costPerAthlete"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 25.00"
                value={costPerAthlete}
                onChange={(e) => setCostPerAthlete(e.target.value)}
                data-testid="input-cost-per-athlete"
              />
            </div>
            <div className="space-y-2">
              <Label>Training Type</Label>
              <Select value={trainingType} onValueChange={setTrainingType}>
                <SelectTrigger data-testid="select-training-type">
                  <SelectValue placeholder="Select training type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STRENGTH">
                    <span className="flex items-center gap-2">
                      <Dumbbell className="h-4 w-4" />
                      Strength
                    </span>
                  </SelectItem>
                  <SelectItem value="SPEED">
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Speed
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger data-testid="select-frequency">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Program Duration</Label>
              <Select value={durationWeeks} onValueChange={setDurationWeeks}>
                <SelectTrigger data-testid="select-duration">
                  <SelectValue placeholder="Select duration" />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value.toString()}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="coachEmail">Coach / Team Contact Email</Label>
              <Input
                id="coachEmail"
                type="email"
                placeholder="coach@school.edu"
                value={coachEmail}
                onChange={(e) => setCoachEmail(e.target.value)}
                data-testid="input-coach-email"
              />
              <p className="text-xs text-muted-foreground">The Stripe invoice and quote details will be sent to this email</p>
            </div>
          </div>

          {numAthletes > 0 && costCents > 0 && (
            <Card className="p-4 bg-primary/5 border-primary/20">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Quote Summary</p>
                  <p className="text-sm" data-testid="text-quote-calculation">
                    {numAthletes} athletes × ${(costCents / 100).toFixed(2)} per athlete
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary" data-testid="text-quote-total">{totalDisplay}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
              </div>
            </Card>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={createQuoteMutation.isPending || !teamName || !numAthletes || !costCents || !trainingType || !frequency || !durationWeeks || !coachEmail}
            data-testid="button-generate-quote"
          >
            {createQuoteMutation.isPending ? (
              <>Generating Quote...</>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Generate Quote & Send Invoice
              </>
            )}
          </Button>
        </form>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Quote History
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : !quotes || quotes.length === 0 ? (
          <Card className="p-8 text-center">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No quotes generated yet</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {quotes.map((quote) => (
              <Card key={quote.id} className="p-4" data-testid={`card-quote-${quote.id}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold" data-testid={`text-quote-team-${quote.id}`}>{quote.teamName}</h3>
                      <Badge variant={statusColor(quote.status)} data-testid={`badge-quote-status-${quote.id}`}>
                        {quote.status}
                      </Badge>
                      <Badge variant="outline">
                        {quote.trainingType === "STRENGTH" ? (
                          <span className="flex items-center gap-1"><Dumbbell className="h-3 w-3" /> Strength</span>
                        ) : (
                          <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> Speed</span>
                        )}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <Users className="h-3 w-3 inline mr-1" />
                      {quote.numberOfAthletes} athletes × ${(quote.costPerAthleteCents / 100).toFixed(2)} • {quote.frequency} • {quote.durationWeeks} weeks
                    </p>
                    <p className="text-xs text-muted-foreground">{quote.coachEmail}</p>
                    {quote.createdAt && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(quote.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    )}
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-xl font-bold" data-testid={`text-quote-amount-${quote.id}`}>
                      ${(quote.totalCents / 100).toFixed(2)}
                    </p>
                    {quote.stripeInvoiceUrl && (
                      <a
                        href={quote.stripeInvoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1 justify-end"
                        data-testid={`link-invoice-${quote.id}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                        View Invoice
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
