# RCM Project Context

## :rocket: Project Overview
**RCM** is a state-of-the-art, AI-powered CRM Intelligence platform designed for high-velocity sales teams. It bridges the gap between static Salesforce data and active outreach intelligence via automated AI research and multi-channel communication pipelines.

### Core Objectives:
1.  **Modernization**: Refactoring the legacy Vanilla JS and HTML/CSS codebase into a robust, component-driven React architecture.
2.  **Performance at Scale**: Implementing server-side data handling (pagination, filtering) to manage deep CRM pipelines (500+ daily leads) without UI lag.
3.  **Visual Excellence**: Establishing a premium, "wow-factor" design system that competes with top-tier SaaS platforms (Linear, Vercel, Stripe).
4.  **AI Integration**: Seamlessly embedding AI-driven lead research and automated outreach logging into the core workflow.

---

## :hammer_and_wrench: Technical Stack (Modernization)
We are currently refactoring the UI from legacy structures to a modern frontend ecosystem:

-   **Framework**: **React 18** for component-based UI and state management.
-   **Build Tool**: **Vite** for lightning-fast HMR and optimized production bundling.
-   **Styling**: **Tailwind CSS** with a custom Design System configuration for rapid, consistent layout development.
-   **Typography**: **Inter** (Instrumental UI data) and **Outfit** (Brand/Display headers).
-   **Icons**: **Lucide React** for a clean, consistent iconography set.
-   **State Management**: Context API for global state (Auth/Settings) and local hooks for data-heavy pages.
-   **API Handling**: **Axios** with centralized service patterns (`LeadsService`, `SettingsService`) for clean async logic.

---

## :art: Global Design System
The new RCM aesthetic follows a **Premium Light Theme**:
-   **Aesthetics**: Glassmorphism accents, high-contrast text (`slate-900`), and subtle shadows for depth.
-   **Spatiality**: Improved button padding (`px-6 py-3.5`) and softened corners (`rounded-xl`) to fix legacy "thin" and cramped UI issues.
-   **Consistency**: Shared UI components (Button, Input, Card, Badge) ensure a uniform look across all newly migrated pages.

---

## :white_check_mark: Progress & Completed Modules

### 1. Infrastructure & Core Refactor
- [x] **Vite Setup**: Fully configured build system in `/frontend-react`.
- [x] **Global Layout**: Re-implemented Sidebar and AppLayout with premium styling.
- [x] **Authentication**: Modernized Login flow with Google/Salesforce SSO integration.

### 2. Commercial Registry (Leads Module)
- [x] **Refactored Table**: transitioned from static lists to a high-performance **server-side paginated table**.
- [x] **Data Synchronization**: Fixed API extraction bugs to ensure all 500+ leads are visible in real-time.
- [x] **Kanban Pipeline**: Re-implemented the stage-based pipeline with full drag-and-drop capability.
- [x] **Defualt View**: Optimized to load the **List View** by default for immediate ROI on data density.

### 3. Settings & Integrations
- [x] **Salesforce Bridge**: Re-verified the bi-directional sync status and connection UI.
- [p] **Dialer Config**: Porting legacy Twilio settings into the React component structure.
- [x] **Build Reliability**: Resolved critical "Unterminated string" syntax errors that previously blocked builds.

---

## :arrows_counterclockwise: Re-verified State (Post-Audit)
- **Target Technology**: Full transition to **React + Tailwind** is ~65% complete.
- **Staging URL**: `https://rcm-crm-react-staging.onrender.com`.
- **Current Milestone**: All Lead-related visibility and architectural issues are **Resolved**.

---

## :date: Upcoming Roadmap (Next Phases)
1.  **Communications Overhaul**: Migrating the `Calls.jsx` and `Email` modules to the new design system.
2.  **AI Research Sidebar**: Implementing the contextual AI intelligence panel for active leads.
3.  **Analytics Dashboard**: Visualizing conversion rates and SDR performance metrics.