import type { User } from "@shared/models/auth";
import type { CoachProfile, Service, AvailabilityBlock, Booking, Redemption, UserProfile } from "@shared/schema";

export type CoachWithUser = CoachProfile & {
  user: User;
};

export type BookingWithDetails = Booking & {
  client?: User;
  coach?: CoachWithUser;
  service?: Service;
};

export type RedemptionWithDetails = Redemption & {
  booking?: BookingWithDetails;
};

export type TimeSlot = {
  start: string;
  end: string;
  available: boolean;
};

export type DaySlots = {
  date: string;
  dayLabel: string;
  slots: TimeSlot[];
};
