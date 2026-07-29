// prosemirror-verbs — public surface.
//
// The registry and its pure projections, nothing else. The package does not care
// who consumes it — human surfaces (a toolbar element, a palette) and machine
// consumers (a console rig, a test, an agent) all project the same list. Nothing
// here touches the DOM or knows a surface exists.

// The contract, the two host acts, the keyboard, the projections, and the
// starter sets that are hand-declared.
export {
  blocktypeVerb,
  wrapVerbs,
  historyVerbs,
  expand,
  composeVerbs,
  composeKeyboard,
  collectingCommand,
  toKeymap,
  applyAttrs,
  humanizeId,
  namingLayer,
  formatKeys,
  markActive,
  markupActive,
  wrapDepth,
} from './registry.js'

export type {
  Capability,
  VerbAttrs,
  AttrLayer,
  AttrClaim,
  Attributed,
  VerbEntry,
  Verb,
  VerbArg,
  VerbArgs,
  DomainMember,
  CommandFactory,
  Collector,
  PolicyLayer,
  KeyClaim,
  Keyboard,
} from './registry.js'

// Projections: the register rendered into what a consumer eats. `controlSpecs`
// is a flat view of `controlTree` — one layout among several, no longer the
// only answer the projection can give.
export { toolbarSpecs, controlSpecs, controlTree, isGroup } from './project.js'
export type {
  ToolbarSpec,
  ToolbarItem,
  ControlSpec,
  ControlItem,
  ControlGroup,
  ControlTree,
  ControlConflict,
  TreeItem,
  GroupSpec,
  GroupList,
} from './project.js'

// Relations: what the register knows about itself. Facts, derived — never
// declared, so never wrong (V14).
export { relations } from './relations.js'
export type { Relations, RelationEdge } from './relations.js'

// Derived: what the verb-Schema reads off the noun-Schema. `interiorTypes` is
// exported because the sealed closure is a whole-schema property and must stay
// inspectable rather than magic.
export { markVerbs, insertVerbs, basicVerbs, interiorTypes } from './derive.js'
export type { Authoring } from './derive.js'
