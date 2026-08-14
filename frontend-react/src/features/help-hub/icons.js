import {
  Rocket, LayoutDashboard, ClipboardList, UserCircle, Bell, Trophy,
  ShieldCheck, Users, Lock, MessageSquare, SlidersHorizontal, Phone, PhoneCall,
  BarChart3, Activity, Settings, Plug, Workflow, Lightbulb, ScrollText,
} from 'lucide-react';

// Keyed by exact section title (not array position) so adding, removing, or
// reordering an entry in data/sections.js can't silently misalign a section
// with the wrong icon — a lookup miss falls back to BookOpen instead.
export const SECTION_ICONS_BY_TITLE = {
  '🚀 Getting Started': Rocket,
  '📊 Dashboard': LayoutDashboard,
  '📋 Leads': ClipboardList,
  '👤 Lead Detail': UserCircle,
  '🔔 Task Notifications': Bell,
  '🏆 Leaderboard & SDR Performance': Trophy,
  '🛡️ Admin Panel': ShieldCheck,
  '👥 POD Management': Users,
  '🔒 Audit Logs': Lock,
  '💬 Send Feedback': MessageSquare,
  '📞 Call & Pipeline Settings': SlidersHorizontal,
  '📞 Aircall Dialer': Phone,
  '📞 RCM Dialer (Browser Calling)': PhoneCall,
  '📈 SDR Metrics': BarChart3,
  '📡 Activity Feed': Activity,
  '⚙️ Settings': Settings,
  '🔌 APIs': Plug,
  '🔄 Pipeline Statuses': Workflow,
  '💡 Tips & Best Practices': Lightbulb,
};

export const RELEASE_NOTES_ICON = ScrollText;
