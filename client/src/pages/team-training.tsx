import { TrainLogo } from "@/components/train-logo";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Users, MapPin, Trophy, Target, Send, CheckCircle } from "lucide-react";

const SPORT_OPTIONS = [
  "Football",
  "Basketball",
  "Baseball",
  "Softball",
  "Soccer",
  "Track & Field",
  "Volleyball",
  "Tennis",
  "Swimming",
  "Wrestling",
  "Lacrosse",
  "Golf",
  "Cheerleading",
  "Cross Country",
  "Other",
];

const SCHEDULE_OPTIONS = [
  "1x per week",
  "2x per week",
  "3x per week",
  "4x per week",
  "5x per week",
  "Flexible / To be discussed",
];

export default function TeamTrainingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);

  const [teamName, setTeamName] = useState("");
  const [contactName, setContactName] = useState(
    user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : ""
  );
  const [contactEmail, setContactEmail] = useState(user?.email || "");

  useEffect(() => {
    if (user) {
      const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
      if (name && !contactName) setContactName(name);
      if (user.email && !contactEmail) setContactEmail(user.email);
    }
  }, [user]);

  const [contactPhone, setContactPhone] = useState("");
  const [location, setLocation] = useState("");
  const [sport, setSport] = useState("");
  const [numberOfAthletes, setNumberOfAthletes] = useState("");
  const [goals, setGoals] = useState("");
  const [preferredSchedule, setPreferredSchedule] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const submitMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/team-training-request", data);
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "Request Submitted!", description: "We'll review your info and get back to you shortly." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to submit request", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!teamName || !contactName || !contactEmail || !sport || !numberOfAthletes || !goals || !location) {
      toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    submitMutation.mutate({
      teamName,
      contactName,
      contactEmail,
      contactPhone,
      location,
      sport,
      numberOfAthletes: parseInt(numberOfAthletes),
      goals,
      preferredSchedule,
      additionalNotes,
    });
  };

  if (submitted) {
    return (
      <div className="space-y-6">
        <Card className="p-8 text-center max-w-lg mx-auto">
          <CheckCircle className="h-16 w-16 mx-auto text-primary mb-4" />
          <h1 className="text-2xl font-bold mb-2" data-testid="text-request-success">Request Submitted!</h1>
          <p className="text-muted-foreground mb-6">
            Thank you for your interest in team training with Efficiency Strength Training.
            We've received your request and will be in touch shortly to discuss your team's program.
          </p>
          <Button onClick={() => setSubmitted(false)} variant="outline" data-testid="button-submit-another">
            Submit Another Request
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-team-training-title">
          <TrainLogo className="h-6 w-6 text-primary" />
          Team Training
        </h1>
        <p className="text-muted-foreground mt-1">
          Request a custom training program for your team. Fill out the details below and we'll put together a tailored quote.
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="teamName" className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-primary" />
                Team Name *
              </Label>
              <Input
                id="teamName"
                placeholder="e.g. Bluffton High Football"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                data-testid="input-team-name"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-primary" />
                Sport *
              </Label>
              <Select value={sport} onValueChange={setSport}>
                <SelectTrigger data-testid="select-sport">
                  <SelectValue placeholder="Select sport" />
                </SelectTrigger>
                <SelectContent>
                  {SPORT_OPTIONS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="numberOfAthletes" className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-primary" />
                Number of Athletes *
              </Label>
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

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="location" className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                Training Location *
              </Label>
              <Input
                id="location"
                placeholder="e.g. Bluffton High School, Oscar Frazier Park"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                data-testid="input-location"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="goals">Training Goals *</Label>
              <Textarea
                id="goals"
                placeholder="What are your team's training goals? e.g. Off-season strength program, speed development, injury prevention..."
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                rows={3}
                data-testid="input-goals"
              />
            </div>

            <div className="space-y-2">
              <Label>Preferred Schedule</Label>
              <Select value={preferredSchedule} onValueChange={setPreferredSchedule}>
                <SelectTrigger data-testid="select-schedule">
                  <SelectValue placeholder="Select preferred frequency" />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_OPTIONS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t pt-5 mt-2">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">CONTACT INFORMATION</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contactName">Contact Name *</Label>
                <Input
                  id="contactName"
                  placeholder="Your name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  data-testid="input-contact-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactEmail">Email *</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  placeholder="your@email.com"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  data-testid="input-contact-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactPhone">Phone</Label>
                <Input
                  id="contactPhone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  data-testid="input-contact-phone"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="additionalNotes">Additional Notes</Label>
            <Textarea
              id="additionalNotes"
              placeholder="Anything else we should know? Budget considerations, time constraints, special requirements..."
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              rows={3}
              data-testid="input-additional-notes"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={submitMutation.isPending || !teamName || !contactName || !contactEmail || !sport || !numberOfAthletes || !goals || !location}
            data-testid="button-submit-request"
          >
            {submitMutation.isPending ? (
              <>Submitting Request...</>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Team Training Request
              </>
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}
