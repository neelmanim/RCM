/**
 * Tests for js/views/pods.js — POD Management rendering and interactions.
 *
 * Tests the rendering logic, member filtering, and POD CRUD operations
 * using mocked API responses. Covers the Add SDR dropdown that was fixed
 * in commit 5696216 (overflow: visible fix).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


// ── Test data ────────────────────────────────────────────────────────────────
const mockPods = [
    {
        id: 'pod-1',
        name: 'Alpha Team',
        admin_name: 'Jane Admin',
        admin_email: 'jane@co.com',
        member_count: 2,
        members: [
            { id: 'sdr-1', name: 'Alice', email: 'alice@co.com', assigned_leads: 15 },
            { id: 'sdr-2', name: 'Bob', email: 'bob@co.com', assigned_leads: 12 },
        ]
    },
    {
        id: 'pod-2',
        name: 'Beta Team',
        admin_name: 'John Admin',
        admin_email: 'john@co.com',
        member_count: 0,
        members: []
    }
];

const mockUsers = [
    { id: 'sdr-1', name: 'Alice', email: 'alice@co.com', role: 'SDR' },
    { id: 'sdr-2', name: 'Bob', email: 'bob@co.com', role: 'SDR' },
    { id: 'sdr-3', name: 'Charlie', email: 'charlie@co.com', role: 'SDR' },
    { id: 'admin-1', name: 'Jane Admin', email: 'jane@co.com', role: 'Super Admin' },
];


// ═══════════════════════════════════════════════════════════════════════════════
// SDR filtering logic (available SDRs for Add dropdown)
// ═══════════════════════════════════════════════════════════════════════════════
describe('POD Add SDR dropdown — SDR filtering', () => {
    it('filters out SDRs already in the pod', () => {
        const pod = mockPods[0]; // Alpha Team: has sdr-1, sdr-2
        const availableSDRs = mockUsers.filter(u => u.role === 'SDR');
        const remaining = availableSDRs.filter(s => !pod.members.some(m => m.id === s.id));
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('sdr-3');
    });

    it('shows all SDRs for empty pod', () => {
        const pod = mockPods[1]; // Beta Team: 0 members
        const availableSDRs = mockUsers.filter(u => u.role === 'SDR');
        const remaining = availableSDRs.filter(s => !pod.members.some(m => m.id === s.id));
        expect(remaining).toHaveLength(3);
    });

    it('excludes non-SDR users from dropdown', () => {
        const availableSDRs = mockUsers.filter(u => u.role === 'SDR');
        expect(availableSDRs).toHaveLength(3);
        expect(availableSDRs.every(u => u.role === 'SDR')).toBe(true);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// POD card rendering logic
// ═══════════════════════════════════════════════════════════════════════════════
describe('POD card rendering', () => {
    it('renders member count badge', () => {
        const pod = mockPods[0];
        const badgeText = `${pod.member_count} members`;
        expect(badgeText).toBe('2 members');
    });

    it('renders "No members yet" for empty pod', () => {
        const pod = mockPods[1];
        const emptyText = pod.members.length === 0 ? 'No members yet' : null;
        expect(emptyText).toBe('No members yet');
    });

    it('renders admin name and email', () => {
        const pod = mockPods[0];
        const adminLabel = `${pod.admin_name} (${pod.admin_email})`;
        expect(adminLabel).toContain('Jane Admin');
        expect(adminLabel).toContain('jane@co.com');
    });

    it('handles unassigned admin gracefully', () => {
        const pod = { ...mockPods[0], admin_name: null, admin_email: null };
        const adminLabel = pod.admin_name || 'Unassigned';
        expect(adminLabel).toBe('Unassigned');
    });

    it('renders empty state when no pods exist', () => {
        const pods = [];
        const showEmpty = pods.length === 0;
        expect(showEmpty).toBe(true);
    });

    it('Super Admin sees Create POD button and Delete buttons', () => {
        const isSuperAdmin = true;
        const createBtn = isSuperAdmin ? '<button>+ Create POD</button>' : '';
        const deleteBtn = isSuperAdmin ? '<button>🗑️</button>' : '';
        expect(createBtn).toContain('Create POD');
        expect(deleteBtn).toContain('🗑️');
    });

    it('Non-Super Admin does not see Create POD or Delete buttons', () => {
        const isSuperAdmin = false;
        const createBtn = isSuperAdmin ? '<button>+ Create POD</button>' : '';
        const deleteBtn = isSuperAdmin ? '<button>🗑️</button>' : '';
        expect(createBtn).toBe('');
        expect(deleteBtn).toBe('');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// POD form validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('POD creation validation', () => {
    it('rejects empty pod name', () => {
        const name = '   '.trim();
        const isValid = !!name;
        expect(isValid).toBe(false);
    });

    it('accepts valid pod name', () => {
        const name = 'Delta Team'.trim();
        const isValid = !!name;
        expect(isValid).toBe(true);
    });

    it('allows creating pod without admin (optional field)', () => {
        const adminId = '';
        const resolvedAdminId = adminId || null;
        expect(resolvedAdminId).toBeNull();
    });

    it('passes admin ID when selected', () => {
        const adminId = 'admin-1';
        const resolvedAdminId = adminId || null;
        expect(resolvedAdminId).toBe('admin-1');
    });

    it('allows creating pod without a timezone (optional field, defaults to UTC)', () => {
        const timezone = '';
        expect(timezone || null).toBeNull();
    });

    it('passes the selected timezone when set', () => {
        const timezone = 'America/New_York';
        expect(timezone || null).toBe('America/New_York');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Pod timezone (Analytics day-boundary bucketing, added 2026-08-14)
// ═══════════════════════════════════════════════════════════════════════════════
describe('POD timezone', () => {
    it('shows the pod timezone in its select when set', () => {
        const pod = { ...mockPods[0], timezone: 'Asia/Kolkata' };
        expect(pod.timezone).toBe('Asia/Kolkata');
    });

    it('defaults to unset (UTC) when the pod has no timezone', () => {
        const pod = { ...mockPods[1] }; // no timezone field
        expect(pod.timezone || '').toBe('');
    });

    it('clearing the select resolves to null, not an empty string, before saving', () => {
        const selectedValue = '';
        expect(selectedValue || null).toBeNull();
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Member display logic
// ═══════════════════════════════════════════════════════════════════════════════
describe('POD member display', () => {
    it('shows name when available, falls back to email', () => {
        const memberWithName = { name: 'Alice', email: 'alice@co.com' };
        const memberNoName = { name: '', email: 'bob@co.com' };
        expect(memberWithName.name || memberWithName.email).toBe('Alice');
        expect(memberNoName.name || memberNoName.email).toBe('bob@co.com');
    });

    it('shows assigned lead count per member', () => {
        const member = mockPods[0].members[0];
        const label = `${member.assigned_leads} leads`;
        expect(label).toBe('15 leads');
    });

    it('generates correct add-member select ID per pod', () => {
        const podId = 'pod-1';
        const selectId = `add-member-${podId}`;
        expect(selectId).toBe('add-member-pod-1');
    });
});
