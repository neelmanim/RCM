import { JourneyNode } from './JourneyNode';

export { NODE_ACCENT } from './JourneyNode';

// Same component for every type — React Flow keys nodeTypes by the node's
// own `type` string, and JourneyNode already branches on `type` internally.
export const nodeTypes = {
  trigger: JourneyNode,
  email: JourneyNode,
  wait: JourneyNode,
  condition: JourneyNode,
  call: JourneyNode,
  sms: JourneyNode,
  whatsapp: JourneyNode,
};
