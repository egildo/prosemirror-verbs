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
  toolbarSpecs,
  controlSpecs,
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
  ToolbarSpec,
  ToolbarItem,
  ControlSpec,
  ControlItem,
} from './registry.js'

// Derived: what the verb-Schema reads off the noun-Schema. `interiorTypes` is
// exported because the sealed closure is a whole-schema property and must stay
// inspectable rather than magic.
export { markVerbs, insertVerbs, basicVerbs, interiorTypes } from './derive.js'
export type { Authoring } from './derive.js'
