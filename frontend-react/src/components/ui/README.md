# components/ui — shared component library

Check this list before hand-rolling any UI in a feature. This library exists
because the same patterns (buttons, badges, dropdowns, tabs, empty states...)
kept getting reimplemented independently per feature and drifting out of
sync — see the 2026-09 design audit. Reuse first; only build feature-local UI
for something genuinely one-off.

| Component | Use for |
|---|---|
| `Button` | Any clickable action. Variants: `primary`/`secondary`/`danger`/`ghost`/`outline`. Sizes: `sm`/`md`/`lg`. |
| `Badge` | Status pills / short labels. Auto-colors known CRM status strings (see `statusVariantMap`); pass `variant` explicitly otherwise. |
| `Card`, `CardHeader` | Bordered content container with optional header/actions. |
| `Modal`, `ConfirmDialog` | Dialog overlay — handles escape/backdrop/focus/scroll-lock. `position="right"` gives a full-height slide-over drawer instead of a centered dialog. `ConfirmDialog` is the ready-made confirm/cancel case. |
| `Select`, `TriggerPill` | Custom single-select dropdown (Radix-backed), optionally searchable. |
| `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuTrigger` | Any menu-style dropdown (actions menu, column picker, bulk-action bar) — not just single-select. Built specifically to replace hand-rolled portal+click-outside menus. |
| `InfoTip` | A small "i" that explains a column, number or switch in plain words (hover, focus or tap). Renders in a portal, so a table never clips it. Write for someone new to the page. |
| `Popover`, `PopoverContent`, `PopoverTrigger` | Free-text popover content (search-a-long-list, a calendar) — use over `DropdownMenu` when the content needs its own input focus. |
| `SearchInput` | Any search/filter text input with a leading icon. |
| `Input` | Labeled text input with error/hint text. |
| `DatePicker`, `DateRangePicker`, `TimePicker`, `Calendar` | Date/time selection — `TimePicker` is a drop-in replacement for `<input type="time">` (same `'HH:MM'` value format). |
| `Table`, `TableHead`, ... | Standard table shell/rows/cells. |
| `Tabs` | Underline tab bar. `tabs={[{key,label,icon?}]}`, controlled via `active`/`onChange`. |
| `EmptyState` | "Nothing here" placeholder — icon + title + message + optional action. |
| `SettingRow` | One setting in a settings card: label + plain-language description on the left, control (Switch/Select/…) on the right, optional inline status. Stack several inside one `Card`; don't make a card per switch. |
| `Checkbox` | Labeled checkbox. |
| `Switch` | Labeled toggle switch (checkbox styled as a switch) — for on/off settings, not multi-select lists (use `Checkbox` for those). |
| `Avatar` | Initials-circle avatar. Deterministic color from `name`, or pass `background` to override (e.g. a role-color gradient). |
| `Spinner` | Inline loading spinner. `tone="light"` on a colored/dark background, `tone="dark"` (default) on a light one. |
| `Pagination` | Page-based pager with Prev/Next + "Showing X–Y of Z". |
| `Skeleton`, `SkeletonText` | Loading-state shimmer placeholders — not a spinner; use for "content is about to appear here" states. |
| `Toast` | Global toast notifications, driven by a `alternate:toast` CustomEvent (not props) so non-React code can trigger one too. |
| `AudioPlayer` | Call-recording playback UI. |
| `GuidedTour` | Homegrown "show this once, highlight a `data-tour` target" onboarding tour. |
| `ErrorBoundary` | Wrap a feature root so a render-time throw shows a fallback instead of unmounting the whole app. |

## When something doesn't fit

If a pattern repeats 3+ times across features and none of the above fits,
add a new primitive here rather than letting it re-drift into per-feature
copies — that's exactly how the last round of duplication happened. If it's
truly used once, keep it local to the feature.
