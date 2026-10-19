// prosemirror-verbs — public surface.
//
// A ProseMirror profile of verbr. verbr owns the register, the taste, the
// projection and the one checked door; this package says what only ProseMirror
// can: verbs over an EditorState that run a Command, a command's dry run as its
// availability, the keyboard as a stack of keymap plugins, and starter sets
// read off the schema. Nothing here touches the DOM or knows a surface exists.

// The entry contract, the door as a Command, the keyboard, and the starter sets
// that are hand-declared.
export {
  fromCommands,
  commandFor,
  blocktypeVerb,
  wrapVerbs,
  historyVerbs,
  expand,
  composeKeyboard,
  toKeymap,
  markActive,
  markupActive,
  wrapDepth,
} from './registry.js'

export type {
  Capability,
  Verb,
  VerbArgs,
  CommandFactory,
  Collector,
  PolicyLayer,
  KeyClaim,
  Keyboard,
} from './registry.js'

// Relations: what the register knows about itself. Facts, derived — never
// declared, so never wrong (V14).
export { relations } from './relations.js'
export type { Relations, RelationEdge } from './relations.js'

// Derived: what the verb-Schema reads off the noun-Schema. `interiorTypes` is
// exported because the sealed closure is a whole-schema property and must stay
// inspectable rather than magic.
export { markVerbs, insertVerbs, basicVerbs, interiorTypes } from './derive.js'
export type { Authoring } from './derive.js'
