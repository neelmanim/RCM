import { SMS_MAX_LENGTH } from './nodeDefaults';

// Client-side graph validation — pure function over {nodes, edges}, run on
// every change (Deliverable 4). Never the authoritative gate: POST /publish
// re-checks server-side, since publish is a state-changing action that must
// not trust client-only validation.
export function validateGraph(nodes, edges) {
  const errors = []; // { nodeId, message }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    errors.push({ nodeId: null, message: 'This cadence has no trigger node — add one to define how leads enter it.' });
  } else if (triggers.length > 1) {
    triggers.slice(1).forEach((n) => errors.push({ nodeId: n.id, message: 'Only one trigger node is allowed per cadence.' }));
  }

  // Reachability: every non-trigger node needs SOME way to be reached — a
  // plain graph edge targeting it, or a condition node's branch config
  // pointing at it.
  const reachableTargets = new Set(edges.map((e) => e.target));
  nodes.forEach((n) => {
    if (n.type === 'condition') {
      const data = n.data || {};
      if (data.branch_on_timeout) reachableTargets.add(data.branch_on_timeout);
      Object.values(data.branch_on_event || {}).forEach((t) => reachableTargets.add(t));
    }
  });
  nodes.forEach((n) => {
    if (n.type !== 'trigger' && !reachableTargets.has(n.id)) {
      errors.push({ nodeId: n.id, message: 'This node is unreachable — nothing links to it.' });
    }
  });

  nodes.forEach((n) => {
    const data = n.data || {};
    if (n.type === 'email') {
      if (data.variants?.length) {
        if (data.variants.length < 2) {
          errors.push({ nodeId: n.id, message: 'Needs at least 2 variants for an A/B test, or none at all.' });
        }
        data.variants.forEach((v, i) => {
          if (!v.subject?.trim()) errors.push({ nodeId: n.id, message: `Variant ${i + 1} needs a subject.` });
          if (!v.body?.trim()) errors.push({ nodeId: n.id, message: `Variant ${i + 1} needs a body.` });
        });
      } else {
        if (!data.subject?.trim()) errors.push({ nodeId: n.id, message: 'Email node needs a subject.' });
        if (!data.body?.trim()) errors.push({ nodeId: n.id, message: 'Email node needs a body.' });
      }
    }
    if (n.type === 'wait') {
      if (!data.duration_hours || data.duration_hours <= 0) {
        errors.push({ nodeId: n.id, message: 'Wait node needs a duration greater than 0 hours.' });
      }
    }
    if (n.type === 'sms') {
      if (!data.message?.trim()) errors.push({ nodeId: n.id, message: 'SMS node needs a message.' });
      else if (data.message.length > SMS_MAX_LENGTH) {
        errors.push({ nodeId: n.id, message: `SMS message is too long (max ${SMS_MAX_LENGTH} characters).` });
      }
    }
    if (n.type === 'whatsapp') {
      if (!data.template_name?.trim()) errors.push({ nodeId: n.id, message: 'WhatsApp node needs a template selected.' });
    }
    if (n.type === 'condition') {
      if (!data.timeout_hours || data.timeout_hours <= 0) {
        errors.push({ nodeId: n.id, message: 'Condition node needs a timeout greater than 0 hours.' });
      }
      if (!data.branch_on_timeout) {
        errors.push({ nodeId: n.id, message: 'Condition node needs a "on timeout" branch target.' });
      } else if (!byId.has(data.branch_on_timeout)) {
        errors.push({ nodeId: n.id, message: 'Condition node\'s timeout branch points at a node that no longer exists.' });
      }
      // Note: branch_on_event is a plain object, so its keys can never
      // literally duplicate — NodeConfigPanel's dropdown prevents a user
      // from picking an event type already used by another branch on the
      // same node (the actual failure mode: silently overwriting a sibling
      // branch), so there's nothing to validate here beyond blank/dangling.
      Object.entries(data.branch_on_event || {}).forEach(([eventType, targetId]) => {
        if (!eventType) {
          errors.push({ nodeId: n.id, message: 'This condition has an event branch with no event type selected.' });
        }
        if (!targetId) {
          errors.push({ nodeId: n.id, message: eventType ? `The "${eventType}" branch needs a target node.` : 'This event branch needs a target node.' });
        } else if (!byId.has(targetId)) {
          errors.push({ nodeId: n.id, message: `Condition node's "${eventType}" branch points at a node that no longer exists.` });
        }
      });
    }
  });

  return errors;
}

export function errorsByNode(errors) {
  const map = new Map();
  errors.forEach((e) => {
    if (!e.nodeId) return;
    if (!map.has(e.nodeId)) map.set(e.nodeId, []);
    map.get(e.nodeId).push(e.message);
  });
  return map;
}
