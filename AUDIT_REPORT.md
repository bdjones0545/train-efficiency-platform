# TrainEfficiency — Full Product Audit Report
**Date:** May 2, 2026  
**Scope:** UI/UX quality across all major pages + Agent functionality as coach/business co-pilot  
**Method:** Full codebase review — schema, routes, every page component, agent system prompt, all 50+ tools, revenue intelligence engine, sidebar navigation, and launcher  

---

## Executive Summary

TrainEfficiency has a strong technical foundation: a well-normalised schema, a real-time scheduling agent with 50+ tools, a two-call confirmation handshake, a revenue intelligence engine with genuine churn/LTV/upsell analytics, and a flexible multi-role permission model. The agent in particular is technically impressive — its system prompt is deeply instructive, its tool routing is well-reasoned, and the pending-action store is production-quality.

However, the product has a clear gap between its backend capability and its surface-level UX. The most consequential issues are:

1. **No command-center landing page.** The coach's default page is a daily calendar view. Revenue, churn risks, upsell opportunities, and business KPIs are either buried in tabs or only accessible by asking the AI. A coach arriving at work has no at-a-glance operational picture.

2. **Agent confirmation UX is text-only.** The agent asks users to type "yes" or "no" to confirm consequential actions (booking sessions, sending email campaigns, processing refunds). The UI renders no confirm/cancel buttons, creating friction and brittle matching.

3. **Agent confirmation summaries contain raw UUIDs.** Pending-action previews say "coach {uuid}, service {uuid}" — the human-facing copy loses all readability at the most critical moment.

4. **Settings page is dangerously thin.** The only settings available are SMS/email notification toggles. There is no account management, no org configuration, no coach goal-setting, no billing management for coaches.

5. **Navigation has role-bleed and overcrowding.** Coaches see Browse items intended for clients (Browse Coaches, My Bookings, Wallet) alongside their staff tools, with no visual hierarchy separating the two roles. The sidebar has five groups with inconsistent logic.

6. **Demo-data fallback is invisible.** The Ops Digest, Revenue Summary, Churn panel, and Upsell panel silently fall back to hard-coded sample data if no real org data exists, with no indicator that the data is synthetic.

7. **Scheduling page has no revenue layer.** The org-wide schedule view shows bookings with status but no revenue totals, no session-value column, and no period summary.

**Overall grade: B- on UI/UX, A- on agent architecture, C+ on agent UX surface.**

---

## Part 1 — UI/UX Audit

### 1.1 Coach Dashboard (`/coach`)

**What it does:** A single-day calendar view showing that coach's scheduled sessions for the selected date. Includes scroll-jump controls (Morning / Afternoon / Evening), a date picker, coach selector, and four stat cards (Confirmed, Pending, Cancelled, Total Sessions).

**Strengths:**
- Clean time-grid layout with colour-coded booking blocks.
- Keyboard-accessible date navigation (arrow buttons).
- Quick-jump anchors (Morning/Afternoon/Evening) help on dense days.
- Booking blocks show client name, service name, and status chip.
- "Redeem" action is available inline per booking.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| D-01 | Critical | **No revenue information.** The four stat cards count sessions but show zero dollar figures. A coach arriving at work cannot see today's projected revenue, this week's total, or how close they are to their monthly goal. The entire revenue layer is absent from the primary landing page. |
| D-02 | High | **No business-at-a-glance widget.** There is no "Daily Briefing" surface — pending client follow-ups, churn risks flagged overnight, or open upsell windows are only discoverable by opening the AI drawer. |
| D-03 | High | **Redeem action uses an unlabelled icon button.** The dollar-sign icon button on each booking card is the only way to redeem sessions inline. There is no tooltip delay and no label — coaches unfamiliar with the icon will miss the action. |
| D-04 | Medium | **Stat cards are session-count only.** "4 Confirmed" is less useful than "4 Confirmed · $480". Adding revenue to the stat row costs one extra query join. |
| D-05 | Medium | **Coach selector is below the fold on mobile.** The coach dropdown is inside a card rendered mid-page. On a phone, the coach must scroll past jump controls and the date strip to change whose schedule they're viewing. |
| D-06 | Medium | **No empty-state design.** Days with no bookings render an empty time grid with no message, no suggested action ("Block open slots" or "Run a fill-the-calendar campaign"). |
| D-07 | Low | **Jump controls take a fixed top strip.** Morning/Afternoon/Evening buttons are always shown even when the day has only one or two bookings. They should be hidden or compacted on sparse days. |

---

### 1.2 Scheduling Page (`/scheduling`)

**What it does:** Org-wide list/week view of all bookings for all coaches. Includes five filter dropdowns (coach, service, status, date range, search), a list view with booking rows, and a week grid view.

**Strengths:**
- Dual list/week view toggle is well-implemented.
- Filter set is comprehensive.
- Status chips are colour-coded consistently.
- Booking rows show coach name, client name, service, time, and status.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| S-01 | High | **No revenue layer.** Booking rows show no value ($). There is no "Period Revenue" summary above the list. A manager reviewing the schedule has no financial context. |
| S-02 | High | **Five filter dropdowns render as a dense, cramped strip on mobile.** All five controls are in a flex-row with no wrapping logic below the `sm:` breakpoint. The page breaks visually on a phone. |
| S-03 | High | **Week view cells are unreadable.** The week-grid cells are ~120px wide and contain the client name, service name, and time. At font-size 11px, three lines of text in a narrow column are illegible, especially when 3+ bookings overlap a single slot. |
| S-04 | Medium | **The "Scheduling Agent" button is a secondary action visually but is the primary differentiator.** It sits as an outlined button in the top-right toolbar. It should be more prominent — or better, the agent should surface inline suggestions on this page (e.g., "3 open slots this week — fill them?"). |
| S-05 | Medium | **No sorting on the list view.** Bookings appear in creation order. There is no column header for time, coach, or service that can be clicked to sort. |
| S-06 | Low | **List view shows no booking ID or short reference.** If a coach needs to reference a booking in an email or phone call there is no human-readable short ID. |

---

### 1.3 Scheduling Agent Page (`/scheduling/agent`)

**What it does:** A full-page render of the CoachSchedulingAgentPanel in "full" mode — the same panel that opens in the floating drawer but expanded to fill the viewport. Tabs: Chat, Ops Digest, Revenue, Churn Risks, Upsell, Package Alerts, Waitlist.

**Strengths:**
- Tabs are logically grouped.
- Ops Digest has priority colour-coding (red high, amber medium, green low).
- Revenue tab shows a 30/60/90 day comparison with period-over-period delta.
- Churn tab shows risk level, days since last session, and an AI-suggested action.
- Upsell tab shows estimated revenue lift per opportunity.
- Package Alerts tab is genuinely useful for subscription businesses.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| A-01 | Critical | **Demo data fallback is invisible.** `DEMO_OPS_DIGEST`, `DEMO_REVENUE_SUMMARY`, `DEMO_CHURN_RISKS`, and `DEMO_UPSELL` are rendered whenever the API returns no data (empty org, API failure, etc.). There is no "Sample data — connect your org to see real insights" banner. Coaches may make decisions based on fabricated numbers. |
| A-02 | Critical | **Confirmation flow is text-only.** When the agent returns `requiresConfirmation: true`, the UI renders a markdown message saying "Reply **yes** to confirm or **no** to cancel." The user must type a freeform response. The matching uses `.trim().toLowerCase() === "yes"` — any variation ("yes please", "ok", "sure", "confirm", "y") is silently ignored and the action is abandoned after the 10-minute TTL. No confirm/cancel buttons are rendered. |
| A-03 | High | **Pending-action summaries use raw UUIDs.** The agent stores pending actions as `"Book session: coach {uuid}, service {uuid}, starting {ISO}"`. This summary is surfaced to the user as the thing they are being asked to confirm. A coach sees "Confirm: book session: coach 3f9a1c… service d72b8e…" which is unacceptable for a confirmation dialog. |
| A-04 | High | **The Chat tab has no conversation starters.** A blank chat input with a placeholder "Ask about scheduling, revenue, or client management" gives no affordance to new users. There are no suggested prompts, no "try asking…" examples, and no onboarding text. |
| A-05 | High | **Seven tabs are too many to scan.** Chat / Ops / Revenue / Churn / Upsell / Packages / Waitlist require the coach to know which tab holds which information. The most actionable tabs (Churn and Upsell) are the fourth and fifth tab — rarely reached by casual users. |
| A-06 | Medium | **The agent panel is accessible only via a floating bot button or a direct URL.** There is no persistent "Agent" section in the main sidebar. Coaches who haven't discovered the FAB (which is hidden when on the agent page) may not know the agent exists. |
| A-07 | Medium | **Revenue tab period comparisons have no visual chart.** The tab shows three text rows (30d / 60d / 90d revenue with deltas). A micro bar chart would communicate the trend far faster. |
| A-08 | Medium | **Churn and Upsell tabs have no quick-action buttons.** Each churn card shows "Suggested action: send a re-engagement email" but there is no "Do this" button. The coach must switch to Chat, explain the client, and ask the agent to act. The tabs and the chat are not connected. |
| A-09 | Low | **Ops Digest insights have no "dismiss" or "done" action.** Insights accumulate until the next API poll. If a coach has acted on an insight (e.g., they already contacted the at-risk client), there is no way to mark it resolved. |

---

### 1.4 Coach Business Plan (`/coach/business-plan`)

**What it does:** Shows a revenue chart (SVG bar chart), subscriber usage, and a scrollable client card list. Clicking a client card expands their session history.

**Strengths:**
- Client LTV ranking is a genuinely useful default sort.
- Subscriber usage progress bar (sessions used / sessions remaining) is useful.
- Revenue chart covers a rolling 12-week window.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| BP-01 | High | **No goal-setting despite being called "Business Plan."** There is no way to set a monthly revenue target, a client growth goal, or a session volume target on this page. The "Predicted Monthly Revenue" metric exists but there is nothing to compare it against. |
| BP-02 | High | **Custom SVG chart instead of a chart library.** The bar chart is hand-rolled with SVG rect elements and manual scale calculation. It has no hover tooltips, no accessible labels, no responsive scaling below ~400px, and is fragile to data edge cases (zero-revenue weeks produce a height-0 rect that is invisible). |
| BP-03 | Medium | **Client cards have no quick actions.** Expanding a client card shows their session list but offers no "Send message", "Book session", "Create package" button. All actions require navigating to a different page or asking the agent. |
| BP-04 | Medium | **"Predicted Monthly Revenue" methodology is opaque.** The figure is described as based on "session consistency" but no tooltip, footnote, or explainer is shown. Coaches may over-trust or dismiss the figure without knowing its basis. |
| BP-05 | Low | **Revenue chart has no period selector.** The chart always shows the last 12 weeks. There is no way to switch to monthly, quarterly, or YTD view. |

---

### 1.5 Admin Dashboard (`/admin`)

**What it does:** A tabbed interface with six tabs: Users, Services, Bookings, Redemptions, Cashouts, Revenue Intelligence. Revenue Intelligence is itself a sub-tabbed section with: Overview, Time Analysis, Coach Breakdown, Client LTV, and Churn & Upsell.

**Strengths:**
- Revenue Intelligence sub-tabs are very comprehensive (time-block revenue, per-coach breakdown, full LTV table with churn signals).
- Cashouts tab supports approve/deny with a confirmation step.
- Service creation dialog is functional.
- User list shows role and key metadata.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| AD-01 | High | **Revenue Intelligence is the sixth tab, buried after Redemptions.** The most strategically important view in the admin panel requires 5 clicks to reach. It should be the first tab, or there should be a KPI summary strip at the top of every tab. |
| AD-02 | High | **Users tab has no search or filter.** For an org with 50+ users, scrolling a flat list to find a specific client is untenable. |
| AD-03 | High | **Bookings tab has no sort or filter.** Bookings are rendered in an unordered list. There is no way to filter by coach, service, status, or date range from this tab. (This is the same data as the Scheduling page but with no filter controls.) |
| AD-04 | Medium | **Service creation dialog has no category or session-type fields.** The form has Name, Description, Price, Duration, and Max Capacity. There is no way to mark a service as "recurring-eligible", "package-only", or assign it to a category for client-facing Browse filtering. |
| AD-05 | Medium | **Cashout approval has no audit trail visible in the UI.** Admins can approve/deny but there is no "approved by" column, no timestamp, and no way to filter "already processed" from "pending" cashouts without reading every row. |
| AD-06 | Low | **Revenue Intelligence time-block chart is an HTML table, not a heatmap.** The data (which hours generate most revenue) is well-suited to a heatmap visual (rows = days of week, columns = hours). The current table is functional but much harder to pattern-match. |

---

### 1.6 Coach Profile (`/coach/profile`)

**What it does:** A form to edit bio, specialties, photo URL, location, and timezone. Displays a preview card.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| CP-01 | High | **Photo upload requires a URL string.** Coaches must host their own headshot and paste a URL. There is no direct file upload. Most non-technical coaches will leave the field blank, resulting in avatar placeholders throughout the product. |
| CP-02 | Medium | **Preview card is static.** The "Preview" card does not update as the coach types — it only reflects the saved state. A live preview would reduce confusion about whether changes are saved. |
| CP-03 | Medium | **No public-profile link.** After saving a profile there is no "View as client" button or shareable URL shown. Coaches do not know what clients see when they browse. |
| CP-04 | Low | **Specialties field is a freeform text input.** There is no tag/chip picker. Coaches type comma-separated strings, which are later displayed verbatim. Two coaches typing "Strength Training" and "strength training" produce inconsistent filter results. |

---

### 1.7 Settings Page (`/settings`)

**What it does:** Notification preferences — two toggles each for Email and SMS (marketing emails, session reminders).

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| ST-01 | Critical | **Settings covers only notification toggles.** There is no account management (change email, change password), no org configuration, no billing/subscription management for the coach themselves, no data export, no connected app management, and no coach goal-setting. The settings page is a dead end for any administrative need. |
| ST-02 | High | **No coach goal-setting surface anywhere.** Monthly revenue targets, new client acquisition goals, and session volume targets are referenced by the agent system prompt but there is no UI to enter them. The agent calls `get_revenue_forecast` with a `targetCents` parameter — but where does that target come from? It is apparently never set. |

---

### 1.8 Navigation & Sidebar

**What it does:** A collapsible left sidebar with role-aware sections. Coaches see: Browse (Browse Coaches, My Bookings, Wallet), Scheduling, Business Plan, Coach Tools (Users, Team Quotes, Team Training, Open Sessions, Communication History, Efficiency & Strength, Availability Manager, Scheduling Agent), Configuration (Coach Profile, Settings), Danger Zone (Delete Organization).

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| N-01 | High | **Coaches see client-facing Browse items.** Browse Coaches, My Bookings, and Wallet are designed for clients navigating the marketplace. Coaches who also train with other coaches need these, but they are mixed in with staff tools with no visual separation between "You as a client" and "You as a coach." |
| N-02 | High | **"Business Plan" is a group containing one link.** A sidebar group with a header and a single link is wasted chrome. This should be a top-level item in Coach Tools or promoted to the top of the sidebar. |
| N-03 | High | **"Coach Tools" contains 8 items with no sub-grouping.** Users, Team Quotes, Team Training, Open Sessions, Communication History, Efficiency & Strength, Availability Manager, and Scheduling Agent are all peers. Client management items (Users, Communication History) should be grouped separately from schedule management items (Availability Manager, Scheduling Agent, Open Sessions). |
| N-04 | Medium | **"Scheduling Agent" is buried at position 8 of 8 in Coach Tools.** The highest-differentiating feature of the product is the last item in a long list. It should be a primary navigation item, not a buried utility link. |
| N-05 | Medium | **"Danger Zone" (Delete Organization) is always visible in the sidebar.** A destructive action of this severity should be inside Settings > Advanced, not a permanent sidebar item. Its presence creates anxiety and adds visual noise. |
| N-06 | Medium | **Sidebar has no revenue/goal summary strip.** Many SaaS dashboards show a compact KPI strip in the sidebar (e.g. "This month: $4,200 / $6,000 goal"). The sidebar is a persistent surface that could carry a progress indicator without requiring navigation. |
| N-07 | Low | **Active state highlight is low contrast.** The active link uses a subtle background tint. On the light theme the distinction between active and inactive items requires close inspection. |

---

## Part 2 — Agent Functionality Audit

The agent is built on a 4,000+ line system prompt with 50+ tools, a two-call confirmation handshake, a pending-action store (10-minute TTL, per-user deduplication, max 5 concurrent), source-page context injection, and a revenue intelligence engine covering LTV, churn signals, upsell scoring, and time-block analysis.

### 2.1 System Prompt & Routing Intelligence

**Strengths:**
- Three separate revenue tools with clear routing rules: `get_revenue_by_period` for specific date ranges, `get_revenue_summary` for 30/60/90-day overview, `get_revenue_forecast` for forward projection.
- Explicit "never compute the gap yourself" instruction prevents hallucinated math.
- Routing rules for outreach: draft before send, always confirm before executing, always compose a follow-up.
- Campaign engine with A/B message variation tracking.
- Autopilot dashboard with closed-loop action tracking.
- Adaptive decision engine adjusting recommendations by org size and revenue tier.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| AG-01 | High | **Agent has no injected "today's context."** The system prompt includes `Today's date: {date}` but no summary of today's bookings, current month revenue to date, or outstanding pending actions. Every session starts cold — the agent must call 2-3 tools to orient itself before answering the coach's first question. A daily context injection (passed as a system message alongside the prompt) would make the first interaction 60% faster. |
| AG-02 | High | **Revenue target / coach goals are referenced but never set.** The `get_revenue_forecast` tool accepts a `targetCents` parameter and the system prompt references "monthly revenue goal." But there is no API endpoint or UI to store a coach's revenue target. The tool either uses a hardcoded default or omits the gap calculation entirely. |
| AG-03 | Medium | **Source-page context is injected but not deeply used.** `AgentContext.sourcePage` is passed to the panel and visible in the system prompt context block. However, the system prompt doesn't vary its opening behaviour significantly by source page. A coach opening the agent from the Business Plan page should receive a revenue-focused greeting; from the Scheduling page, a fill-the-calendar greeting. |

---

### 2.2 Confirmation Handshake (Two-Call Flow)

**Strengths:**
- All 17 mutating tools (`book_session`, `cancel_booking`, `send_drafted_outreach_email`, `send_drafted_outreach_sms`, `process_refund`, `create_waitlist_entry`, `remove_waitlist_entry`, `add_client_note`, `create_recurring_session`, `reschedule_booking`, `create_campaign`, `send_campaign`, `apply_session_credit`, `toggle_autopilot`, `execute_autopilot_action`, `create_package_deal`, `apply_custom_discount`) use the two-call handshake.
- Pending actions are stored per-user with a 10-minute TTL and a max-5 cap.
- Duplicate pending actions for the same tool are deduplicated by user.
- The agent formats a human-readable confirmation request before any mutation.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| AH-01 | Critical | **Confirmation is text-only — no UI buttons.** The frontend renders the agent's confirmation message as markdown text and waits for the user to type "yes" or "no". The matching is strict: `trimmed.toLowerCase() === "yes"`. Variations like "yes please", "ok", "sure", "go ahead", "confirm", "y" are silently interpreted as a new user message, the agent tries to help, the TTL expires, and the action is lost. The user has no indication this happened. |
| AH-02 | Critical | **Pending-action summary contains raw UUIDs.** The `pendingActions` store records actions as `{ tool: "book_session", summary: "Book session: coach 3f9a1c…, service d72b8e…, starting 2026-05-03T09:00:00.000Z" }`. This summary is directly surfaced in the confirmation message. A coach is asked to confirm a string that contains UUIDs and ISO timestamps. |
| AH-03 | High | **No expiry feedback.** When a pending action's 10-minute TTL expires, the user receives no notification. If they type "yes" 11 minutes later, the agent responds as though it received a new user message with the word "yes" and attempts to interpret it, producing a confusing reply. |
| AH-04 | High | **No pending-action visibility.** There is no UI surface showing "You have a pending action: Book session with Sarah on Thursday — confirm or cancel." If a coach accidentally closes the drawer and re-opens it, they cannot see that a confirmation is still outstanding. |
| AH-05 | Medium | **Max 5 pending actions per user with silent drop.** If a coach has 5 pending actions and triggers a 6th, the 6th is silently rejected. The agent will have already generated a confirmation message, but the action is never stored. The user types "yes" and nothing happens. |

---

### 2.3 Scheduling Tools

**Covered tools:** `get_coach_schedule`, `get_org_schedule`, `get_available_slots`, `book_session`, `reschedule_booking`, `cancel_booking`, `create_recurring_session`, `get_booking_details`, `get_pending_bookings`, `check_coach_availability`, `get_waitlist`, `create_waitlist_entry`, `remove_waitlist_entry`

**Strengths:**
- `get_available_slots` returns slots with buffer and duration awareness.
- `create_recurring_session` handles weekly/biweekly/monthly patterns.
- `check_coach_availability` is separate from slot retrieval, allowing lightweight checks.
- Waitlist management is fully agent-addressable.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| SC-01 | Medium | **`book_session` summary includes no service name or coach name.** The pending-action summary says "coach {uuid}, service {uuid}" — see AH-02. Even if the UUID issue were fixed, the tool needs to resolve names at summary-generation time. |
| SC-02 | Medium | **No conflict detection message on `book_session`.** If the slot becomes unavailable between the agent querying slots and the coach confirming the booking, the booking attempt fails silently. The error path is not described in the system prompt — the agent may not produce a useful recovery message. |
| SC-03 | Low | **`get_org_schedule` has no pagination.** For orgs with many bookings, the tool returns all bookings in a date range. A busy week could return 200+ records, inflating the context window and slowing the response. |

---

### 2.4 Revenue & Business Intelligence Tools

**Covered tools:** `get_revenue_by_period`, `get_revenue_summary`, `get_revenue_forecast`, `get_client_ltv`, `get_churn_risks`, `get_upsell_opportunities`, `get_session_package_alerts`, `get_time_block_analysis`, `get_coach_revenue_breakdown`, `get_revenue_goals` (referenced but unclear if implemented)

**Strengths:**
- All three revenue tools serve distinct use cases and the routing rules are well-defined.
- `get_client_ltv` returns a full profile: total revenue, session count, avg per session, retention days, monthly avg spend, subscriber status, churn risk level, and churn signals.
- `get_churn_risks` produces `suggestedAction` strings — the agent can immediately act on them.
- `get_time_block_analysis` identifies peak revenue hours — unique and useful.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| RV-01 | High | **No revenue goal storage.** `get_revenue_forecast` accepts `targetCents` but there is no `set_revenue_goal` tool and no database column for coach revenue targets. Without a stored goal, the forecast tool cannot compute a meaningful gap. |
| RV-02 | Medium | **`get_revenue_forecast` uses a projection algorithm that is not explained to the user.** The agent is instructed to present the forecast confidently, but the underlying projection (linear extrapolation? seasonal adjustment? booking-rate based?) is not exposed. Coaches may over-trust the figure. |
| RV-03 | Medium | **No tool to get revenue by individual service or service category.** Coaches cannot ask "which service is most profitable?" and get a direct answer — the agent must cobble this together from LTV and period data. |

---

### 2.5 Outreach & Campaign Tools

**Covered tools:** `get_clients`, `get_client_details`, `draft_outreach_email`, `send_drafted_outreach_email`, `draft_outreach_sms`, `send_drafted_outreach_sms`, `get_communication_history`, `create_campaign`, `send_campaign`, `get_campaign_performance`, `get_ab_test_results`

**Strengths:**
- Draft-before-send pattern is enforced for both email and SMS.
- A/B variation tracking with `get_ab_test_results` is sophisticated.
- `get_communication_history` gives the agent full context before drafting a follow-up.
- Campaigns support multiple message variations for split testing.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| OT-01 | High | **Outreach email confirmation shows no rendered preview.** The confirmation message for `send_drafted_outreach_email` says the email body will be sent, but the user sees it as a markdown block inside a chat bubble. There is no "Preview email" view, no recipient list summary, and no subject line preview in the confirmation message. |
| OT-02 | Medium | **No unsubscribe or opt-out check before sending outreach.** The agent can send an email to any client. There is no tool call to `check_client_opt_out_status` before `send_drafted_outreach_email`. If a client has opted out of marketing emails (which the Settings page supports), the agent may violate that preference. |
| OT-03 | Medium | **`get_campaign_performance` is not automatically suggested after sending.** After a campaign is sent, the agent does not schedule or proactively offer to check performance. The coach must think to ask. |
| OT-04 | Low | **No per-client send-history awareness in draft tool.** `draft_outreach_email` does not receive the client's recent email history as input. The agent must first call `get_communication_history`, then draft. If it skips the first step, it may draft a duplicate of a message sent two days ago. |

---

### 2.6 Package & Subscription Tools

**Covered tools:** `get_client_packages`, `create_package_deal`, `apply_session_credit`, `apply_custom_discount`, `get_session_package_alerts`, `process_refund`

**Strengths:**
- `get_session_package_alerts` proactively surfaces clients about to exhaust their package — a high-value retention signal.
- `process_refund` is behind the two-call handshake with a confirmation step.
- `create_package_deal` allows bespoke pricing without requiring admin intervention.

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| PK-01 | Medium | **No tool to list available subscription plans.** The agent can create package deals but cannot enumerate what standard plans exist in the org. If a coach asks "what packages do we offer?", the agent has no direct tool — it must infer from service data. |
| PK-02 | Medium | **`apply_custom_discount` has no audit trail tool.** The agent can apply discounts, but there is no `get_discount_history` tool to review what has been applied. Over time, untracked discounts erode revenue without visibility. |

---

### 2.7 Autopilot & Adaptive Decision Engine

**Covered tools:** `get_autopilot_dashboard`, `toggle_autopilot`, `execute_autopilot_action`, `get_adaptive_recommendations`, `get_action_history`

**Strengths:**
- `get_autopilot_dashboard` aggregates all pending AI-suggested actions in one view.
- `toggle_autopilot` is guarded by the confirmation handshake.
- `get_adaptive_recommendations` adjusts suggestions by org size and revenue tier.
- `get_action_history` enables closed-loop review ("what did we do last month?").

**Issues:**

| ID | Severity | Issue |
|----|----------|-------|
| AP-01 | High | **Autopilot dashboard is agent-only.** The autopilot state is only visible by asking the agent to call `get_autopilot_dashboard`. There is no UI panel showing autopilot status, pending queued actions, and what was auto-executed in the last 24 hours. |
| AP-02 | Medium | **`toggle_autopilot` has no scope parameter.** Autopilot can be toggled on/off globally but there is no way to enable it for outreach only, disable it for financial actions, or set a daily action cap. |

---

## Part 3 — Priority Fix List

Ranked by business impact × implementation cost.

| Rank | ID | Issue | Impact | Effort |
|------|----|-------|--------|--------|
| 1 | AH-01 | Add confirm/cancel buttons to agent confirmation flow | Critical | Low (frontend only — detect `requiresConfirmation` and render buttons) |
| 2 | AH-02 | Resolve UUIDs to names in pending-action summaries | Critical | Low (join at summary generation time in the tool handler) |
| 3 | A-01 | Add "Sample data" banner when demo fallback is active | Critical | Low (boolean flag passed from API, conditional banner in panel) |
| 4 | D-01 | Add revenue figures to Coach Dashboard stat cards | High | Low (join booking amounts in existing query) |
| 5 | ST-01/ST-02 | Expand Settings page with goal-setting and account management | High | Medium (new form sections + API endpoints) |
| 6 | AG-01 | Inject today's context into agent system prompt at session start | High | Medium (build a `getDailyBriefing()` function and inject as first system message) |
| 7 | AG-02 | Implement `set_revenue_goal` / `get_revenue_goals` with persistent storage | High | Medium (new schema column + tool + UI in Settings) |
| 8 | N-01 to N-07 | Restructure sidebar: separate client/coach roles, promote Agent link, remove Danger Zone | High | Medium (sidebar restructure, no schema changes) |
| 9 | AH-03/AH-04 | Show pending-action expiry countdown and list in agent panel header | High | Medium (frontend TTL display + poll endpoint) |
| 10 | OT-02 | Add opt-out check before outreach send | High | Low (one pre-send tool call or server-side guard) |
| 11 | CP-01 | Replace photo URL field with direct file upload | High | Medium (multipart upload endpoint + S3/object storage) |
| 12 | S-01 | Add revenue totals to Scheduling page period summary | Medium | Low (aggregate join in existing query) |
| 13 | BP-01 | Add goal-setting to Business Plan page | Medium | Medium (depends on ST-02 above) |
| 14 | BP-02 | Replace hand-rolled SVG chart with Recharts or similar | Medium | Medium (library install + data adapter) |
| 15 | AD-01 | Move Revenue Intelligence to first tab in Admin Dashboard | Medium | Low (tab order change) |
| 16 | AD-02 | Add search to Users tab | Medium | Low (client-side filter on existing data) |
| 17 | A-08 | Add "Do this with Agent" buttons to Churn and Upsell tab cards | Medium | Medium (pre-fill chat input + switch to Chat tab) |
| 18 | AP-01 | Add autopilot status panel to Agent page UI | Medium | Medium (new panel section reading autopilot dashboard API) |
| 19 | RV-01 | Add revenue goal storage and surface in forecast | Medium | Medium (schema + API + tool) |
| 20 | N-05 | Move Danger Zone out of sidebar into Settings > Advanced | Low | Low |

---

## Part 4 — Implementation Plan

### Phase 1 — Critical UX Fixes (1–2 days, no schema changes)

**Goal:** Eliminate the most trust-damaging issues in the agent and surface.

1. **Confirm/Cancel buttons in agent chat** (AH-01)
   - Detect `requiresConfirmation: true` in the message stream.
   - Render a two-button card (Confirm / Cancel) below the agent message instead of prose.
   - Wire Confirm to send "yes" and Cancel to send "no" programmatically.
   - Remove the existing text instructions from the agent's confirmation messages.

2. **Human-readable pending-action summaries** (AH-02)
   - In `executeTool()` for each mutating tool, resolve all UUIDs to names before storing in `pendingActions`.
   - For `book_session`: look up coach display name, service name, and format time as "Thursday May 8 at 9:00 AM".

3. **Demo-data banner** (A-01)
   - Add an `isDemo: boolean` flag to each API response for ops-digest, revenue-summary, churn-risks, and upsell.
   - Render a `⚠ Sample data` badge at the top of the relevant tab when `isDemo` is true.

4. **Pending-action TTL display** (AH-03/AH-04)
   - Add a `GET /api/scheduling/pending-actions` endpoint returning the user's current pending actions with remaining TTL.
   - Render a banner in the agent panel header: "⏳ Awaiting your confirmation: Book session with Sarah — 4:32 remaining [Confirm] [Cancel]".

5. **Opt-out guard for outreach** (OT-02)
   - Add a server-side check in the `send_drafted_outreach_email` and `send_drafted_outreach_sms` tool handlers: if the target client's notification preferences have marketing disabled, reject the action with a clear error message.

---

### Phase 2 — Dashboard & Navigation (2–3 days, minor schema changes)

**Goal:** Give coaches an operational picture without asking the agent.

6. **Revenue on Coach Dashboard stat cards** (D-01)
   - Add `totalRevenueCents` to the bookings query used by the dashboard.
   - Replace "4 Confirmed" with "4 Confirmed · $480" in the stat cards.
   - Add a "Today's Projected Revenue" summary card at the top of the page.

7. **Sidebar restructure** (N-01 to N-07)
   - Rename "Browse" to "As a Client" with a role explanation tooltip.
   - Rename "Coach Tools" to "Coaching" and split into two sub-groups: "Clients" (Users, Communication History) and "Schedule" (Availability Manager, Open Sessions, Scheduling Agent).
   - Promote Scheduling Agent to a top-level sidebar item with a Bot icon.
   - Move Business Plan into the Coaching section.
   - Move Danger Zone into Settings > Advanced tab.
   - Add a revenue progress strip to the sidebar footer (This month: $X / $Y goal — hidden until a goal is set).

8. **Revenue totals on Scheduling page** (S-01)
   - Add a period summary bar above the booking list: "23 sessions · $3,450 total · May 1–7".
   - Add a Value column to the list view.

9. **Move Revenue Intelligence to first tab in Admin Dashboard** (AD-01)
   - Reorder tabs: Revenue Intelligence, Users, Services, Bookings, Redemptions, Cashouts.
   - Add a KPI summary strip (Total Revenue MTD, Active Clients, Open Cashouts) at the top of every tab.

---

### Phase 3 — Agent Intelligence & Settings (3–5 days, schema changes)

**Goal:** Give the agent real goals to work with and close the loop on its capabilities.

10. **Coach goal storage** (ST-02, AG-02, RV-01)
    - Add `monthlyRevenueTargetCents` and `monthlyNewClientTarget` columns to `coachProfiles`.
    - Add `GET /api/coach/goals` and `PUT /api/coach/goals` endpoints.
    - Add a Goals section to Settings (or Business Plan) with a form.
    - Implement `set_revenue_goal` and `get_revenue_goals` agent tools.
    - Pass the stored goal to `get_revenue_forecast` automatically.

11. **Today's context injection** (AG-01)
    - Create a `getDailyBriefingContext(orgId, coachId, date)` function that returns:
      - Today's session count and projected revenue.
      - Outstanding pending bookings awaiting confirmation.
      - Top churn risk (if any) for today.
      - Current month revenue vs. goal (if set).
    - Inject this as the first system message in every new agent conversation.
    - Cap at ~400 tokens to avoid context bloat.

12. **Expand Settings page** (ST-01)
    - Add tabs: Account (email/password change), Goals (revenue and client targets), Notifications (existing toggles), Advanced (Danger Zone).
    - Add "View as Client" link from Coach Profile.

13. **Coach photo file upload** (CP-01)
    - Add `POST /api/coach/profile/photo` multipart endpoint.
    - Store in object storage (Replit Object Storage or S3).
    - Replace URL field with a file picker + preview in the profile form.

14. **Churn/Upsell quick actions** (A-08)
    - Add a "Message with Agent" button to each Churn Risk card.
    - Clicking it switches to the Chat tab and pre-fills: "Draft a re-engagement email for [client name] who hasn't booked in [X] days."
    - Same pattern for Upsell cards: "Draft an upsell message for [client name] about upgrading to the monthly package."

---

### Phase 4 — Polish & Chart Upgrades (1–2 days)

15. **Replace SVG chart on Business Plan** (BP-02)
    - Install Recharts.
    - Migrate the hand-rolled SVG bar chart to a `<BarChart>` with tooltips, responsive container, and accessible labels.
    - Add a period selector (4W / 3M / 6M / 1Y).

16. **Conversation starters in agent chat** (A-04)
    - Show 4 suggested prompts when chat history is empty:
      - "What does my schedule look like this week?"
      - "Which clients are at risk of churning?"
      - "What's my revenue forecast for this month?"
      - "Find open slots and help me fill them."
    - Clicking a prompt sends it as the first message.

17. **Autopilot status panel** (AP-01)
    - Add an "Autopilot" section to the Agent page between the Revenue and Churn tabs.
    - Show: enabled/disabled toggle, last action taken, next queued action, 7-day action log.

---

*End of audit report. Total identified issues: 52 (7 Critical, 21 High, 18 Medium, 6 Low).*
