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
import { Users, DollarSign, Send, FileText, Dumbbell, Zap, ExternalLink, Calendar } from "lucide-react";
import type { TeamQuote } from "@shared/schema";

const FREQUENCY_OPTIONS = [
  { value: "1x/week", label: "1x per week" },
  { value: "2x/week", label: "2x per week" },
  { value: "3x/week", label: "3x per week" },
  { value: "4x/week", label: "4x per week" },
  { value: "5x/week", label: "5x per week" },
];

const DURATION_OPTIONS = [
  { value: 1, label: "1 month" },
  { value: 2, label: "2 months" },
  { value: 3, label: "3 months" },
  { value: 4, label: "4 months" },
  { value: 5, label: "5 months" },
  { value: 6, label: "6 months" },
  { value: 9, label: "9 months" },
  { value: 12, label: "12 months" },
];

export default function TeamQuotesPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [teamName, setTeamName] = useState("");
  const [numberOfAthletes, setNumberOfAthletes] = useState("");
  const [costPerAthlete, setCostPerAthlete] = useState("");
  const [trainingType, setTrainingType] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("");
  const [durationMonths, setDurationMonths] = useState<string>("");
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
      toast({ title: "Quote sent!", description: "The first monthly Stripe invoice has been created and emailed." });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/team-quotes"] });
      setTeamName("");
      setNumberOfAthletes("");
      setCostPerAthlete("");
      setTrainingType("");
      setFrequency("");
      setDurationMonths("");
      setCoachEmail(user?.email || "");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create quote", variant: "destructive" });
    },
  });

  const numAthletes = parseInt(numberOfAthletes) || 0;
  const costCents = Math.round((parseFloat(costPerAthlete) || 0) * 100);
  const monthlyCents = numAthletes * costCents;
  const months = parseInt(durationMonths) || 0;
  const programTotalCents = monthlyCents * months;
  const monthlyDisplay = `$${(monthlyCents / 100).toFixed(2)}`;
  const programTotalDisplay = `$${(programTotalCents / 100).toFixed(2)}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!teamName || !numAthletes || !costCents || !trainingType || !frequency || !durationMonths || !coachEmail) {
      toast({ title: "Missing fields", description: "Please fill in all fields", variant: "destructive" });
      return;
    }

    createQuoteMutation.mutate({
      teamName,
      numberOfAthletes: numAthletes,
      costPerAthleteCents: costCents,
      trainingType,
      frequency,
      durationMonths: parseInt(durationMonths),
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

  const groupedQuotes = quotes ? groupQuotesByTeam(quotes) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-team-quotes-title">Team Quotes</h1>
        <p className="text-muted-foreground mt-1">Generate team training quotes with monthly Stripe invoicing</p>
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
              <Label htmlFor="costPerAthlete">Cost per Athlete / Month ($)</Label>
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
              <Select value={durationMonths} onValueChange={setDurationMonths}>
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
              <p className="text-xs text-muted-foreground">Monthly Stripe invoices will be sent to this email</p>
            </div>
          </div>

          {numAthletes > 0 && costCents > 0 && (
            <Card className="p-4 bg-primary/5 border-primary/20">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Quote Summary</p>
                  <p className="text-sm" data-testid="text-quote-calculation">
                    {numAthletes} athletes x ${(costCents / 100).toFixed(2)}/mo per athlete
                  </p>
                </div>
                <div className="text-right space-y-0.5">
                  <p className="text-2xl font-bold text-primary" data-testid="text-quote-total">{monthlyDisplay}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                  {months > 1 && (
                    <p className="text-xs text-muted-foreground" data-testid="text-program-total">
                      {months} months = {programTotalDisplay} total
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={createQuoteMutation.isPending || !teamName || !numAthletes || !costCents || !trainingType || !frequency || !durationMonths || !coachEmail}
            data-testid="button-generate-quote"
          >
            {createQuoteMutation.isPending ? (
              <>Generating Quote...</>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Generate Quote & Send First Invoice
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
          <div className="space-y-4">
            {groupedQuotes.map((group) => (
              <Card key={group.key} className="p-4" data-testid={`card-quote-group-${group.key}`}>
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-base">{group.teamName}</h3>
                    <Badge variant="outline">
                      {group.trainingType === "STRENGTH" ? (
                        <span className="flex items-center gap-1"><Dumbbell className="h-3 w-3" /> Strength</span>
                      ) : (
                        <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> Speed</span>
                      )}
                    </Badge>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <Users className="h-3 w-3 inline mr-1" />
                    {group.numberOfAthletes} athletes | {group.frequency} | {group.totalMonths} month program
                  </div>
                </div>

                {group.totalMonths > 1 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Payment Progress</span>
                      <span>{group.paidCount} of {group.totalMonths} months paid</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${(group.paidCount / group.totalMonths) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {group.invoices.map((quote) => (
                    <div
                      key={quote.id}
                      className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/30 flex-wrap"
                      data-testid={`row-invoice-${quote.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-medium">
                          {quote.totalMonths > 1 ? `Month ${quote.currentMonth}` : 'Invoice'}
                        </span>
                        <Badge
                          variant={statusColor(quote.status)}
                          className={quote.status === 'PAID' ? 'bg-green-600 text-white' : ''}
                          data-testid={`badge-quote-status-${quote.id}`}
                        >
                          {quote.status}
                        </Badge>
                        {quote.createdAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(quote.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold" data-testid={`text-quote-amount-${quote.id}`}>
                          ${(quote.totalCents / 100).toFixed(2)}
                        </span>
                        {quote.stripeInvoiceUrl && (
                          <a
                            href={quote.stripeInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                            data-testid={`link-invoice-${quote.id}`}
                          >
                            <ExternalLink className="h-3 w-3" />
                            Invoice
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-border text-sm">
                  <span className="text-muted-foreground">{group.coachEmail}</span>
                  <span className="font-semibold">
                    ${(group.monthlyAmount / 100).toFixed(2)}/mo
                    {group.totalMonths > 1 && (
                      <span className="text-xs text-muted-foreground ml-1">
                        (${((group.monthlyAmount * group.totalMonths) / 100).toFixed(2)} total)
                      </span>
                    )}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface QuoteGroup {
  key: string;
  teamName: string;
  trainingType: string;
  numberOfAthletes: number;
  frequency: string;
  totalMonths: number;
  monthlyAmount: number;
  coachEmail: string;
  paidCount: number;
  invoices: TeamQuote[];
}

function groupQuotesByTeam(quotes: TeamQuote[]): QuoteGroup[] {
  const groups = new Map<string, QuoteGroup>();

  for (const quote of quotes) {
    const key = quote.programId || `${quote.teamName}-${quote.createdByCoachId}-${quote.totalMonths}-${quote.costPerAthleteCents}-${quote.numberOfAthletes}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        teamName: quote.teamName,
        trainingType: quote.trainingType,
        numberOfAthletes: quote.numberOfAthletes,
        frequency: quote.frequency,
        totalMonths: quote.totalMonths,
        monthlyAmount: quote.totalCents,
        coachEmail: quote.coachEmail,
        paidCount: 0,
        invoices: [],
      });
    }

    const group = groups.get(key)!;
    group.invoices.push(quote);
    if (quote.status === 'PAID') {
      group.paidCount++;
    }
  }

  const result: QuoteGroup[] = [];
  groups.forEach((group) => {
    group.invoices.sort((a: TeamQuote, b: TeamQuote) => a.currentMonth - b.currentMonth);
    result.push(group);
  });

  return result.sort((a: QuoteGroup, b: QuoteGroup) => {
    const aDate = a.invoices[0]?.createdAt ? new Date(a.invoices[0].createdAt).getTime() : 0;
    const bDate = b.invoices[0]?.createdAt ? new Date(b.invoices[0].createdAt).getTime() : 0;
    return bDate - aDate;
  });
}
