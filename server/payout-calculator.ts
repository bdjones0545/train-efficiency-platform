import type { Service } from "@shared/schema";

export interface PayoutResult {
  coachPayoutCents: number;
  payoutSource: "booking_price" | "fixed" | "hourly" | "package_redemption" | "none";
  payoutExplanation: string;
}

export function calculateCoachPayoutForBooking(
  service: Service,
  bookingDurationMinutes: number,
  bookingPriceCents: number,
  coachDefaultPayoutPercent: number | null,
  redemptionValueCents?: number
): PayoutResult {
  const payoutType = service.payoutType ?? "percentage";

  if (payoutType === "none") {
    return {
      coachPayoutCents: 0,
      payoutSource: "none",
      payoutExplanation: "No coach payout configured for this session type.",
    };
  }

  if (payoutType === "fixed") {
    const fixedCents = service.payoutValueCents ?? 0;
    return {
      coachPayoutCents: fixedCents,
      payoutSource: "fixed",
      payoutExplanation: `Coach earns a fixed $${(fixedCents / 100).toFixed(2)} for this session.`,
    };
  }

  if (payoutType === "hourly") {
    const hourlyRateCents = service.payoutValueCents ?? 0;
    const hours = bookingDurationMinutes / 60;
    const payoutCents = Math.round(hourlyRateCents * hours);
    return {
      coachPayoutCents: payoutCents,
      payoutSource: "hourly",
      payoutExplanation: `Coach earns $${(hourlyRateCents / 100).toFixed(2)}/hr × ${hours.toFixed(2)}h = $${(payoutCents / 100).toFixed(2)}.`,
    };
  }

  // payoutType === "percentage"
  const percent = service.payoutPercent ?? coachDefaultPayoutPercent ?? 50;

  // Determine eligible revenue for percentage calculation
  const category = service.category ?? "paid";
  const revenueRecognition = service.revenueRecognition ?? "at_booking";

  let eligibleRevenueCents = 0;
  let payoutSource: PayoutResult["payoutSource"] = "none";

  if (service.countsTowardRevenue && bookingPriceCents > 0) {
    eligibleRevenueCents = bookingPriceCents;
    payoutSource = "booking_price";
  } else if (revenueRecognition === "at_purchase" && redemptionValueCents && redemptionValueCents > 0) {
    eligibleRevenueCents = redemptionValueCents;
    payoutSource = "package_redemption";
  } else if (
    (category === "membership" || category === "package_redemption") &&
    service.coachPayWhenRedeemed
  ) {
    // Coach gets paid on redemption even if booking price is $0
    eligibleRevenueCents = redemptionValueCents ?? 0;
    payoutSource = eligibleRevenueCents > 0 ? "package_redemption" : "none";
  }

  if (eligibleRevenueCents === 0) {
    return {
      coachPayoutCents: 0,
      payoutSource: "none",
      payoutExplanation: `${percent}% payout on $0 eligible revenue = $0. No revenue basis for this session.`,
    };
  }

  const payoutCents = Math.round(eligibleRevenueCents * (percent / 100));
  return {
    coachPayoutCents: payoutCents,
    payoutSource,
    payoutExplanation: `Coach earns ${percent}% of $${(eligibleRevenueCents / 100).toFixed(2)} = $${(payoutCents / 100).toFixed(2)}.`,
  };
}

export function getServiceCategoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "paid": return "Paid";
    case "intro": return "Intro";
    case "internal": return "Internal";
    case "meeting": return "Meeting";
    case "membership": return "Membership";
    case "package_redemption": return "Package";
    case "comp": return "Comp";
    default: return "Paid";
  }
}

export function getPayoutLabel(service: Service): string {
  const payoutType = service.payoutType ?? "percentage";
  if (payoutType === "none") return "No payout";
  if (payoutType === "fixed") {
    return `$${((service.payoutValueCents ?? 0) / 100).toFixed(0)} fixed`;
  }
  if (payoutType === "hourly") {
    return `$${((service.payoutValueCents ?? 0) / 100).toFixed(0)}/hr`;
  }
  return `${service.payoutPercent ?? "?"}% payout`;
}
