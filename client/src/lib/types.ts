import type { User } from "@shared/models/auth";
import type { CoachProfile, Service, AvailabilityBlock, Booking, BookingParticipant, Redemption, UserProfile, Cashout } from "@shared/schema";

export type CoachWithUser = CoachProfile & {
  user: User;
};

export type BookingWithDetails = Booking & {
  client?: User;
  coach?: CoachWithUser;
  service?: Service;
};

export type ParticipantWithUser = BookingParticipant & {
  user: User;
};

export type OpenSession = Booking & {
  service?: Service;
  coach?: Omit<CoachProfile, 'passwordHash' | 'email'> & { user: User };
  participantCount: number;
};

export type RedemptionWithDetails = Redemption & {
  booking?: BookingWithDetails;
};

export type CashoutWithDetails = Cashout & {};

export type TimeSlot = {
  start: string;
  end: string;
  available: boolean;
  location?: string;
};

export type DaySlots = {
  date: string;
  dayLabel: string;
  slots: TimeSlot[];
};
