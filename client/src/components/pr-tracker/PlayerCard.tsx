import { forwardRef } from "react";
import { format } from "date-fns";

export interface PlayerCardProfile {
  athlete: { id: string; name: string; email: string; createdAt?: string; memberSince?: string | null };
  team: { id: string; name: string; sport: string | null; season: string | null; orgId?: string };
  bestPrs: Array<{ liftTypeId?: string; liftName: string; unit: string; value: number; entryDate: string }>;
  recentEntries: Array<{ id?: string; liftName: string; value: number; unit: string; entryDate: string; notes?: string | null }>;
  upcomingBookings: Array<{ id?: string; date: string; timeSlot: string; teamName?: string; trainingType: string }>;
  notes: string;
  stats: { totalEntries: number; liftTypes: number; upcomingSessions: number };
}

export interface PlayerCardProps {
  profile: PlayerCardProfile;
  orgLogo?: string;
  orgName?: string;
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

const PlayerCard = forwardRef<HTMLDivElement, PlayerCardProps>(({ profile, orgLogo, orgName }, ref) => {
  const { athlete, team, bestPrs, recentEntries, upcomingBookings, notes, stats } = profile;
  const generatedDate = format(new Date(), "MMMM d, yyyy 'at' h:mm a");

  const s: Record<string, React.CSSProperties> = {
    root: { width: "800px", background: "#ffffff", fontFamily: "'Segoe UI', system-ui, Arial, sans-serif", margin: 0, padding: 0, color: "#111827", boxSizing: "border-box" },
    header: { background: "#0f172a", color: "#ffffff", padding: "24px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    headerLeft: { display: "flex", alignItems: "center", gap: "16px" },
    logo: { height: "48px", width: "auto", borderRadius: "8px", objectFit: "contain" as const },
    logoPlaceholder: { height: "48px", width: "48px", borderRadius: "8px", background: "#1e40af", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: 800, color: "#fff" },
    badge: { fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase" as const, opacity: 0.6, marginBottom: "2px" },
    orgName: { fontSize: "20px", fontWeight: 700 },
    genDate: { fontSize: "11px", opacity: 0.6, textAlign: "right" as const },
    athleteRow: { padding: "24px 32px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "20px" },
    avatar: { width: "64px", height: "64px", borderRadius: "50%", background: "#1e40af", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", fontWeight: 800, flexShrink: 0 },
    athleteName: { fontSize: "28px", fontWeight: 800, color: "#0f172a", lineHeight: 1 },
    subRow: { display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap" as const },
    subItem: { fontSize: "13px", color: "#6b7280" },
    statsRow: { display: "flex", gap: "12px", marginLeft: "auto" },
    sectionPad: { padding: "20px 32px", borderBottom: "1px solid #e5e7eb" },
    sectionTitle: { fontSize: "10px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" as const, color: "#6b7280", marginBottom: "12px" },
    table: { width: "100%", borderCollapse: "collapse" as const },
    th: { padding: "8px 12px", textAlign: "left" as const, fontSize: "10px", fontWeight: 600, color: "#6b7280", background: "#f9fafb" },
    thCenter: { padding: "8px 12px", textAlign: "center" as const, fontSize: "10px", fontWeight: 600, color: "#6b7280", background: "#f9fafb" },
    tdName: { padding: "10px 12px", fontSize: "14px", fontWeight: 600, color: "#0f172a" },
    tdCenter: { padding: "10px 12px", textAlign: "center" as const },
    tdMuted: { padding: "10px 12px", textAlign: "center" as const, fontSize: "12px", color: "#6b7280" },
    prBadge: { background: "#fef08a", color: "#713f12", padding: "3px 10px", borderRadius: "20px", fontSize: "14px", fontWeight: 700, display: "inline-block" },
    entryRow: { borderBottom: "1px solid #f3f4f6" },
    sessionWrap: { display: "flex", flexWrap: "wrap" as const, gap: "8px" },
    sessionChip: { background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "6px", padding: "8px 14px", fontSize: "12px" },
    notesBox: { background: "#f8fafc", borderRadius: "8px", padding: "16px", minHeight: "80px", fontSize: "13px", color: "#374151", lineHeight: 1.6, border: "1px solid #e5e7eb", whiteSpace: "pre-wrap" as const },
    footer: { padding: "16px 32px", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" },
    footerText: { fontSize: "11px", color: "#9ca3af" },
  };

  const statBox = (bg: string, border: string): React.CSSProperties => ({
    textAlign: "center", background: bg, padding: "10px 16px", borderRadius: "8px", border: `1px solid ${border}`, minWidth: "64px",
  });
  const statNum = (color: string): React.CSSProperties => ({ fontSize: "22px", fontWeight: 800, color });
  const statLabel: React.CSSProperties = { fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "1px" };

  return (
    <div ref={ref} style={s.root}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          {orgLogo ? (
            <img src={orgLogo} alt={orgName} style={s.logo} crossOrigin="anonymous" />
          ) : (
            <div style={s.logoPlaceholder}>{orgName?.[0] || "O"}</div>
          )}
          <div>
            <div style={s.badge}>PLAYER CARD</div>
            <div style={s.orgName}>{orgName || "Organization"}</div>
          </div>
        </div>
        <div style={s.genDate}>Generated<br />{generatedDate}</div>
      </div>

      <div style={s.athleteRow}>
        <div style={s.avatar}>{getInitials(athlete.name)}</div>
        <div style={{ flex: 1 }}>
          <div style={s.athleteName}>{athlete.name}</div>
          <div style={s.subRow}>
            <span style={s.subItem}>📋 {team.name}</span>
            {team.sport && <span style={s.subItem}>🏋️ {team.sport}</span>}
            {team.season && <span style={s.subItem}>📅 {team.season}</span>}
            {athlete.memberSince && (
              <span style={s.subItem}>⭐ Member since {format(new Date(athlete.memberSince), "MMM yyyy")}</span>
            )}
          </div>
        </div>
        <div style={s.statsRow}>
          <div style={statBox("#f0fdf4", "#86efac")}>
            <div style={statNum("#15803d")}>{stats.totalEntries}</div>
            <div style={statLabel}>Entries</div>
          </div>
          <div style={statBox("#eff6ff", "#93c5fd")}>
            <div style={statNum("#1d4ed8")}>{stats.liftTypes}</div>
            <div style={statLabel}>Lifts</div>
          </div>
          <div style={statBox("#fdf4ff", "#d8b4fe")}>
            <div style={statNum("#7c3aed")}>{stats.upcomingSessions}</div>
            <div style={statLabel}>Sessions</div>
          </div>
        </div>
      </div>

      {bestPrs.length > 0 && (
        <div style={s.sectionPad}>
          <div style={s.sectionTitle}>Personal Records — Best Lifts</div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>LIFT</th>
                <th style={s.thCenter}>BEST WEIGHT</th>
                <th style={s.thCenter}>DATE</th>
              </tr>
            </thead>
            <tbody>
              {bestPrs.map((pr, i) => (
                <tr key={i} style={s.entryRow}>
                  <td style={s.tdName}>{pr.liftName}</td>
                  <td style={s.tdCenter}><span style={s.prBadge}>{pr.value} {pr.unit}</span></td>
                  <td style={s.tdMuted}>{pr.entryDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentEntries.length > 0 && (
        <div style={s.sectionPad}>
          <div style={s.sectionTitle}>Recent Entries (Last {Math.min(recentEntries.length, 8)})</div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>DATE</th>
                <th style={s.th}>LIFT</th>
                <th style={s.thCenter}>WEIGHT</th>
              </tr>
            </thead>
            <tbody>
              {recentEntries.slice(0, 8).map((e, i) => (
                <tr key={i} style={s.entryRow}>
                  <td style={{ ...s.tdMuted, textAlign: "left" }}>{e.entryDate}</td>
                  <td style={{ padding: "8px 12px", fontSize: "13px", color: "#374151" }}>{e.liftName}</td>
                  <td style={s.tdCenter}><span style={{ fontSize: "13px", fontWeight: 600, color: "#1d4ed8" }}>{e.value} {e.unit}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {upcomingBookings.length > 0 && (
        <div style={s.sectionPad}>
          <div style={s.sectionTitle}>Upcoming Sessions</div>
          <div style={s.sessionWrap}>
            {upcomingBookings.slice(0, 6).map((b, i) => (
              <div key={i} style={s.sessionChip}>
                <div style={{ fontWeight: 600, color: "#15803d", fontSize: "13px" }}>{b.date}</div>
                <div style={{ color: "#6b7280", fontSize: "11px" }}>{b.timeSlot} · {b.trainingType}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={s.sectionPad}>
        <div style={s.sectionTitle}>Coach Notes</div>
        <div style={s.notesBox}>{notes || "No coach notes added yet."}</div>
      </div>

      <div style={s.footer}>
        <div style={s.footerText}>Generated by {orgName} · {generatedDate}</div>
        <div style={s.footerText}>Train Efficiency Business Solutions</div>
      </div>
    </div>
  );
});

PlayerCard.displayName = "PlayerCard";
export default PlayerCard;
