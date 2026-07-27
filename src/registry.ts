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

/** The entry contract. Extra properties are preserved, never refused. */
export interface VerbEntry {
  /** Unique across the composition — a collision is a build error. */
  id: string
  /** Human name (menu, palette, button title). */
  label: string
  /** A ProseMirror Command — or, iff `args` is declared, a factory (args) => Command. */
  command: Command | CommandFactory
  /** Compact toolbar face; a surface may curate by its absence. */
  short?: string
  /** The readback, if the verb addresses state: pure (state) => value. Booleans for toggles, a member value for one-of-N, a count for wraps. */
  read?: (state: EditorState) => unknown
  /** Availability for arg-verbs only, whose factory can't be dry-run without arguments. */
  enabled?: (state: EditorState) => boolean
  /** Chord(s) — duplicate chords within a composition are refused at build. */
  keys?: string[]
  /** Extra search terms for palette-grade consumers. */
  keywords?: string[]
  /** Present ⇒ `command` is a factory. */
  args?: VerbArg[]
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
          `Verbs: id "${entry.id}" is declared by both "${prior.label}" and "${entry.label}"`,
        )
      }
      claimedBy.set(entry.id, entry)
      verbs.push(normalize(entry))
    }
  }
  return verbs
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
      enabled: (state: EditorState) => !state.selection.empty,
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
            title: verb.label,
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
    return {
      id: verb.id,
      kind,
      label: verb.short!,
      title: verb.label,
      command: verb.args ? collectingCommand(verb, collect!) : verb.run(),
      ...(read ? { active: (state: EditorState) => !!read(state) } : {}),
      ...(verb.keys ? { keys: verb.keys } : {}),
    }
  }
  const arg = verb.args![0]!
  return {
    id: verb.id,
    kind,
    // A field wears the argument's own label — the very words a prompting
    // collector would have asked with.
    label: kind === 'field' ? arg.label : verb.label,
    title: verb.label,
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
  }
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
