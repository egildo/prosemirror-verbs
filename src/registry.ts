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
import { setBlockType, wrapIn } from 'prosemirror-commands'
import { wrapInList } from 'prosemirror-schema-list'
import { undo, redo } from 'prosemirror-history'
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

/** One member of an enumerable domain (a block type, an alignment, …). The
 * `value` is the capability — the domain is what the verb accepts; everything
 * else is taste, so a member may be bare and be dressed by the cascade (the
 * conjugated forms `expand` produces are ordinary entries with ordinary ids). */
export interface DomainMember {
  value: string
  label?: string
  short?: string
  keys?: string[]
}

/** What a collector must ask for; `type` vocabulary is open until collectors
 * exist. `label` is taste and therefore optional — a field falls back to the
 * verb's own label (which the cascade governs), a prompting collector to the
 * humanized arg name. */
export interface VerbArg {
  name: string
  label?: string
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
/// reaching past its share. Exported across the package, not through `index`:
/// the projections must know what *not* to pass through to a surface.
export const CAPABILITY_KEYS = new Set(['id', 'command', 'read', 'enabled', 'args', 'run'])

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

// ── Starter sets, declared ───────────────────────────────────────────────────
//
// Hand-written entries, the way prosemirror-schema-basic ships a starter set of
// nodes and marks; a host may write its own instead. The sets that are *derived*
// from the schema rather than declared — marks, inserts — live in derive.ts.
// Every set guards its nouns: entries whose types are absent from the schema
// given are not returned.

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
    command: (verb.command as CommandFactory)({ [arg.name]: member.value }),
    ...(read ? { read: (state: EditorState) => read(state) === member.value } : {}),
    // Taste rides only where it was declared. A bare member yields a bare
    // capability with an ordinary id, which the cascade then names like any
    // other — so a plugin that ships no taste still expands cleanly.
    ...(member.label ? { label: member.label } : {}),
    ...(member.short ? { short: member.short } : {}),
    ...(member.keys ? { keys: member.keys } : {}),
    ...(verb.keywords ? { keywords: verb.keywords } : {}),
    ...(verb.group ? { group: verb.group } : {}),
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
