import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Trophy, Star, Loader2, AlertCircle, ChevronRight } from "lucide-react";

interface CheckinField {
  id: string;
  field_name: string;
  label: string;
  field_type: string;
  visibility: string;
  display_order: number;
}

interface RewardTier {
  id: string;
  visit_count: number;
  reward_name: string;
  reward_description?: string;
  active: boolean;
}

interface CheckinPageData {
  program: { name: string; slug: string };
  config: { description?: string; location?: string; active: boolean } | null;
  fields: CheckinField[];
  rewards: RewardTier[];
  orgBranding: { name: string; color: string };
  programId: string;
  organizationId: string;
}

export default function AttendanceCheckinPage() {
  const { slug } = useParams<{ slug: string }>();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{
    visitNumber: number;
    nextReward: RewardTier | null;
    rewardsEarned: RewardTier[];
    visitsToNext: number | null;
  } | null>(null);

  const { data, isLoading, error } = useQuery<CheckinPageData>({
    queryKey: ["/api/attendance/checkin", slug],
    queryFn: async () => {
      const r = await fetch(`/api/attendance/checkin/${slug}`);
      if (!r.ok) throw new Error("Program not found");
      return r.json();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (body: Record<string, string>) => {
      const r = await fetch(`/api/attendance/checkin/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setSubmitted(true);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields inline — show errors next to each field
    const visibleFields = data?.fields ?? [];
    const errors: Record<string, string> = {};
    for (const f of visibleFields) {
      if (f.visibility === "required" && !formData[f.field_name]?.trim()) {
        errors[f.field_name] = `${f.label} is required`;
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    submitMutation.mutate({
      firstName:  formData.first_name  || "",
      lastName:   formData.last_name   || "",
      email:      formData.email       || "",
      phone:      formData.phone       || "",
      sport:      formData.sport       || "",
      position:   formData.position    || "",
      school:     formData.school      || "",
      gradYear:   formData.grad_year   || "",
      team:       formData.team        || "",
      age:        formData.age         || "",
    });
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-green-500 mx-auto" />
          <p className="text-gray-400 text-sm">Loading check-in...</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center space-y-3 max-w-sm">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
          <h2 className="text-white text-lg font-semibold">Program Not Found</h2>
          <p className="text-gray-400 text-sm">This check-in link is invalid or the program is no longer active.</p>
        </div>
      </div>
    );
  }

  const { program, config, fields, rewards, orgBranding } = data;
  const color = orgBranding.color || "#16a34a";

  // Separate visible fields: required + optional (hidden already excluded by backend)
  const visibleFields = fields.filter(f => f.visibility !== "hidden");

  // ── Confirmation screen ──────────────────────────────────────────────────
  if (submitted && result) {
    const newlyEarnedReward = result.rewardsEarned.find(r => r.visit_count === result.visitNumber);
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-2">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{ backgroundColor: color + "22", border: `2px solid ${color}` }}
            >
              {newlyEarnedReward ? (
                <Trophy className="h-8 w-8" style={{ color }} />
              ) : (
                <CheckCircle2 className="h-8 w-8" style={{ color }} />
              )}
            </div>
            <h1 className="text-2xl font-bold text-white">
              {newlyEarnedReward ? "Reward Unlocked! 🏆" : "You're Checked In! ✓"}
            </h1>
            <p className="text-gray-400 text-sm">{orgBranding.name}</p>
          </div>

          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 space-y-4">
              <div className="text-center">
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Total Sessions</p>
                <p className="text-5xl font-black" style={{ color }}>{result.visitNumber}</p>
              </div>

              {newlyEarnedReward && (
                <div
                  className="rounded-lg p-4 text-center"
                  style={{ backgroundColor: color + "18", border: `1px solid ${color}44` }}
                >
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">You Earned</p>
                  <p className="text-lg font-bold text-white">{newlyEarnedReward.reward_name}</p>
                  {newlyEarnedReward.reward_description && (
                    <p className="text-xs text-gray-400 mt-1">{newlyEarnedReward.reward_description}</p>
                  )}
                  <p className="text-xs mt-2 font-medium" style={{ color }}>Stop by the front desk to claim!</p>
                </div>
              )}

              {!newlyEarnedReward && result.nextReward && (
                <div className="rounded-lg p-4 bg-gray-800 border border-gray-700">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Next Reward</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{result.nextReward.reward_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {result.visitsToNext} more session{result.visitsToNext === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold" style={{ color }}>{result.visitNumber}</p>
                      <p className="text-xs text-gray-500">/ {result.nextReward.visit_count}</p>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(100, (result.visitNumber / result.nextReward.visit_count) * 100)}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              )}

              {!result.nextReward && (
                <div className="text-center text-sm text-gray-400 bg-gray-800 rounded-lg p-3">
                  🏆 You've earned all rewards. Keep showing up!
                </div>
              )}
            </CardContent>
          </Card>

          {rewards.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider px-1">Reward Milestones</p>
              {rewards.map((tier) => {
                const earned = result.visitNumber >= tier.visit_count;
                return (
                  <div
                    key={tier.id}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm ${
                      earned ? "bg-gray-900 border border-gray-700" : "bg-gray-900/50 border border-gray-800"
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                      style={earned
                        ? { backgroundColor: color + "22", color, border: `1px solid ${color}55` }
                        : { backgroundColor: "#1f2937", color: "#6b7280", border: "1px solid #374151" }
                      }
                    >
                      {tier.visit_count}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium ${earned ? "text-white" : "text-gray-500"}`}>{tier.reward_name}</p>
                    </div>
                    {earned && <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color }} />}
                    {!earned && <ChevronRight className="h-4 w-4 shrink-0 text-gray-700" />}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-center text-xs text-gray-600 pb-4">A confirmation email has been sent.</p>
        </div>
      </div>
    );
  }

  // ── Check-in form ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-5">

        {/* Header */}
        <div className="text-center space-y-1.5">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto"
            style={{ backgroundColor: color + "22", border: `1.5px solid ${color}44` }}
          >
            <Star className="h-6 w-6" style={{ color }} />
          </div>
          <h1 className="text-xl font-bold text-white">{program.name}</h1>
          <p className="text-sm text-gray-400">{orgBranding.name}</p>
          {config?.location && (
            <Badge variant="secondary" className="text-xs bg-gray-800 text-gray-300 border-0">
              📍 {config.location}
            </Badge>
          )}
          {config?.description && (
            <p className="text-xs text-gray-500">{config.description}</p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3" data-testid="form-checkin" noValidate>
          {visibleFields.map((field) => {
            const inputType =
              field.field_type === "email" ? "email" :
              field.field_type === "phone" ? "tel" :
              field.field_type === "number" ? "number" : "text";

            const placeholder =
              field.field_name === "email"    ? "your@email.com" :
              field.field_name === "phone"    ? "(555) 000-0000" :
              field.field_name === "grad_year"? "2025" : "";

            const hasError = !!fieldErrors[field.field_name];

            return (
              <div key={field.id} className="space-y-1" data-testid={`field-wrapper-${field.field_name}`}>
                <Label className="text-xs text-gray-300 font-medium">
                  {field.label}
                  {field.visibility === "required" && (
                    <span className="text-red-400 ml-0.5">*</span>
                  )}
                  {field.visibility === "optional" && (
                    <span className="text-gray-600 ml-1 font-normal">(optional)</span>
                  )}
                </Label>
                <Input
                  type={inputType}
                  value={formData[field.field_name] || ""}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, [field.field_name]: e.target.value }));
                    // Clear inline error as user types
                    if (fieldErrors[field.field_name]) {
                      setFieldErrors(prev => { const n = { ...prev }; delete n[field.field_name]; return n; });
                    }
                  }}
                  placeholder={placeholder}
                  className={`h-12 w-full text-sm bg-gray-900 border text-white placeholder:text-gray-600 focus:border-gray-400 rounded-lg ${
                    hasError ? "border-red-500 focus:border-red-400" : "border-gray-700"
                  }`}
                  autoComplete={
                    field.field_name === "email"      ? "email" :
                    field.field_name === "first_name" ? "given-name" :
                    field.field_name === "last_name"  ? "family-name" :
                    field.field_name === "phone"      ? "tel" : "off"
                  }
                  data-testid={`input-checkin-${field.field_name}`}
                />
                {hasError && (
                  <p className="text-xs text-red-400 flex items-center gap-1" data-testid={`error-${field.field_name}`}>
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {fieldErrors[field.field_name]}
                  </p>
                )}
              </div>
            );
          })}

          {/* Server-side error (non-validation, e.g. network failure) */}
          {submitMutation.error && (
            <p className="text-xs text-red-400 text-center flex items-center justify-center gap-1" data-testid="text-checkin-error">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {(submitMutation.error as Error).message || "Something went wrong. Please try again."}
            </p>
          )}

          <Button
            type="submit"
            className="w-full h-12 text-base font-semibold rounded-xl mt-2 text-white"
            style={{ backgroundColor: color }}
            disabled={submitMutation.isPending}
            data-testid="button-checkin-submit"
          >
            {submitMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Checking in...</>
            ) : "Check In"}
          </Button>
        </form>

        {/* Reward milestones preview */}
        {rewards.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wider text-center">Reward Milestones</p>
            <div className="space-y-1.5">
              {rewards.map((tier) => (
                <div key={tier.id} className="flex items-center gap-3 bg-gray-900 rounded-lg px-3 py-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: color + "22", color, border: `1px solid ${color}44` }}
                  >
                    {tier.visit_count}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-200 font-medium truncate">{tier.reward_name}</p>
                    {tier.reward_description && (
                      <p className="text-xs text-gray-500 truncate">{tier.reward_description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
