// prosemirror-verbs — the editor's verb-Schema, as a ProseMirror profile of verbr.
//
// ProseMirror's Schema registers the document's nouns: nodes and marks, what the
// document is made of. This registers its verbs: commands, and how they are summoned.
//
// verbr owns the register, the taste, the projection and the one checked door
// (`compose`, `applyTaste`, `project`, `invoke`). What is left here is what only
// ProseMirror can say: that a verb's context is an `EditorState`, that what it
// runs is a `Command`, that a command's dry run is its availability, and that
// the keyboard is a stack of keymap plugins. Plus the starter sets, which read
// the schema they are given and depend only on prosemirror-*.

import { keymap } from 'prosemirror-keymap'
import { setBlockType, wrapIn } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
import { undo, redo } from 'prosemirror-history'
import { invoke, prepare } from '@egildo/verbr'
import type { Attributed, Register, Verb as VerbrVerb, VerbArg } from '@egildo/verbr'
import type { Command, EditorState, Plugin } from 'prosemirror-state'
import type { Attrs, MarkType, NodeType, Schema } from 'prosemirror-model'

// ── The entry contract ───────────────────────────────────────────────────────
//
// Structural, nothing to import at runtime. A plugin declares by exporting
// plain objects of the `Capability` shape — ProseMirror's own natural form, a
// command — and pays zero dependency on this package or on verbr. The host
// turns them into verbs with `fromCommands`, once, before composing. Dry runs
// and readbacks are called on every editor transaction by syncing consumers:
// they must be pure and cheap. Extra properties are preserved, never refused.

/** Values a collector gathers for an arg-verb, keyed by the arg's `name`. */
export type VerbArgs = Record<string, unknown>

/** An arg-verb's command: give it the collected args, it gives you the Command. */
export type CommandFactory = (args: VerbArgs) => Command

/// What a plugin declares: **what it can do, and what it can tell you.**
/// Nothing else is required — no name, no glyph, no chord, no section (V12,
/// amended 2026-07-28: plugins ship *capabilities*, hosts ship verbs and chrome).
/// Whatever taste a declarer does carry rides along as extra keys.
export interface Capability {
  /** Unique across the composition — a collision is refused at compose. */
  id: string
  /** A ProseMirror Command — or, iff `args` is declared, a factory (args) => Command. */
  command: Command | CommandFactory
  /** The readback, if the verb addresses state. Booleans for toggles, a member value for one-of-N, a count for wraps. */
  read?: (state: EditorState) => unknown
  /** Availability for arg-verbs only, whose factory can't be dry-run without arguments. */
  enabled?: (state: EditorState) => boolean
  /** Present ⇒ `command` is a factory. */
  args?: VerbArg[]
  /** Taste or a host extension. Preserved, never refused. */
  [extra: string]: unknown
}

/** A verb in this profile: verbr's verb over an editor state, running a Command. */
export type Verb = VerbrVerb<EditorState, Command>

/// Capabilities → verbs. The author wrote the natural thing — a bare command,
/// or a factory when it takes arguments — and this erases the fork: `run` hands
/// back the Command, and a bare command's **dry run is its availability**, so
/// nothing is declared twice. An arg-verb keeps the gate it declared, because a
/// factory cannot be dry-run without its arguments.
export function fromCommands(entries: Capability | readonly Capability[]): Verb[] {
  return ([] as Capability[]).concat(entries).map(({ command, enabled, ...rest }) => {
    if (rest.args) {
      const factory = command as CommandFactory
      return { ...rest, run: (_state: EditorState, args?: VerbArgs) => factory(args ?? {}), ...(enabled ? { enabled } : {}) }
    }
    const bare = command as Command
    return { ...rest, run: () => bare, enabled: (state: EditorState) => bare(state) }
  }) as Verb[]
}

// ── Readbacks ────────────────────────────────────────────────────────────────
//
// Activity is a readback of the state a verb addresses. The document at a
// selection holds exactly three kinds of local fact — its mark set, its
// textblock's markup (type + attrs, ProseMirror's own word), and its ancestor
// path — so these three helpers are the complete document-side battery; plugin
// state, the other source, needs no helper (a verb just writes its predicate).

// Mark-set membership → boolean. Is the mark on, right here? Availability is a
// question the command answers (its dry run); activity is not — toggleMark
// applies whether the mark is on or off.
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection
  return empty
    ? !!type.isInSet(state.storedMarks || $from.marks())
    : state.doc.rangeHasMark(from, to, type)
}

// Markup identity → one-of-N. Does the textblock here carry this markup? A node
// has exactly one markup, so exclusivity is the document's own fact, not ours.
export function markupActive(state: EditorState, type: NodeType, attrs: Attrs | null = null): boolean {
  const { $from, to, node } = state.selection as { $from: any; to: number; node?: any }
  if (node) return node.hasMarkup(type, attrs)
  return to <= $from.end() && $from.parent.hasMarkup(type, attrs)
}

// Ancestor-path multiplicity → count. How deep is the selection inside wrappers
// of this type? Paths are sequences; sequences count.
export function wrapDepth(state: EditorState, type: NodeType): number {
  const { $from } = state.selection
  let depth = 0
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) depth++
  return depth
}

// ── Starter sets, declared ───────────────────────────────────────────────────
//
// Hand-written entries, the way prosemirror-schema-basic ships a starter set of
// nodes and marks; a host may write its own instead. The sets that are *derived*
// from the schema rather than declared — marks, inserts — live in derive.ts.
// Every set guards its nouns: entries whose types are absent from the schema
// given are not returned. Their taste — label, icon, keys, section — is the
// declared floor of the cascade, and a section named here is one the host must
// declare (or move the verb out of): verbr's sections are a closed vocabulary.

interface BlocktypeMember {
  value: string
  label: string
  icon?: string
  keys: string[]
  type: NodeType
  attrs: Attrs | null
}

// One verb, one enumerable domain. Block type is not seven verbs — it is one
// verb over the domain of textblock markups the schema offers. Domain members
// are data ({ value, label, icon?, keys? }); the mapping from value to markup
// stays in this closure. `read` is the verb's readback: which member is current.
// Members past H3 carry chords but no compact face — curation by omission, the
// same mechanism every surface already uses.
export function blocktypeVerb(schema: Schema): Verb {
  const candidates: (BlocktypeMember | undefined)[] = [
    schema.nodes.paragraph && {
      value: 'paragraph',
      label: 'Paragraph',
      icon: 'paragraph',
      keys: ['Shift-Mod-0'],
      type: schema.nodes.paragraph,
      attrs: null,
    },
    ...[1, 2, 3, 4, 5, 6].map(
      (level) =>
        schema.nodes.heading && {
          value: `h${level}`,
          label: `Heading ${level}`,
          ...(level <= 3 ? { icon: `heading-${level}` } : {}),
          keys: [`Shift-Mod-${level}`],
          type: schema.nodes.heading,
          attrs: { level },
        },
    ),
    schema.nodes.code_block && {
      value: 'code_block',
      label: 'Code block',
      icon: 'code-block',
      keys: ['Shift-Mod-\\'],
      type: schema.nodes.code_block,
      attrs: null,
    },
  ]
  const members = candidates.filter((member): member is BlocktypeMember => Boolean(member))
  const byValue = new Map(members.map((member) => [member.value, member]))

  const [verb] = fromCommands({
    id: 'blocktype',
    label: 'Block type',
    section: 'blocktype',
    command: (args: VerbArgs) => {
      const member = byValue.get(args.blocktype as string)
      return member ? setBlockType(member.type, member.attrs ?? undefined) : () => false
    },
    args: [
      {
        name: 'blocktype',
        label: 'Block type',
        required: true,
        domain: members.map(({ value, label, icon, keys }) => ({ value, label, ...(icon ? { icon } : {}), keys })),
      },
    ],
    read: (state: EditorState) =>
      members.find((member) => markupActive(state, member.type, member.attrs))?.value ?? null,
    keywords: ['paragraph', 'heading', 'title', 'code', 'block'],
  })
  return verb!
}

// Projection → conjugated forms. A verb over an enumerable domain, curried into
// one no-arg verb per member: each form takes the member's face and chords, and
// its readback is derived from the verb's own — boolean, current member ⟺ true.
// A form's availability is its own command's dry run, which is sharper than the
// base's gate: the base may run here, this member may not.
export function expand(verb: Verb): Verb[] {
  const arg = verb.args?.[0]
  if (!arg || !Array.isArray(arg.domain)) return []
  const read = verb.read
  const taste = (key: string) => (verb[key] !== undefined ? { [key]: verb[key] } : {})
  return arg.domain.map((member) => {
    const command = (state: EditorState) => verb.run(state, { [arg.name]: member.value })
    return {
      id: `${verb.id}:${member.value}`,
      run: command,
      enabled: (state: EditorState) => command(state)(state),
      ...(read ? { read: (state: EditorState) => read(state) === member.value } : {}),
      // Taste rides only where it was declared. A bare member yields a bare
      // verb with an ordinary id, which the cascade then names like any other.
      ...(member.label ? { label: member.label } : {}),
      ...(member.icon ? { icon: member.icon } : {}),
      ...(member.keys ? { keys: member.keys } : {}),
      ...taste('keywords'),
      ...taste('section'),
    }
  })
}

// Wrap verbs. The state a wrap addresses is depth — a count along the ancestor
// path — so the readback reads the natural number; a surface renders it as it
// likes (the projection presses on truthiness).
export function wrapVerbs(schema: Schema): Verb[] {
  const entries: (Capability | undefined)[] = [
    schema.nodes.blockquote && {
      id: 'blockquote',
      label: 'Quote',
      icon: 'blockquote',
      command: wrapIn(schema.nodes.blockquote),
      read: (state: EditorState) => wrapDepth(state, schema.nodes.blockquote),
      keys: ['Mod->'],
      keywords: ['quote', 'blockquote'],
      section: 'wraps',
    },
    schema.nodes.bullet_list && {
      id: 'bullet_list',
      label: 'Bullet list',
      icon: 'list-bullet',
      command: wrapInList(schema.nodes.bullet_list),
      read: (state: EditorState) => wrapDepth(state, schema.nodes.bullet_list),
      keys: ['Shift-Mod-8'],
      keywords: ['list', 'bullet', 'unordered'],
      section: 'wraps',
    },
    schema.nodes.ordered_list && {
      id: 'ordered_list',
      label: 'Ordered list',
      icon: 'list-ordered',
      command: wrapInList(schema.nodes.ordered_list),
      read: (state: EditorState) => wrapDepth(state, schema.nodes.ordered_list),
      keys: ['Shift-Mod-9'],
      keywords: ['list', 'ordered', 'numbered'],
      section: 'wraps',
    },
  ]
  return fromCommands(entries.filter((entry): entry is Capability => Boolean(entry)))
}

// History verbs. They address no state — undo moves along the history line, where
// "where you are" is always now — so they carry no readback and are honestly
// mute. Availability still falls out of the dry run (an empty stack says no).
export function historyVerbs(): Verb[] {
  return fromCommands([
    { id: 'undo', label: 'Undo', icon: 'undo', command: undo, keys: ['Mod-z'], keywords: ['undo', 'history'], section: 'history' },
    { id: 'redo', label: 'Redo', icon: 'redo', command: redo, keys: ['Shift-Mod-z', 'Mod-y'], keywords: ['redo', 'history'], section: 'history' },
  ])
}

// ── The door, as a Command ───────────────────────────────────────────────────

/** Chrome's asker: returns the collected args, or null for a cancel. */
export type Collector = (verb: Verb, state: EditorState) => VerbArgs | null

/// One verb, through verbr's one checked door, as a ProseMirror Command — the
/// shape a keymap, a button and a console all already know how to call.
///
/// The dry run (no `dispatch`) answers availability and never collects. A real
/// run goes through `invoke`, so a chord cannot run what a button refuses. An
/// arg-verb summoned **without** args — by a chord, a palette row — asks the
/// collector on a real run, and a cancel no-ops honestly; without a collector it
/// is declared, not collectable, and refuses.
export function commandFor(
  register: Register<EditorState, Command>,
  id: string,
  { args, collect }: { args?: VerbArgs; collect?: Collector } = {},
): Command {
  return (state, dispatch, view) => {
    const verb = register.get(id)
    if (!verb) return false
    const asking = !!verb.args?.length && args === undefined
    if (asking && !collect) return false
    const ready = prepare(register, id, state, args)
    // Missing arguments are the collector's to supply, not a refusal.
    if (!ready.ok && !(asking && ready.code === 'args')) return false
    if (!dispatch) return true
    const given = asking ? collect!(verb, state) : args
    if (asking && given == null) return false
    const done = invoke(register, id, state, given ?? undefined)
    return done.ok ? done.value(state, dispatch, view) : false
  }
}

// ── The keyboard ─────────────────────────────────────────────────────────────

/** A policy layer: named, one key carrying a chain resolved by position. */
export interface PolicyLayer {
  name: string
  bindings: Record<string, Command>
}

/** One claim on a key, as describe/audit report it. */
export interface KeyClaim {
  layer: string
  verb?: string
  applies?: boolean
  wins?: boolean
}

/** The composed keyboard: ordered plugins plus its sight. */
export interface Keyboard {
  plugins: Plugin[]
  describe(key: string, state?: EditorState): KeyClaim[]
  audit(): { key: string; claims: KeyClaim[] }[]
}

// The verb layer of the keyboard: every verb's chords — read from the taste,
// where verbr keeps them — in one flat map. A chord claimed twice is a conflict
// the scattered form could never see; here it is one map, so we refuse it at
// build time. Arg-verbs bind only when a collector was supplied.
function verbChords(register: Register<EditorState, Command>, taste: Attributed, collect?: Collector) {
  const bindings: Record<string, Command> = {}
  const claimedBy: Record<string, string> = {}
  for (const verb of register.verbs) {
    const keys = taste.attrsOf(verb.id).keys
    if (keys === undefined) continue
    if (verb.args?.length && !collect) continue
    for (const key of ([] as unknown[]).concat(keys)) {
      if (typeof key !== 'string') continue
      if (claimedBy[key]) throw new Error(`Verbs: chord "${key}" is claimed by both "${claimedBy[key]}" and "${verb.id}"`)
      claimedBy[key] = verb.id
      bindings[key] = commandFor(register, verb.id, { collect })
    }
  }
  return { bindings, claimedBy }
}

// Projection → the verb keymap alone, for hosts that keep their other keymaps
// out of the composition.
export function toKeymap(register: Register<EditorState, Command>, taste: Attributed, { collect }: { collect?: Collector } = {}): Plugin {
  return keymap(verbChords(register, taste, collect).bindings)
}

// The composed keyboard. Named keys carry two kinds of binding: a chord summons
// one verb; a policy is one key carrying a chain resolved by position (Enter).
// The keyboard is a stack of such layers — the verb chords first, then the host's
// policies in the order given, the base keymap seated openly as the last of them.
// Cross-layer shadowing is the mechanism, not a conflict (a command that answers
// false falls through), so what the stack owes is not refusal but sight:
// `describe` answers, for any key, who claims it, in what order, and — given a
// state — who would take it right now. Its honest limit: it sees layers and
// claims, never inside an imported chainCommands.
export function composeKeyboard(
  register: Register<EditorState, Command>,
  taste: Attributed,
  policies: PolicyLayer[] = [],
  { collect }: { collect?: Collector } = {},
): Keyboard {
  const chords = verbChords(register, taste, collect)
  const layers: (PolicyLayer & { ids?: Record<string, string> })[] = [
    { name: 'verbs', bindings: chords.bindings, ids: chords.claimedBy },
    ...policies,
  ]
  return {
    plugins: layers.map((layer) => keymap(layer.bindings)),
    describe(key, state) {
      const claims: KeyClaim[] = []
      for (const layer of layers) {
        const command = layer.bindings[key]
        if (!command) continue
        const claim: KeyClaim = { layer: layer.name }
        if (layer.ids?.[key]) claim.verb = layer.ids[key]
        if (state) claim.applies = !!command(state)
        claims.push(claim)
      }
      if (state) {
        const winner = claims.find((claim) => claim.applies)
        if (winner) winner.wins = true
      }
      return claims
    },
    // The sweep to describe's probe: every key claimed by more than one layer,
    // claimants in court order. Reports for the host's eye, refusing nothing.
    audit() {
      const byKey = new Map<string, KeyClaim[]>()
      for (const layer of layers) {
        for (const key of Object.keys(layer.bindings)) {
          if (!byKey.has(key)) byKey.set(key, [])
          const claim: KeyClaim = { layer: layer.name }
          if (layer.ids?.[key]) claim.verb = layer.ids[key]
          byKey.get(key)!.push(claim)
        }
      }
      return [...byKey]
        .filter(([, claims]) => claims.length > 1)
        .map(([key, claims]) => ({ key, claims }))
    },
  }
}
