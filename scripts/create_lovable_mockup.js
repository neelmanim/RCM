const fs = require('fs');
const path = require('path');
const https = require('https');

const tokenPath = path.resolve(__dirname, '../../.agents/lovable_token.json');

if (!fs.existsSync(tokenPath)) {
  console.error('❌ Token file not found. Please run: node scripts/lovable_oauth.js first!');
  process.exit(1);
}

const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const accessToken = tokenData.access_token;

const initialPrompt = `Build a modern, state-of-the-art B2B SaaS application called "Alternate CRM — The Conversation OS". 
The product is designed as an Operating System where Core CRM primitives are the stable base, and high-value features (Power Dialer, Cadences, Email Hub, Analytics, CSM) act as modular, plug-and-play installable apps with live 1-click toggles. It also features a built-in 1-Click Interactive Sandbox Demo shell with pre-loaded enterprise data.

AESTHETICS & THEME:
- Dual Theme: Sleek Dark Mode (Default: Deep Slate #0B0F19, #111827 surfaces, subtle #1E293B borders, crisp white typography, and vibrant Indigo/Violet #6366F1 accents) with an instant Dark/Light Mode toggle.
- Design inspiration: Linear, Attio, and Stripe. Clean rounded cards, subtle glassmorphic backdrop-blur, smooth pill badges, micro-hover animations, and Lucide React icons.

1. TOP SHELL: 1-CLICK INTERACTIVE SANDBOX DEMO BANNER:
- A persistent, premium top demo ribbon with:
  * Glowing badge: "⚡ Interactive Sandbox Demo · In-Memory Simulation"
  * Persona Switcher dropdown:
    - "Alex Rivera (Enterprise SDR - Hunter)"
    - "Sarah Chen (Sales Director / Pod Admin)"
    - "David Kim (CSM & Retention Lead)"
  * Action button: "🔄 Reset Demo Data" (restores the clean demo state with an interactive toast)
  * Action button: "📞 Place Test Call" (launches floating mini-dialer widget with animated audio waveform)
  * Action button: "🚀 Book Live Demo" (opens a sleek demo booking modal)
  * Theme Toggle button (☀️ / 🌙)

2. CORE OPERATING SYSTEM SIDEBAR & MODULE REGISTRY:
The sidebar is dynamically populated by the active Module Registry:
- Core Platform Section (Always On, Immutable):
  * Dashboard / Command Center
  * Leads & Accounts (with count badge: 24)
  * Pipeline Kanban
  * My Tasks & Activities
- Installed Modules Section (Dynamically rendered ONLY if enabled in the App Store):
  * 📞 AI Power Dialer
  * ⚡ Sales Cadences & Sequences
  * ✉️ Omnichannel Email Hub
  * 📈 Performance & Analytics Hub
  * 🛡️ CSM & Health Portal
- System Section:
  * 🏬 App Store & Modules (with badge showing e.g., "5/5 Active")
  * ⚙️ Settings

3. SCREEN 1: APP STORE & MODULE MANAGER (/app-store):
- Hero Header: "Conversation OS Marketplace"
- Subtitle: "Enable, disable, and configure modular capabilities for your sales workspace in real-time."
- Filter tabs: "All Modules", "Sales Outreach", "Communication", "Intelligence", "Retention"
- Interactive Module Cards for:
  1. "AI Power Dialer" (Telephony, multi-line dialing, live transcriptions, dispositioning)
  2. "Sales Cadences & Sequences" (Automated multichannel outreach: Email, SMS, WhatsApp)
  3. "Omnichannel Email Hub" (Unified inbox, 2-way sync, AI reply composer)
  4. "Advanced Analytics & Leaderboards" (Conversion funnels, rep KPIs, call outcomes)
  5. "CSM & Account Health Portal" (Churn risk scoring, renewal pipelines, health monitoring)
- Each card has an interactive Toggle Switch (Installed / Uninstalled).
  * CRITICAL INTERACTION: Toggling a module immediately adds or removes that module's icon and link from the Global Sidebar in real-time, accompanied by a toast notification.

4. SCREEN 2: MODULAR LEAD DETAIL VIEW (/leads/:id):
- Left Column: Lead profile (Sarah Jenkins, VP of RevOps at Stripe), ARR ($180k), Priority Score (95/100), Stage selector dropdown, contact channels.
- Right Column: Pluggable Tabs that adapt based on which modules are installed:
  * "Activity Timeline" (Core CRM)
  * "Call Logs & Audio" (Only visible if Power Dialer is Installed)
  * "Active Cadence" (Only visible if Cadences is Installed)
  * "Email Conversation" (Only visible if Email Hub is Installed)
  * "Account Health Score" (Only visible if CSM is Installed)
- Quick Action Header:
  * "Call Lead" button (opens the floating Power Dialer modal with simulated call progress and disposition buttons)
  * "Enroll in Sequence" button
  * "Send Email" button

5. SCREEN 3: PIPELINE KANBAN & COMMAND CENTER (/pipeline):
- Interactive drag-and-drop or clickable columns:
  * "New Inbound" -> "Contacted" -> "Meeting Booked" -> "Proposal Sent" -> "Closed Won"
- Pre-populated realistic enterprise demo deals: Stripe ($180k), Figma ($120k), Notion ($95k), Ramp ($140k), Vercel ($210k).
- Cards show company logos, assigned rep avatar, stage value, days in stage, and priority score badge.

6. IN-BROWSER STATEFUL SIMULATION (Zero Backend Required):
- All state (installed modules, stage changes, call logs, newly added leads, notes) must mutate statefully in React/sessionStorage so that the entire demo is 100% interactive and fully functional in the browser without any API errors or blank screens.`;

async function callMcpTool(toolName, args = {}) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'mcp.lovable.dev',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          let jsonStr = data.trim();
          if (jsonStr.includes('data:')) {
            const lines = jsonStr.split('\n');
            const dataLine = lines.find(l => l.startsWith('data:'));
            if (dataLine) {
              jsonStr = dataLine.replace(/^data:\s*/, '');
            }
          }
          const parsed = JSON.parse(jsonStr);
          if (parsed.error) {
            reject(new Error(`MCP Error: ${JSON.stringify(parsed.error)}`));
          } else {
            resolve(parsed.result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('📡 Connecting to Lovable MCP server...');
  try {
    const workspacesResult = await callMcpTool('list_workspaces', {});
    console.log('Workspaces:', JSON.stringify(workspacesResult, null, 2));

    let workspaceId = null;
    if (workspacesResult && workspacesResult.structuredContent && workspacesResult.structuredContent.workspaces) {
      workspaceId = workspacesResult.structuredContent.workspaces[0]?.id;
    } else if (workspacesResult && workspacesResult.content) {
      const contentText = workspacesResult.content[0]?.text;
      if (contentText) {
        try {
          const wsList = JSON.parse(contentText);
          workspaceId = wsList.workspaces?.[0]?.id || wsList[0]?.id;
        } catch (e) {
          console.log('Workspace content raw:', contentText);
        }
      }
    }
    console.log('Using Workspace ID:', workspaceId);

    console.log('🚀 Creating Project on Lovable with Conversation OS Blueprint...');
    const projectParams = {
      initial_message: initialPrompt,
    };
    if (workspaceId) {
      projectParams.workspace_id = workspaceId;
    }

    const createResult = await callMcpTool('create_project', projectParams);
    console.log('\n===============================================================');
    console.log('🎉 PROJECT CREATED ON LOVABLE!');
    console.log('===============================================================');
    console.log(JSON.stringify(createResult, null, 2));
  } catch (err) {
    console.error('Error during Lovable creation:', err);
    process.exit(1);
  }
}

run();
