import type { OrgType } from "@shared/schema";

export interface OrgPreset {
  label: string;
  description: string;
  nav: {
    athletes: string;
    revenue: string;
    leads: string;
    businessLeads: string;
    pipeline: string;
    schedule: string;
    groupSessions: string;
    teamTraining: string;
  };
  home: {
    revenueLabel: string;
    leadsLabel: string;
    utilizationLabel: string;
    retentionLabel: string;
    snapshotTitle: string;
  };
  onboarding: {
    recommendedAction: string;
    recommendedRoute: string;
    welcomeMessage: string;
  };
}

export const ORG_PRESETS: Record<OrgType, OrgPreset> = {
  performance_facility: {
    label: "Performance Facility",
    description: "Strength & conditioning, sports performance training",
    nav: {
      athletes: "Athletes",
      revenue: "Revenue",
      leads: "Athlete Leads",
      businessLeads: "Business Leads",
      pipeline: "Pipeline",
      schedule: "Schedule",
      groupSessions: "Group Sessions",
      teamTraining: "Team Training",
    },
    home: {
      revenueLabel: "Revenue",
      leadsLabel: "Leads",
      utilizationLabel: "Utilization",
      retentionLabel: "Retention",
      snapshotTitle: "Business Snapshot",
    },
    onboarding: {
      recommendedAction: "Create First Session",
      recommendedRoute: "/sessions",
      welcomeMessage: "Set up your first group session to start training athletes.",
    },
  },

  sports_team: {
    label: "Sports Team",
    description: "Organized team sports, leagues, and club teams",
    nav: {
      athletes: "Players",
      revenue: "Fundraising",
      leads: "Recruiting",
      businessLeads: "Partnerships",
      pipeline: "Recruiting Pipeline",
      schedule: "Practices",
      groupSessions: "Team Sessions",
      teamTraining: "Team Training",
    },
    home: {
      revenueLabel: "Fundraising",
      leadsLabel: "Recruits",
      utilizationLabel: "Practice Load",
      retentionLabel: "Player Retention",
      snapshotTitle: "Team Snapshot",
    },
    onboarding: {
      recommendedAction: "Import Roster",
      recommendedRoute: "/coach/users",
      welcomeMessage: "Import your player roster to get your team set up.",
    },
  },

  sports_academy: {
    label: "Sports Academy",
    description: "Multi-sport or single-sport development academy",
    nav: {
      athletes: "Athletes",
      revenue: "Revenue",
      leads: "Prospect Athletes",
      businessLeads: "Partnerships",
      pipeline: "Enrollment Pipeline",
      schedule: "Schedule",
      groupSessions: "Group Training",
      teamTraining: "Academy Teams",
    },
    home: {
      revenueLabel: "Enrollment Revenue",
      leadsLabel: "Prospects",
      utilizationLabel: "Capacity",
      retentionLabel: "Athlete Retention",
      snapshotTitle: "Academy Snapshot",
    },
    onboarding: {
      recommendedAction: "Add Coaches",
      recommendedRoute: "/coaches",
      welcomeMessage: "Add your coaching staff to start building your academy.",
    },
  },

  high_school_program: {
    label: "High School Program",
    description: "High school athletic program or department",
    nav: {
      athletes: "Student Athletes",
      revenue: "Booster Revenue",
      leads: "Recruiting",
      businessLeads: "Sponsors",
      pipeline: "Recruiting Pipeline",
      schedule: "Practice Schedule",
      groupSessions: "Team Workouts",
      teamTraining: "Varsity Training",
    },
    home: {
      revenueLabel: "Booster Revenue",
      leadsLabel: "Recruits",
      utilizationLabel: "Roster Load",
      retentionLabel: "Athlete Retention",
      snapshotTitle: "Program Snapshot",
    },
    onboarding: {
      recommendedAction: "Import Athletes",
      recommendedRoute: "/coach/users",
      welcomeMessage: "Import your student-athletes to get your program running.",
    },
  },

  college_program: {
    label: "College Program",
    description: "NCAA or collegiate athletic program",
    nav: {
      athletes: "Roster",
      revenue: "Program Revenue",
      leads: "Recruiting",
      businessLeads: "NIL Partners",
      pipeline: "Recruiting Pipeline",
      schedule: "Practices",
      groupSessions: "Team Workouts",
      teamTraining: "Position Training",
    },
    home: {
      revenueLabel: "Program Revenue",
      leadsLabel: "Recruits",
      utilizationLabel: "Roster Utilization",
      retentionLabel: "Player Retention",
      snapshotTitle: "Program Snapshot",
    },
    onboarding: {
      recommendedAction: "Create Team Structure",
      recommendedRoute: "/sessions",
      welcomeMessage: "Create your team structure and position groups to get started.",
    },
  },

  private_coach: {
    label: "Private Coach",
    description: "Individual coach or personal training business",
    nav: {
      athletes: "Clients",
      revenue: "Revenue",
      leads: "Client Leads",
      businessLeads: "Referral Partners",
      pipeline: "Sales Pipeline",
      schedule: "Sessions",
      groupSessions: "Group Sessions",
      teamTraining: "Team Clients",
    },
    home: {
      revenueLabel: "Revenue",
      leadsLabel: "Client Leads",
      utilizationLabel: "Schedule Load",
      retentionLabel: "Client Retention",
      snapshotTitle: "Business Snapshot",
    },
    onboarding: {
      recommendedAction: "Create Availability",
      recommendedRoute: "/coach/availability",
      welcomeMessage: "Set your availability so clients can start booking sessions.",
    },
  },
};

export function getOrgPreset(orgType?: string | null): OrgPreset {
  const key = (orgType ?? "performance_facility") as OrgType;
  return ORG_PRESETS[key] ?? ORG_PRESETS.performance_facility;
}

export const ORG_TYPE_OPTIONS: { value: OrgType; label: string; description: string }[] = [
  {
    value: "performance_facility",
    label: "Performance Facility",
    description: "Strength & conditioning, sports performance training",
  },
  {
    value: "sports_team",
    label: "Sports Team",
    description: "Organized team sports, leagues, and club teams",
  },
  {
    value: "sports_academy",
    label: "Sports Academy",
    description: "Multi-sport or single-sport development academy",
  },
  {
    value: "high_school_program",
    label: "High School Program",
    description: "High school athletic program or department",
  },
  {
    value: "college_program",
    label: "College Program",
    description: "NCAA or collegiate athletic program",
  },
  {
    value: "private_coach",
    label: "Private Coach",
    description: "Individual coach or personal training business",
  },
];

export const IMPROVEMENT_GOAL_OPTIONS = [
  { value: "athlete_development", label: "Athlete Development" },
  { value: "scheduling", label: "Scheduling" },
  { value: "team_operations", label: "Team Operations" },
  { value: "recruiting", label: "Recruiting" },
  { value: "revenue_growth", label: "Revenue Growth" },
  { value: "all", label: "All Of The Above" },
];
