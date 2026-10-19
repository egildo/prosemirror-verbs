// Derivation — the verb-Schema reading the noun-Schema.
//
// V3 says verbs enter the registry two ways: **declared** (hand-written
// entries) and **derived** (computed from the schema). Everything in this file
// is the second kind. It is the half that makes the package's name literal
// rather than metaphorical: the register does not merely sit beside the
// Schema, it reads it and generates.
//
// Two findings bound what derivation can do, and both are worth stating where
// the code lives:
//
// **Derivation's reach is the readback's reach.** A derived verb has to
// *address* something, and a selection can only name what V7 already
// enumerated — the mark set, the textblock's markup, the ancestor path. An
// attribute on a node a selection names is derivable; an attribute on a node
// reached through a plugin's own resolver (a grid map, say) is not, and no
// amount of schema-reading will change that. It is a boundary drawn by a
// standing stone, not a limitation of this file.
//
// **The schema declares what is grammatically legal, never what is
// legitimately user-creatable.** A table row is legal inside a table body, so
// `insertPoint` finds a spot for one — and a derived insert verb will happily
// put a raw row into a spreadsheet, past every structural command its owner
// wrote. Only the plugin that owns the noun can say otherwise, which is why
// `authoring` exists below. That is the mirror of the taste ruling (V12):
// taste went to the host because a host can reasonably disagree; this stays
// with the plugin because no host can.

import { toggleMark } from 'prosemirror-commands'
import { insertPoint } from 'prosemirror-transform'
import type { Command, EditorState } from 'prosemirror-state'
import type { Attrs, ContentMatch, Mark, MarkType, NodeType, ResolvedPos, Schema } from 'prosemirror-model'
import { fromCommands, markActive } from './registry.js'
import type { Capability, VerbArgs, Verb } from './registry.js'
import type { VerbArg } from 'verbr'

// ── The authoring hint ───────────────────────────────────────────────────────

/// What a plugin says about how its nouns may be brought into being — a data
/// key on a NodeSpec, read only by derivation. It rides on the spec under the
/// same allowance the entry contract carries and the same precedent
/// prosemirror-tables set with `tableRole` (and prosemirror-spreads with
/// `spreadsRole`, whose own comment already calls it a hook for third-party
/// tooling).
///
/// This is a **capability fact, not taste**: no second editor could reasonably
/// disagree that a table cell is not a top-level insert. That is the test V12
/// gives, and it is why this belongs to the plugin rather than to the host.
export interface Authoring {
  /// The subtree this node encloses is mine — derive nothing for any type
  /// whose every path from the doc runs through here. One declaration on a
  /// container replaces one per interior noun, and it states the cause (this
  /// is a black box) rather than the consequence, nine times over.
  ///
  /// Note this is *not* `isolating`, which it will sit beside in many specs:
  /// isolating governs whether selection and deletion cross a boundary, and
  /// says nothing about who may create what.
  sealed?: boolean
  /// `false` — I declare my own insert capability; don't derive a worse one.
  /// A function — derive it, but build the command with this instead of
  /// `createAndFill`. Absent — derive it the ordinary way.
  ///
  /// A command-bearing hint takes the resolved type, because
  /// `insertTable(schema.nodes.table)` cannot be a literal on the very spec
  /// that defines `table`.
  insert?: false | ((type: NodeType) => Command)
}

const authoringOf = (type: NodeType): Authoring | undefined =>
  (type.spec as { authoring?: Authoring }).authoring

// ── The sealed closure ───────────────────────────────────────────────────────

// Every node type a content expression admits, by walking its compiled DFA.
// ProseMirror keeps the automaton public precisely so tools can ask this.
function childTypes(type: NodeType): NodeType[] {
  const found: NodeType[] = []
  const seen = new Set<ContentMatch>()
  const walk = (match: ContentMatch) => {
    if (seen.has(match)) return
    seen.add(match)
    for (let i = 0; i < match.edgeCount; i++) {
      const edge = match.edge(i)
      found.push(edge.type)
      walk(edge.next)
    }
  }
  walk(type.contentMatch)
  return found
}

// Everything reachable from the top node without traversing any of `walls`.
function reachable(schema: Schema, walls: Set<NodeType>): Set<NodeType> {
  const seen = new Set<NodeType>()
  const stack: NodeType[] = [schema.topNodeType]
  while (stack.length) {
    const type = stack.pop()!
    if (seen.has(type) || walls.has(type)) continue
    seen.add(type)
    for (const child of childTypes(type)) if (!seen.has(child)) stack.push(child)
  }
  return seen
}

// The transitive closure of what a type can contain.
function descendants(type: NodeType): Set<NodeType> {
  const seen = new Set<NodeType>()
  const stack = childTypes(type)
  while (stack.length) {
    const next = stack.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    for (const child of childTypes(next)) if (!seen.has(child)) stack.push(child)
  }
  return seen
}

/// The interior of every sealed container: the node types whose **only** path
/// from the doc runs through one. Cached on the schema, because it is a
/// whole-schema property and derivation asks for it once per set.
///
/// Exported on purpose. A rule computed across the entire schema must be
/// **inspectable rather than magic** — the honest cost of declaring a cause
/// once instead of a consequence nine times is that you can no longer read one
/// spec and know its answer, so this is how you get the answer. It also means
/// the rule is live: a host who later makes a table row legal somewhere else
/// un-seals it, correctly and surprisingly.
export function interiorTypes(schema: Schema): NodeType[] {
  let cached = schema.cached.verbsInterior as NodeType[] | undefined
  if (cached) return cached
  const sealed = new Set(
    Object.values(schema.nodes).filter((type) => authoringOf(type)?.sealed),
  )
  const interior = new Set<NodeType>()
  if (sealed.size) {
    const outside = reachable(schema, sealed)
    for (const container of sealed) {
      for (const type of descendants(container)) {
        // A container is never interior to itself — a schema whose tables nest
        // would otherwise seal away its own insert verb.
        if (!outside.has(type) && !sealed.has(type)) interior.add(type)
      }
    }
  }
  cached = [...interior]
  schema.cached.verbsInterior = cached
  return cached
}

// ── Marks ────────────────────────────────────────────────────────────────────

// An attribute the spec gives no default is one a collector must ask for. The
// `validate` string, where a schema bothers to write one, is the closest the
// noun-Schema comes to declaring an argument's type — thin, but real, and
// prosemirror-schema-basic's `link.href` carries one.
function requiredAttrs(spec: { attrs?: Record<string, unknown> } | undefined): VerbArg[] {
  return Object.entries(spec?.attrs || {})
    .filter(([, attr]) => !('default' in (attr as object)))
    .map(([name, attr]) => {
      const validate = (attr as { validate?: unknown }).validate
      const kinds = typeof validate === 'string' ? validate.split('|') : []
      if (kinds.includes('number')) return { name, type: 'number', required: true }
      if (kinds.includes('string')) return { name, type: 'text', required: true }
      return { name, required: true }
    })
}

// The value readback for a mark that carries arguments: the attribute you
// stand *in*. A range reads forward — at a link's start boundary `$from.marks()`
// would answer for the unlinked character before it, which is the kind of
// subtlety that gets written once for the one mark somebody thought about.
// Written here, every attr-mark in every schema gets the careful version.
function attrReadback(type: MarkType, args: VerbArg[]) {
  return (state: EditorState) => {
    const { $from, empty } = state.selection
    const marks = empty ? state.storedMarks || $from.marks() : ($from.nodeAfter?.marks ?? $from.marks())
    const mark = type.isInSet(marks)
    if (!mark) return null
    return args.length === 1 ? (mark.attrs[args[0]!.name] ?? null) : mark.attrs
  }
}

// The stretch of text around a cursor that carries this very mark — the whole
// link you stand in, not the one character beside the caret. The cursor sits
// between two children, and the mark is on one of them.
function markExtent($pos: ResolvedPos, mark: Mark): { from: number; to: number } | null {
  const parent = $pos.parent
  let index = $pos.index()
  if (index >= parent.childCount || !mark.isInSet(parent.child(index).marks)) {
    if (index > 0 && mark.isInSet(parent.child(index - 1).marks)) index -= 1
    else return null
  }
  let from = $pos.start()
  for (let i = 0; i < index; i++) from += parent.child(i).nodeSize
  let to = from + parent.child(index).nodeSize
  for (let i = index - 1; i >= 0 && mark.isInSet(parent.child(i).marks); i--) from -= parent.child(i).nodeSize
  for (let i = index + 1; i < parent.childCount && mark.isInSet(parent.child(i).marks); i++) to += parent.child(i).nodeSize
  return { from, to }
}

// Set a mark's attributes, or with `null` take the mark away — never toggle.
// `toggleMark` was this verb's command, and a toggle cannot say *change the
// address*: with the cursor in a link it took the link off whatever you typed
// next, and over a selected link it removed it, while the field showed the
// address you meant to replace. So this acts on what the readback shows: the
// selection when there is one, else the whole mark the cursor stands in, else
// the mark you are about to type with.
function setMark(type: MarkType, attrs: Attrs | null): Command {
  return (state, dispatch) => {
    const { empty, $from, from, to } = state.selection
    if (!empty) {
      if (!attrs && !state.doc.rangeHasMark(from, to, type)) return false
      if (dispatch) dispatch((attrs ? state.tr.addMark(from, to, type.create(attrs)) : state.tr.removeMark(from, to, type)).scrollIntoView())
      return true
    }
    const current = type.isInSet(state.storedMarks || $from.marks())
    const extent = current && !state.storedMarks ? markExtent($from, current) : null
    if (extent) {
      if (dispatch) {
        const tr = state.tr.removeMark(extent.from, extent.to, type)
        dispatch(attrs ? tr.addMark(extent.from, extent.to, type.create(attrs)) : tr)
      }
      return true
    }
    if (!attrs && !current) return false
    if (dispatch) dispatch(attrs ? state.tr.addStoredMark(type.create(attrs)) : state.tr.removeStoredMark(type))
    return true
  }
}

/// Derivation → one capability per mark in the schema. A mark's domain is
/// membership in the mark set, so its readback is boolean and its command is
/// `toggleMark`; a mark carrying attributes the spec gives no default (a link's
/// href) becomes an **arg-verb** instead, its readback the value you stand in,
/// its gate the toggle's dry run, and its command a **set**: given the values it
/// writes them onto the mark you stand in, given none it takes the mark away.
///
/// Nothing is named here — these are capabilities. `basicVerbs` below is this
/// derivation plus the conventional dressing for the marks everyone has, which
/// is the package eating its own doctrine.
export function markVerbs(schema: Schema): Verb[] {
  return fromCommands(markCapabilities(schema))
}

function markCapabilities(schema: Schema): Capability[] {
  return Object.values(schema.marks).map((type): Capability => {
    // Optional at the door, because their absence means something: no address
    // is no link. Every one given sets the mark, none removes it, some is refused.
    const args = requiredAttrs(type.spec).map(({ required: _, ...arg }) => arg)
    if (!args.length) {
      return {
        id: type.name,
        command: toggleMark(type),
        read: (state: EditorState) => markActive(state, type),
      }
    }
    return {
      id: type.name,
      command: (values: VerbArgs) => {
        const given = args.filter((arg) => values[arg.name] !== undefined)
        if (given.length === 0) return setMark(type, null)
        if (given.length < args.length) return () => false
        return setMark(type, Object.fromEntries(args.map((arg) => [arg.name, values[arg.name]])))
      },
      args,
      read: attrReadback(type, args),
      // A factory can't be dry-run, so the gate is explicit — and it is the
      // command's own dry run rather than a hand-written guess at it, which is
      // the rule that repaired link's over-wide gate: a gate must not be wider
      // than what it gates.
      enabled: (state: EditorState) => toggleMark(type)(state),
    }
  })
}

// The conventional dressing for the marks a schema is likely to have, plus the
// one thing the noun-Schema cannot say — that an href is a URL and not merely
// a string. This is the same shape a plugin uses to offer its taste (spreads'
// `spreadsTaste`), applied to our own derivation; `args` rides here rather
// than in a cascade layer because a capability key is closed to layers.
const BASIC: Record<string, Record<string, unknown>> = {
  strong: { label: 'Bold', icon: 'bold', keys: ['Mod-b'], keywords: ['bold', 'strong'] },
  em: { label: 'Italic', icon: 'italic', keys: ['Mod-i'], keywords: ['italic', 'emphasis'] },
  code: { label: 'Code', icon: 'code', keys: ['Mod-`'], keywords: ['code', 'monospace'] },
  link: {
    label: 'Link',
    icon: 'link',
    keys: ['Mod-k'],
    keywords: ['link', 'url', 'href'],
    args: [{ name: 'href', label: 'URL', type: 'url' }],
  },
}
// A strip reads in the order it is given, so the familiar four keep their
// familiar order and anything else a schema brings follows behind.
const BASIC_ORDER = ['strong', 'em', 'code', 'link']

/// The package's default verbs — marks basics, the way prosemirror-schema-basic
/// ships a starter set of nodes and marks. A host may write its own entries
/// instead. Since 2026-07-29 this is `markVerbs` dressed, not a hand-written
/// list: a schema carrying an underline or a superscript now gets it for free,
/// with the same readback and the same gate as the four we thought about.
export function basicVerbs(schema: Schema): Verb[] {
  const rank = (verb: Capability) => {
    const at = BASIC_ORDER.indexOf(verb.id)
    return at < 0 ? BASIC_ORDER.length : at
  }
  return fromCommands(
    markCapabilities(schema)
      .map((verb) => ({ ...verb, section: 'marks', ...BASIC[verb.id] }))
      .sort((a, b) => rank(a) - rank(b)),
  )
}

// ── Nodes ────────────────────────────────────────────────────────────────────

// A capability, not a declaration: insert a fresh node of `type`, wherever the schema
// allows one near the cursor. `insertPoint` is ProseMirror's own "can this node go
// here" query — the noun-equivalent of a command's dry run. Called without dispatch it
// answers availability (position-aware); called with dispatch it inserts.
const insertNode =
  (type: NodeType, attrs?: Attrs): Command =>
  (state, dispatch) => {
    const point = insertPoint(state.doc, state.selection.from, type)
    if (point == null) return false
    const node = type.createAndFill(attrs)
    if (!node) return false
    if (dispatch) dispatch(state.tr.insert(point, node).scrollIntoView())
    return true
  }

/// Derivation → verbs from the noun-Schema. One insert-verb per node type: the
/// possibility engine pointed at nouns rather than at commands. Every entry's command
/// consults insertPoint, so availability is position-aware and needs no separate
/// `enabled`. A node with required attrs (image → src) becomes an arg-insert — declared
/// with its derived arg-schema, skipped by surfaces exactly like link, until a collector
/// exists. `doc` and text are not insertable-node candidates and are left out.
///
/// And the grammar is not the whole story: a type inside a sealed container, or
/// one whose spec says `insert: false`, is left out too. Before that hint
/// existed this function derived ten verbs for prosemirror-spreads' anatomy,
/// one of which — `insert:table_cell` — really did put a third cell into a
/// two-column row, past every structural command spreads wrote (verified in the
/// venue, 2026-07-29).
export function insertVerbs(schema: Schema): Verb[] {
  const interior = new Set(interiorTypes(schema))
  return fromCommands(Object.values(schema.nodes)
    .filter((type) => type !== schema.topNodeType && !type.isText)
    .filter((type) => !interior.has(type) && authoringOf(type)?.insert !== false)
    .map((type): Capability => {
      const req = requiredAttrs(type.spec)
      const declared = authoringOf(type)?.insert
      const make = typeof declared === 'function' ? declared(type) : null
      return {
        id: `insert:${type.name}`,
        label: `Insert ${type.name.replace(/_/g, ' ')}`,
        section: 'insert',
        ...(req.length && !make
          ? { command: (args: VerbArgs) => insertNode(type, args as Attrs), args: req }
          : { command: make ?? insertNode(type) }),
      }
    }))
}
