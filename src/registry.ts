// prosemirror-verbs — the editor's verb-Schema.
//
// ProseMirror's Schema registers the document's nouns: nodes and marks, what the
// document is made of. This registers its verbs: commands, and how they are summoned.
//
// It is a declaration at the Schema's altitude, not a contribution the editor runs —
// admissible only by staying inert: data plus pure projections that compile to
// standard ProseMirror. It holds no runtime state and never reads or drives the
// editor. Verbs and how they are summoned, nothing else, live here.
//
// Its proving ground is pm-testing-venue, which hosts it as a specimen. It imports
// nothing from any host: it receives the schema as an argument and depends only
// on prosemirror-*.

import { keymap } from 'prosemirror-keymap'
import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
import { undo, redo } from 'prosemirror-history'
import { insertPoint } from 'prosemirror-transform'
import type { Command, EditorState, Plugin } from 'prosemirror-state'
import type { Attrs, MarkType, NodeType, Schema } from 'prosemirror-model'

// ── The entry contract ───────────────────────────────────────────────────────
//
// Structural, nothing to import at runtime. A plugin declares verbs by exporting
// plain objects of this shape; only the host, which projects, depends on this
// package (a TS plugin may `import type { VerbEntry }` — type-only, erased at
// build, so the zero-runtime-dependency claim holds). Dry runs and readbacks are
// called on every editor transaction by syncing consumers: they must be pure and
// cheap. Extra properties are preserved, never refused (the NodeSpec allowance —
// prosemirror-tables rides its `tableRole` on exactly this); consumers ignore
// what they don't know.

/** Values a collector gathers for an arg-verb, keyed by the arg's `name`. */
export type VerbArgs = Record<string, unknown>

/** One member of an enumerable domain (a block type, an alignment, …). */
export interface DomainMember {
  value: string
  label: string
  short?: string
  keys?: string[]
}

/** What a collector must ask for; `type` vocabulary is open until collectors exist. */
export interface VerbArg {
  name: string
  label: string
  type?: string
  domain?: DomainMember[]
}

/** An arg-verb's command: give it the collected args, it gives you the Command. */
export type CommandFactory = (args: VerbArgs) => Command

/// What a plugin declares: **what it can do, and what it can tell you.**
/// Nothing else. No name, no glyph, no chord, no category — a plugin does not
/// know it is being called a verb, and does not know a surface exists (Egildo's
/// ruling, 2026-07-28, amending V12: plugins ship *capabilities*, hosts ship
/// verbs and chrome). The cut is not arbitrary: only the plugin can know that a
/// formula lives on a `td` and not a `th`, and only the host can know what to
/// call it, where to put it, or which chord it answers to.
export interface Capability {
  /** Unique across the composition — a collision is a build error. */
  id: string
  /** A ProseMirror Command — or, iff `args` is declared, a factory (args) => Command. */
  command: Command | CommandFactory
  /** The readback, if the verb addresses state: pure (state) => value. Booleans for toggles, a member value for one-of-N, a count for wraps. */
  read?: (state: EditorState) => unknown
  /** Availability for arg-verbs only, whose factory can't be dry-run without arguments. */
  enabled?: (state: EditorState) => boolean
  /** Present ⇒ `command` is a factory. */
  args?: VerbArg[]
}

/// The keys a capability owns. Everything else on an entry is taste, and taste
/// is the host's — which is what lets the declaration itself be seated as one
/// layer among several (see `applyAttrs`), and what lets a layer be refused for
/// reaching past its share.
const CAPABILITY_KEYS = new Set(['id', 'command', 'read', 'enabled', 'args', 'run'])

/** The entry contract: a capability, plus whatever taste the declarer chose to
 * carry. Every taste field is optional — an entry may be a bare capability —
 * and extra properties are preserved, never refused. */
export interface VerbEntry extends Capability {
  /** Human name (menu, palette, button title). Absent ⇒ the naming layer derives one from the id. */
  label?: string
  /** Compact toolbar face; a surface may curate by its absence. */
  short?: string
  /** Chord(s) — duplicate chords within a composition are refused at build. */
  keys?: string[]
  /** Extra search terms for palette-grade consumers. */
  keywords?: string[]
  /** Category — surface curation handle. */
  group?: string
  /** Extra properties are preserved, never refused — the NodeSpec allowance. */
  [extra: string]: unknown
}

/** A composed (normalized) verb: every entry gains one uniform `run`. */
export interface Verb extends VerbEntry {
  run: (args?: VerbArgs) => Command
}

// The author writes the natural thing — a bare command, or (args) => command when it
// takes arguments. Normalization erases that fork at composition: every entry gains one
// uniform `run: (args) => Command`, so no projection branches on whether args exist.
// Invariant, stated once here: `args` declared ⟺ `command` is a factory.
function normalize(entry: VerbEntry): Verb {
  return {
    ...entry,
    run: entry.args ? (entry.command as Verb['run']) : () => entry.command as Command,
  }
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

// ── Composition ──────────────────────────────────────────────────────────────
//
// The host's single act, and the only place normalization happens. Plugins
// export raw entries (plain data, zero dependency); the host composes them
// once, here, where a duplicate id is a conflict one point can finally see —
// the same build-time refusal the keymap projection applies to chords.
export function composeVerbs(...sets: (VerbEntry | VerbEntry[])[]): Verb[] {
  const verbs: Verb[] = []
  const claimedBy = new Map<string, VerbEntry>()
  for (const set of sets) {
    for (const entry of ([] as VerbEntry[]).concat(set)) {
      const prior = claimedBy.get(entry.id)
      if (prior) {
        throw new Error(
          `Verbs: id "${entry.id}" is declared by both "${prior.label ?? prior.id}" and "${entry.label ?? entry.id}"`,
        )
      }
      claimedBy.set(entry.id, entry)
      verbs.push(normalize(entry))
    }
  }
  return verbs
}

// ── Attributes: the host's half, in layers ───────────────────────────────────
//
// Composition gathers capabilities (V10, above); attribution dresses them. The
// two are the host's two acts and they stay two, because they answer different
// questions: *what can this editor do* and *what shall we call it, where does it
// go, what does it answer to*. A venue writes them as two files.
//
// Layers resolve in order, later winning per key — and like the keyboard's stack
// of courts (V11), what a stack owes is not refusal but **sight**: `describe`
// answers, for any verb, which layer set which attribute and who won. The first
// time a control turns up somewhere you didn't put it, that is the instrument
// you will want, and it is the same instrument, pointed at attributes instead of
// keys.
//
// The bag is open on purpose. A surface may contribute a layer whose vocabulary
// this package never learns — `manner`, `room`, `priority`, whatever a renderer
// needs — under exactly the law the entry contract already carries: extra
// properties are preserved, never refused.

/** The taste half of a verb: everything a host decides. Open by construction. */
export interface VerbAttrs {
  label?: string
  short?: string
  keys?: string[]
  keywords?: string[]
  group?: string
  [attr: string]: unknown
}

/** One claim on one attribute, as `describe` reports it. */
export interface AttrClaim {
  layer: string
  key: string
  value: unknown
  wins?: boolean
}

/** A layer of taste over the register. `match` absent means every verb. */
export interface AttrLayer {
  name: string
  /** An exact id, a `prefix*` glob, `*`, or a predicate. Deliberately not CSS. */
  match?: string | ((verb: Verb) => boolean)
  /** A bag, or a function of the verb — which is how a derived layer (room from
   * the args' shape, say) is expressed without this package knowing what room is. */
  attrs: VerbAttrs | ((verb: Verb) => VerbAttrs)
}

/** The attributed register, plus its sight. */
export interface Attributed {
  verbs: Verb[]
  /** Every claim on this verb, in court order, the winner per key marked. */
  describe(id: string): AttrClaim[]
  /** The sweep: every (verb, key) more than one layer claimed. Reports, refuses nothing. */
  audit(): { id: string; key: string; claims: AttrClaim[] }[]
}

/// A label from an id, for a register nobody has named yet: the namespace falls
/// away (a table strip whose every button began "Table…" would be noise), the
/// separators become spaces, the first letter rises. `table:add-row-after` reads
/// "Add row after". This is what keeps install-and-go true under the split — a
/// host that writes no attributes at all still gets a usable editor.
export function humanizeId(id: string): string {
  const local = id.slice(id.lastIndexOf(':') + 1)
  const words = local.split(/[-_]/).filter(Boolean).join(' ')
  return words ? words[0]!.toUpperCase() + words.slice(1) : id
}

/// The default naming layer, seated first by `applyAttrs` so it is overridable
/// by anything and visible in `describe` — a default in a layer, not a fallback
/// buried in code.
export const namingLayer: AttrLayer = {
  name: 'naming',
  attrs: (verb) => ({ label: humanizeId(verb.id) }),
}

function matches(layer: AttrLayer, verb: Verb): boolean {
  const match = layer.match
  if (match == null || match === '*') return true
  if (typeof match === 'function') return match(verb)
  return match.endsWith('*') ? verb.id.startsWith(match.slice(0, -1)) : verb.id === match
}

// The declaration is a layer too — seated after the naming default and before
// every host layer, so a plugin that still carries taste (as all of them do
// today) simply loses to the host that disagrees. When plugins shed their taste
// entirely, this layer goes quietly empty and nothing else changes.
function declaredTaste(verb: Verb): VerbAttrs {
  const attrs: VerbAttrs = {}
  for (const key of Object.keys(verb)) if (!CAPABILITY_KEYS.has(key)) attrs[key] = verb[key]
  return attrs
}

/// Dress a composed register. Layers apply in order, later winning per key;
/// the naming default is seated first and the declaration's own taste second.
/// A layer that reaches for a capability key is refused at build time — the
/// same posture composition takes to a duplicate id, and for the same reason:
/// taste may rename a verb, never redefine what it does.
export function applyAttrs(verbs: Verb[], layers: AttrLayer[] = []): Attributed {
  const claims = new Map<string, AttrClaim[]>()

  const dressed = verbs.map((verb) => {
    const stack: AttrLayer[] = [
      namingLayer,
      { name: 'declaration', attrs: declaredTaste(verb) },
      ...layers,
    ]
    const resolved: Record<string, unknown> = {}
    const mine: AttrClaim[] = []
    for (const layer of stack) {
      // A layer sees the verb *as resolved so far*, not as declared — so a
      // later layer can match on what an earlier one decided ("everything
      // unbounded goes docked"). That is what makes these layers and not a
      // pile of independent patches, and it is why the order is reportable.
      const current = { ...verb, ...resolved } as Verb
      if (!matches(layer, current)) continue
      const attrs = typeof layer.attrs === 'function' ? layer.attrs(current) : layer.attrs
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined) continue
        if (CAPABILITY_KEYS.has(key)) {
          throw new Error(
            `Verbs: layer "${layer.name}" may not set "${key}" on "${verb.id}" — that is the capability's, not taste's`,
          )
        }
        resolved[key] = value
        mine.push({ layer: layer.name, key, value })
      }
    }
    const winners = new Map<string, AttrClaim>()
    for (const claim of mine) winners.set(claim.key, claim)
    for (const claim of winners.values()) claim.wins = true
    claims.set(verb.id, mine)
    return { ...verb, ...resolved } as Verb
  })

  return {
    verbs: dressed,
    describe: (id) => claims.get(id) ?? [],
    audit() {
      const contested: { id: string; key: string; claims: AttrClaim[] }[] = []
      for (const [id, all] of claims) {
        const byKey = new Map<string, AttrClaim[]>()
        for (const claim of all) {
          if (!byKey.has(claim.key)) byKey.set(claim.key, [])
          byKey.get(claim.key)!.push(claim)
        }
        for (const [key, group] of byKey) if (group.length > 1) contested.push({ id, key, claims: group })
      }
      return contested
    },
  }
}

// ── Starter sets ─────────────────────────────────────────────────────────────

// The package's default verbs — marks basics, the way prosemirror-schema-basic
// ships a starter set of nodes and marks. A host may write its own entries
// instead. A mark's readback is boolean: membership in the mark set is the
// whole domain. Every set guards its nouns: entries whose types are absent
// from the schema are not returned.
export function basicVerbs(schema: Schema): VerbEntry[] {
  const entries: (VerbEntry | undefined)[] = [
    schema.marks.strong && {
      id: 'strong',
      label: 'Bold',
      short: 'B',
      command: toggleMark(schema.marks.strong),
      read: (state: EditorState) => markActive(state, schema.marks.strong),
      keys: ['Mod-b'],
      keywords: ['bold', 'strong'],
      group: 'marks',
    },
    schema.marks.em && {
      id: 'em',
      label: 'Italic',
      short: 'I',
      command: toggleMark(schema.marks.em),
      read: (state: EditorState) => markActive(state, schema.marks.em),
      keys: ['Mod-i'],
      keywords: ['italic', 'emphasis'],
      group: 'marks',
    },
    schema.marks.code && {
      id: 'code',
      label: 'Code',
      short: '</>',
      command: toggleMark(schema.marks.code),
      read: (state: EditorState) => markActive(state, schema.marks.code),
      keys: ['Mod-`'],
      keywords: ['code', 'monospace'],
      group: 'marks',
    },
    // A verb that takes an argument: its `command` is a factory (args ⟹ factory);
    // `enabled` is explicit because a factory can't be dry-run without its arguments.
    schema.marks.link && {
      id: 'link',
      label: 'Link',
      short: '🔗',
      command: (args: VerbArgs) => toggleMark(schema.marks.link, { href: args.href as string }),
      args: [{ name: 'href', label: 'URL', type: 'url' }],
      // The command's own dry run, not a hand-written guess at it. "Not empty"
      // was wider than the truth: a NodeSelection on an atom that carries no
      // marks is not empty either, so the URL field turned up over a
      // spreadsheet cell. Dimming hid that; hiding made every loose gate
      // visible at once (venue finding, 2026-07-28) — and the rule from
      // yesterday applies again: a gate must not be wider than the command.
      enabled: (state: EditorState) => toggleMark(schema.marks.link)(state),
      // The readback is the href you stand in — a value domain. It lights the
      // toolbar face inside a link, and a collector prefills from it. A range
      // reads forward ($from.marks() at a link's start boundary would read the
      // unlinked character before it).
      read: (state: EditorState) => {
        const { $from, empty } = state.selection
        const marks = empty
          ? state.storedMarks || $from.marks()
          : ($from.nodeAfter?.marks ?? $from.marks())
        return schema.marks.link.isInSet(marks)?.attrs.href ?? null
      },
      keys: ['Mod-k'],
      keywords: ['link', 'url', 'href'],
      group: 'marks',
    },
  ]
  return entries.filter((entry): entry is VerbEntry => Boolean(entry))
}

interface BlocktypeMember extends DomainMember {
  type: NodeType
  attrs: Attrs | null
}

// One verb, one enumerable domain. Block type is not seven verbs — it is one
// verb over the domain of textblock markups the schema offers. Domain members
// are data ({ value, label, short?, keys? }); the mapping from value to markup
// stays in this closure. `read` is the verb's readback: which member is current.
// Members past H3 carry chords but no compact face — curation by omission, the
// same mechanism every surface already uses.
export function blocktypeVerb(schema: Schema): VerbEntry {
  const candidates: (BlocktypeMember | undefined)[] = [
    schema.nodes.paragraph && {
      value: 'paragraph',
      label: 'Paragraph',
      short: '¶',
      keys: ['Shift-Mod-0'],
      type: schema.nodes.paragraph,
      attrs: null,
    },
    ...[1, 2, 3, 4, 5, 6].map(
      (level) =>
        schema.nodes.heading && {
          value: `h${level}`,
          label: `Heading ${level}`,
          ...(level <= 3 ? { short: `H${level}` } : {}),
          keys: [`Shift-Mod-${level}`],
          type: schema.nodes.heading,
          attrs: { level },
        },
    ),
    schema.nodes.code_block && {
      value: 'code_block',
      label: 'Code block',
      short: '⌨',
      keys: ['Shift-Mod-\\'],
      type: schema.nodes.code_block,
      attrs: null,
    },
  ]
  const members = candidates.filter((member): member is BlocktypeMember => Boolean(member))

  const byValue = new Map(members.map((member) => [member.value, member]))

  return {
    id: 'blocktype',
    label: 'Block type',
    group: 'blocktype',
    command: (args: VerbArgs) => {
      const member = byValue.get(args.blocktype as string)
      return member ? setBlockType(member.type, member.attrs ?? undefined) : () => false
    },
    args: [
      {
        name: 'blocktype',
        label: 'Block type',
        type: 'member',
        domain: members.map(({ value, label, short, keys }) => ({ value, label, short, keys })),
      },
    ],
    read: (state: EditorState) =>
      members.find((member) => markupActive(state, member.type, member.attrs))?.value ?? null,
    keywords: ['paragraph', 'heading', 'title', 'code', 'block'],
  }
}

// Projection → conjugated forms. A verb over an enumerable domain, curried into
// one no-arg verb per member: each form takes the member's face and chords, and
// its readback is derived from the verb's own — boolean, current member ⟺ true.
// The forms are ordinary raw entries — composed, keymapped, and shown like any
// other; the invariant (args ⟺ factory) is what lets `command` be called here.
export function expand(verb: VerbEntry): VerbEntry[] {
  const arg = verb.args?.[0]
  if (!arg?.domain) return []
  const read = verb.read
  return arg.domain.map((member) => ({
    id: `${verb.id}:${member.value}`,
    label: member.label,
    short: member.short,
    command: (verb.command as CommandFactory)({ [arg.name]: member.value }),
    ...(read ? { read: (state: EditorState) => read(state) === member.value } : {}),
    keys: member.keys,
    keywords: verb.keywords,
    group: verb.group,
  }))
}

// Wrap verbs. The state a wrap addresses is depth — a count along the ancestor
// path — so the readback reads the natural number; a surface renders it as it
// likes (the toolbar lights on truthiness). No toggle-back: whether re-pressing
// should lift is the open default-member question, not decided by this file.
export function wrapVerbs(schema: Schema): VerbEntry[] {
  const entries: (VerbEntry | undefined)[] = [
    schema.nodes.blockquote && {
      id: 'blockquote',
      label: 'Quote',
      short: '❝',
      command: wrapIn(schema.nodes.blockquote),
      read: (state: EditorState) => wrapDepth(state, schema.nodes.blockquote),
      keys: ['Mod->'],
      keywords: ['quote', 'blockquote'],
      group: 'wraps',
    },
    schema.nodes.bullet_list && {
      id: 'bullet_list',
      label: 'Bullet list',
      short: '•',
      command: wrapInList(schema.nodes.bullet_list),
      read: (state: EditorState) => wrapDepth(state, schema.nodes.bullet_list),
      keys: ['Shift-Mod-8'],
      keywords: ['list', 'bullet', 'unordered'],
      group: 'wraps',
    },
    schema.nodes.ordered_list && {
      id: 'ordered_list',
      label: 'Ordered list',
      short: '1.',
      command: wrapInList(schema.nodes.ordered_list),
      read: (state: EditorState) => wrapDepth(state, schema.nodes.ordered_list),
      keys: ['Shift-Mod-9'],
      keywords: ['list', 'ordered', 'numbered'],
      group: 'wraps',
    },
  ]
  return entries.filter((entry): entry is VerbEntry => Boolean(entry))
}

// History verbs. They address no state — undo moves along the history line, where
// "where you are" is always now — so they carry no readback and are honestly
// mute. Availability still falls out of the dry run (an empty stack says no).
export function historyVerbs(): VerbEntry[] {
  return [
    {
      id: 'undo',
      label: 'Undo',
      short: '↶',
      command: undo,
      keys: ['Mod-z'],
      keywords: ['undo', 'history'],
      group: 'history',
    },
    {
      id: 'redo',
      label: 'Redo',
      short: '↷',
      command: redo,
      keys: ['Shift-Mod-z', 'Mod-y'],
      keywords: ['redo', 'history'],
      group: 'history',
    },
  ]
}

// ── Collection (the sync half) ───────────────────────────────────────────────

/** Chrome's asker: returns the collected args, or null for a cancel. */
export type Collector = (verb: Verb, state: EditorState) => VerbArgs | null

// An arg-verb is wrapped in a self-prompting command, dispatch-guarded: the dry
// run answers availability without ever collecting — describe and every syncing
// surface depend on that — and only a real run asks. `collect(verb, state)` is
// chrome, supplied by the host: it returns the args object, or null for a
// cancel, which no-ops honestly. The async half (collect first, then dispatch)
// belongs to surfaces that cannot ask inside a command.
export function collectingCommand(verb: Verb, collect: Collector): Command {
  return (state, dispatch, view) => {
    if (!(verb.enabled ? verb.enabled(state) : true)) return false
    if (!dispatch) return true
    const args = collect(verb, state)
    return args == null ? false : verb.run(args)(state, dispatch, view)
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

// The verb layer of the keyboard: every entry's chords, one flat map. A chord
// claimed twice is a conflict the scattered form could never see; here it is one
// map, so we refuse it at build time — refusal within a layer is the law (across
// layers, ordering is; see composeKeyboard). With a collector supplied, arg-verbs
// bind their chords through collectingCommand; without one they stay declared,
// not collected, and their chords are skipped.
function verbChords(verbs: Verb[], collect?: Collector) {
  const bindings: Record<string, Command> = {}
  const claimedBy: Record<string, string> = {}
  for (const verb of verbs) {
    if (!verb.keys) continue
    if (verb.args && !collect) continue
    for (const key of verb.keys) {
      if (claimedBy[key]) {
        throw new Error(
          `Verbs: chord "${key}" is claimed by both "${claimedBy[key]}" and "${verb.id}"`,
        )
      }
      claimedBy[key] = verb.id
      bindings[key] = verb.args ? collectingCommand(verb, collect!) : verb.run()
    }
  }
  return { bindings, claimedBy }
}

// Projection → the verb keymap alone, for hosts that keep their other keymaps
// out of the composition.
export function toKeymap(verbs: Verb[], { collect }: { collect?: Collector } = {}): Plugin {
  return keymap(verbChords(verbs, collect).bindings)
}

// The composed keyboard. Named keys carry two kinds of binding: a chord summons
// one verb; a policy is one key carrying a chain resolved by position (Enter).
// The keyboard is a stack of such layers — the verb chords first, then the host's
// policies in the order given, the base keymap seated openly as the last of them,
// an imported policy like any other. Cross-layer shadowing is the mechanism, not
// a conflict (a command that answers false falls through), so what the stack owes
// is not refusal but sight: `describe` answers, for any key, who claims it, in
// what order, and — given a state — who would take it right now. Its honest
// limit: it sees layers and claims, never inside an imported chainCommands.
// Inert, compiles to ordered standard keymap plugins, inverts no control.
export function composeKeyboard(
  verbs: Verb[],
  policies: PolicyLayer[] = [],
  { collect }: { collect?: Collector } = {},
): Keyboard {
  const chords = verbChords(verbs, collect)
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
    // claimants in court order. Cross-layer shadowing is the mechanism, not a
    // conflict — so this reports for the host's eye, refusing nothing.
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

// Chords for humans. Pure string work — the platform is the caller's conf, so the
// registry stays free of the DOM (a surface passes { mac } from where it stands).
// Modifiers print in each platform's conventional order (⌃⌥⇧⌘ / Ctrl+Alt+Shift),
// whatever order the chord declares them in.
const MAC_MODS: Record<string, string> = {
  Mod: '⌘', Cmd: '⌘', Meta: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Control: '⌃',
}
const MOD_ORDER: Record<string, number> = {
  Ctrl: 0, Control: 0, Alt: 1, Shift: 2, Mod: 3, Cmd: 3, Meta: 3,
}
export function formatKeys(key: string, { mac = false }: { mac?: boolean } = {}): string {
  const parts = key.split('-')
  const base = parts.pop()!
  const label = base.length === 1 ? base.toUpperCase() : base
  if (mac) {
    const mods = [...parts].sort((a, b) => (MOD_ORDER[a] ?? 9) - (MOD_ORDER[b] ?? 9))
    return mods.map((mod) => MAC_MODS[mod] ?? mod).join('') + label
  }
  const mods = parts
    .map((mod) => (mod === 'Mod' ? 'Ctrl' : mod))
    .sort((a, b) => (MOD_ORDER[a] ?? 9) - (MOD_ORDER[b] ?? 9))
  return [...mods, label].join('+')
}

// ── Toolbar projection ───────────────────────────────────────────────────────

/** What a toolbar-grade surface eats: one button, or a section separator. */
export interface ToolbarSpec {
  id: string
  label: string
  title: string
  command: Command
  active?: (state: EditorState) => boolean
  keys?: string[]
}
export type ToolbarItem = ToolbarSpec | { separator: true }

// Projection → toolbar specs. The toolbar element already eats exactly this shape,
// so the projection is a reshape and nothing more. Arg-verbs join only when the
// host supplies a collector — their button runs the collecting command; without
// one they stay declared, not collected, and are skipped.
// `groups` is the surface's curation, in order; sections meet at a separator marker.
export function toolbarSpecs(
  verbs: Verb[],
  groups: string | string[],
  { collect }: { collect?: Collector } = {},
): ToolbarItem[] {
  const sections = (Array.isArray(groups) ? groups : [groups])
    .map((group) =>
      verbs
        .filter((verb) => verb.group === group && verb.short && (!verb.args || collect))
        .map((verb): ToolbarSpec => {
          const read = verb.read
          return {
            id: verb.id,
            label: verb.short!,
            title: verb.label ?? humanizeId(verb.id),
            command: verb.args ? collectingCommand(verb, collect!) : verb.run(),
            // The element's `active` is this surface's native rendering of any
            // readback domain: lit on truthy (a boolean directly, a count > 0).
            active: read ? (state) => !!read(state) : undefined,
            keys: verb.keys,
          }
        }),
    )
    .filter((section) => section.length)
  return sections.flatMap((section, i): ToolbarItem[] =>
    i ? [{ separator: true }, ...section] : section,
  )
}

// ── Control projection ───────────────────────────────────────────────────────
//
// The toolbar projection above is lossy in one deliberate place: `active` calls
// the readback and throws its domain away — `"=SUM(Prezzo)"`, `"Prezzo"` and
// `96` all arrive at a surface as `true`. That is honest for a strip of buttons,
// which can only light or not light, and it is all a button surface can use.
//
// This projection keeps the domain. It reads the *shape* of a declaration and
// names the control that fits it — nothing new is declared, the fork was always
// in the data:
//
//   no args                              → button   (the face is `short`)
//   one arg carrying a domain            → select   (`expand` is the other, equally
//                                                    valid rendering of the same thing)
//   one arg, no domain, a value readback → field    (show the value, edit it, commit)
//   several args                         → button, collected modally as before
//
// A field needs no Collector: the control *is* the collector, and asking is
// what a field replaces. `command` stays dry-runnable on every kind, so one
// uniform probe still answers availability; for a field or a select it is also
// the modal fallback for a chord or a palette, which have no control to read.

/** What a control-grade surface eats: one control, or a section separator. */
export interface ControlSpec {
  /** Unique within the strip. */
  id: string
  /** How to draw it. A button-only surface may render every kind as a button. */
  kind: 'button' | 'field' | 'select'
  /** The face: a button's glyph, a field's tag, a select's accessible name. */
  label: string
  /** The human name, for a tooltip. */
  title: string
  /** Dry-runnable availability — and, for a button, what a click runs. */
  command: Command
  /** Lit-ness, for kinds that light. Buttons only. */
  active?: (state: EditorState) => boolean
  /** The readback, uncollapsed: what a field shows, which member a select holds. */
  value?: (state: EditorState) => unknown
  /** Commit: hand it what the control holds, it hands back the Command. */
  write?: (value: unknown) => Command
  /** A select's members. */
  options?: DomainMember[]
  /** The arg's declared type — a field's input type. */
  type?: string
  keys?: string[]
  /** Curation handle, carried through rather than dissolved into separators. */
  group?: string
  /** Whatever a surface layer wrote — `room`, `manner`, `priority`, … */
  [attr: string]: unknown
}
export type ControlItem = ControlSpec | { separator: true }

// The shape reading, alone. `null` means "this verb has no control here" — the
// same curation-by-omission the toolbar projection applies through `short`.
function controlKind(verb: Verb): ControlSpec['kind'] | null {
  if (!verb.args) return verb.short ? 'button' : null
  if (verb.args.length === 1 && verb.args[0]!.domain) return 'select'
  if (verb.args.length === 1 && verb.read) return 'field'
  return verb.short ? 'button' : null
}

function toControl(verb: Verb, collect?: Collector): ControlSpec | null {
  const kind = controlKind(verb)
  if (!kind) return null
  const read = verb.read
  if (kind === 'button') {
    // Multi-arg buttons still need someone to ask; without a collector they
    // stay declared, not collected — the toolbar projection's own rule.
    if (verb.args && !collect) return null
    return passthrough(verb, {
      id: verb.id,
      kind,
      label: verb.short!,
      title: verb.label ?? humanizeId(verb.id),
      command: verb.args ? collectingCommand(verb, collect!) : verb.run(),
      ...(read ? { active: (state: EditorState) => !!read(state) } : {}),
      ...(verb.keys ? { keys: verb.keys } : {}),
    })
  }
  const arg = verb.args![0]!
  return passthrough(verb, {
    id: verb.id,
    kind,
    // A field wears the argument's own label — the very words a prompting
    // collector would have asked with.
    label: kind === 'field' ? arg.label : verb.label ?? humanizeId(verb.id),
    title: verb.label ?? humanizeId(verb.id),
    // Availability without collecting: a factory cannot be dry-run, so the
    // gate is the verb's own. With a collector, a real run still asks —
    // that is what a chord or a palette needs, having no control to read.
    command: (state, dispatch, view) => {
      if (!(verb.enabled ? verb.enabled(state) : true)) return false
      if (!dispatch) return true
      return collect ? collectingCommand(verb, collect)(state, dispatch, view) : false
    },
    ...(read ? { value: read } : {}),
    write: (value: unknown) => verb.run({ [arg.name]: value }),
    ...(kind === 'select' ? { options: arg.domain } : {}),
    ...(arg.type ? { type: arg.type } : {}),
    ...(verb.keys ? { keys: verb.keys } : {}),
  })
}

// The spec is an open bag too, and for the same reason the entry is: a surface
// layer may have written `room`, `manner`, `priority`, `unavailable` — words
// this package has never heard and has no business dropping on the floor
// between the verb that carries them and the element that acts on them. What
// the projection has already decided for itself stands; everything else rides.
const SPEC_OWNED = new Set(['label', 'short', 'keys', 'keywords'])
function passthrough(verb: Verb, spec: ControlSpec): ControlSpec {
  const out: Record<string, unknown> = { ...spec }
  for (const key of Object.keys(verb)) {
    if (CAPABILITY_KEYS.has(key) || SPEC_OWNED.has(key) || key in out) continue
    out[key] = verb[key]
  }
  return out as ControlSpec
}

/// Projection → control specs. `groups` is the surface's curation, in order;
/// sections meet at a separator marker — the toolbar projection's arrangement,
/// over a richer per-verb shape.
export function controlSpecs(
  verbs: Verb[],
  groups: string | string[],
  { collect }: { collect?: Collector } = {},
): ControlItem[] {
  const sections = (Array.isArray(groups) ? groups : [groups])
    .map((group) =>
      verbs
        .filter((verb) => verb.group === group)
        .map((verb) => toControl(verb, collect))
        .filter((spec): spec is ControlSpec => spec !== null),
    )
    .filter((section) => section.length)
  return sections.flatMap((section, i): ControlItem[] =>
    i ? [{ separator: true }, ...section] : section,
  )
}

// ── Derived verbs ────────────────────────────────────────────────────────────

// A capability, not a declaration: insert a fresh node of `type`, wherever the schema
// allows one near the cursor. `insertPoint` is ProseMirror's own "can this node go
// here" query — the noun-equivalent of a command's dry run. Called without dispatch it
// answers availability (position-aware); called with dispatch it inserts.
const insertNode = (type: NodeType, attrs?: Attrs): Command => (state, dispatch) => {
  const point = insertPoint(state.doc, state.selection.from, type)
  if (point == null) return false
  const node = type.createAndFill(attrs)
  if (!node) return false
  if (dispatch) dispatch(state.tr.insert(point, node).scrollIntoView())
  return true
}

// A node's required attributes (those its spec gives no default) become an arg-schema —
// the schema's own requirements, read back as what a collector must ask for.
const requiredArgs = (type: NodeType): VerbArg[] =>
  Object.entries(type.spec.attrs || {})
    .filter(([, attr]) => !('default' in attr))
    .map(([name]) => ({ name, label: name, type: 'text' }))

// Derivation → verbs from the noun-Schema. One insert-verb per node type: the
// possibility engine pointed at nouns rather than at commands. Every entry's command
// consults insertPoint, so availability is position-aware and needs no separate
// `enabled`. A node with required attrs (image → src) becomes an arg-insert — declared
// with its derived arg-schema, skipped by surfaces exactly like link, until a collector
// exists. `doc` and text are not insertable-node candidates and are left out.
export function insertVerbs(schema: Schema): VerbEntry[] {
  return Object.values(schema.nodes)
    .filter((type) => type !== schema.topNodeType && !type.isText)
    .map((type) => {
      const req = requiredArgs(type)
      return {
        id: `insert:${type.name}`,
        label: `Insert ${type.name.replace(/_/g, ' ')}`,
        group: 'insert',
        ...(req.length
          ? { command: (args: VerbArgs) => insertNode(type, args as Attrs), args: req }
          : { command: insertNode(type) }),
      }
    })
}
