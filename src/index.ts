// prosemirror-verbs — public surface.
//
// The registry and its pure projections, nothing else. The package does not care
// who consumes it — human surfaces (a toolbar element, a palette) and machine
// consumers (a console rig, a test, an agent) all project the same list. Nothing
// here touches the DOM or knows a surface exists.

export {
  basicVerbs,
  blocktypeVerb,
  wrapVerbs,
  historyVerbs,
  insertVerbs,
  expand,
  composeVerbs,
  composeKeyboard,
  collectingCommand,
  toKeymap,
  toolbarSpecs,
  formatKeys,
  markActive,
  markupActive,
  wrapDepth,
} from './registry.js'

export type {
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
} from './registry.js'
