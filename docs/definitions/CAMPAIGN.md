# What a "campaign" means in Alternate CRM

**Status: working definition, awaiting Marketing's tag list (Pankaj).**

A **campaign is a tag on a lead.** Every lead carrying a campaign tag belongs to that campaign. Reports group by tag; nothing else defines a campaign. An upload batch is *not* a campaign (one campaign can come in over many uploads).

## Rules
1. **One naming pattern** for campaign tags, e.g. `<Region>-<Program>-<Quarter>-<Channel>` (example: `US-SalesforcePartner-FY27Q3-Display`). Marketing owns the list. Uploaders pick from it; they don't invent new ones.
2. A lead can carry several tags, but **exactly one campaign tag** counts as its campaign. Other tags are labels.
3. **Tag at upload.** (Making this a required field is planned once Marketing's list exists.) An admin can correct a tag later.
4. A lead with no campaign tag shows as **"No campaign"** in reports. It is never hidden.
5. The same account in two campaigns counts in both, and is flagged.

## Where it shows today
- Leads page tag filter (React Leads page only; the classic Leads page has no tag filter).
- The raw activity Excel (Dashboard → Export) has a **Campaign** column: the lead's tags, or — if it has none — the upload batch tag or file name. This is a stopgap until tags are filled in.

## Not decided yet
Whether a region is part of the tag or a separate field; how old uploads get back-tagged.
