"""The numbers a Digest can show, in one place. The server always computes all of them (the cost is a handful of count queries);
a person's view only chooses which to put in the headline strip and in what order. `activity` is the lead-list filter a tile
opens when clicked (None = the number has no lead list behind it)."""

CATALOG = [
    # group, key, label, hint, activity
    ("Activity", "calls_made", "Calls", "Manual call logs plus dialer calls (a call that is both counts once).", "calls"),
    ("Activity", "emails_sent", "Emails sent", "Outbound e-mails sent by the reps.", "emails"),
    ("Activity", "research_notes", "Research notes", "Notes the reps wrote on leads.", "notes"),
    ("Activity", "leads_touched", "Leads touched", "Different leads with a call, e-mail, note or booking.", None),
    ("Activity", "conversations", "Conversations", "Calls with a real outcome, or longer than the conversation threshold.", None),
    ("Meetings", "meetings_booked", "Meetings booked", "Bookings made by the reps (a rebook after a no-show is a new booking).", "meetings"),
    ("Meetings", "meetings_held", "Meetings held", "Booked meetings marked complete in the period.", None),
    ("Meetings", "no_shows", "No-shows", "Booked meetings marked no-show in the period.", None),
    ("Meetings", "sal_meetings", "In Salesforce (SAL)", "Bookings whose lead exists in Salesforce.", None),
    ("Pipeline", "new_leads", "New leads", "Leads created in the period (parked leads excluded).", None),
    ("Pipeline", "pipeline_moved", "Pipeline moved", "Status changes in the period.", None),
    ("Pipeline", "leads_researched", "Leads researched", "Leads moved from Research to Calling.", None),
    ("Pipeline", "demos_completed", "Demos completed", "Leads that reached Demo Done.", None),
    ("Ownership", "accounts_given", "Accounts given", "Distinct accounts the reps started owning in the period.", None),
    ("Ownership", "contacts_given", "Contacts given", "Leads the reps started owning in the period.", None),
    ("Outreach", "campaigns_sent", "Campaign emails sent", "E-mails sent through Email Campaigns.", None),
    ("Outreach", "cadence_enrollments", "Cadence enrollments", "Leads enrolled into a cadence.", None),
]
KEYS = [c[1] for c in CATALOG]
DEFAULT_KEYS = ["calls_made", "emails_sent", "research_notes", "meetings_booked", "leads_touched"]      # the original five tiles


def catalog():
    return [{"group": g, "key": k, "label": label, "hint": hint, "activity": activity} for g, k, label, hint, activity in CATALOG]
