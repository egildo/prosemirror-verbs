// Projections — the register rendered into what a consumer eats.
//
// V8: every consumer projects the one list into its native representation. This
// file holds the three that exist, in order of how much they keep:
//
//   toolbarSpecs — buttons. Collapses every readback to lit / not lit.
//   controlTree  — the register with its **structure**: groups, nested, in order.
//   controlSpecs — a flat strip. Now a *view* of the tree, not a separate answer.
//
// The last line is the point of this file existing. Grouping used to be
// destroyed at projection time — flattened into `{separator: true}` markers
// before any consumer could see it — so a surface that wanted dropdowns,
// headings or navigable pages had nothing to work with. Those are not three
// features; they are four layouts of one tree, and the tree is built here.
//
// Which group a verb sits in is taste, and stays an attribute in the cascade
// (V13). What the sections *are* — their names, faces and nesting — is the
// projection's parameter, which it has always taken. Two seats: taste about a
// verb in the cascade, taste about a section in the section list (V14).

import type { Command, EditorState } from 'prosemirror-state'
import {
  CAPABILITY_KEYS,
  collectingCommand,
  humanizeId,
} from './registry.js'
import type { Collector, DomainMember, Verb } from './registry.js'
import { relations } from './relations.js'

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
  groups: GroupList,
  { collect }: { collect?: Collector } = {},
): ToolbarItem[] {
  const sections = groupIds(groups)
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
    // A field wears the argument's own label where one was declared — the very
    // words a prompting collector would have asked with — and otherwise the
    // verb's, which is the cascade's and so the host's. That fallback is what
    // lets a host name a field at all: `args` is a capability key, closed to
    // layers, so a label buried in it would be the one piece of taste no
    // attribute could reach.
    label: (kind === 'field' ? arg.label : undefined) ?? verb.label ?? humanizeId(verb.id),
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

// ── The section list ─────────────────────────────────────────────────────────

/// One section of chrome: its id (what a verb's `group` attribute points at),
/// what to call it, the face a collapsed rendering wears, and — for nesting —
/// whose child it is.
///
/// **No ordering field.** Array position is the order. VS Code needs
/// `"navigation@1"` because its contributions arrive from manifests it cannot
/// order; a host writing one array has no such problem, which is V10's
/// refusal-is-a-luxury-of-composition showing up in a third place.
export interface GroupSpec {
  id: string
  /** Absent ⇒ derived from the id, the way a verb's label is. */
  label?: string
  /** The face a collapsed rendering wears — a dropdown's button, a page's icon. */
  short?: string
  /** Absent ⇒ derived from a `/` path in the id, if there is one. */
  parent?: string
}

/** What the projections take as their curation: an id, ids in order, or specs. */
export type GroupList = string | string[] | GroupSpec[]

const asSpecs = (groups: GroupList): GroupSpec[] =>
  (Array.isArray(groups) ? groups : [groups]).map((group) =>
    typeof group === 'string' ? { id: group } : group,
  )

const groupIds = (groups: GroupList): string[] => asSpecs(groups).map((group) => group.id)

// A section's name, when nobody wrote one. Verb ids are namespaced with `:` and
// section ids nest with `/`, so this is `humanizeId`'s sibling rather than a
// second implementation of it: take the last segment, then let it do the words.
const groupLabel = (spec: GroupSpec): string =>
  spec.label ?? humanizeId(spec.id.slice(spec.id.lastIndexOf('/') + 1))

// ── The tree ─────────────────────────────────────────────────────────────────

/** A section, holding controls and possibly further sections. */
export interface ControlGroup {
  group: string
  label: string
  short?: string
  items: TreeItem[]
}
export type TreeItem = ControlSpec | ControlGroup

/** A base verb rendered *and* its conjugated forms rendered — a host that
 *  forgot to curate one of the two equally valid renderings of one declaration. */
export interface ControlConflict {
  base: string
  forms: string[]
}

/** The tree, plus its sight. */
export interface ControlTree {
  items: TreeItem[]
  /** Every base verb drawn alongside its own forms. Reports, refuses nothing. */
  audit(): ControlConflict[]
}

export const isGroup = (item: TreeItem): item is ControlGroup => 'items' in item

/// Projection → the register with its structure kept. Sections come from the
/// list, in the order given; nesting from a section's `parent`, or from a `/`
/// path in its id when it declares none. A section with nothing in it — and no
/// child that has anything — does not appear, which is what makes hiding-by-
/// availability generalise from separators to whole groups.
///
/// Only *declared* sections appear. That is the same curation-by-omission the
/// flat projection has always applied: a verb whose group nobody asked for is
/// in the register, reachable by chord and by palette, and simply has no seat
/// in this chrome.
export function controlTree(
  verbs: Verb[],
  groups: GroupList,
  { collect }: { collect?: Collector } = {},
): ControlTree {
  const specs = asSpecs(groups)
  const declared = new Set(specs.map((spec) => spec.id))
  const parentOf = (spec: GroupSpec): string | undefined => {
    if (spec.parent) return declared.has(spec.parent) ? spec.parent : undefined
    const cut = spec.id.lastIndexOf('/')
    if (cut < 0) return undefined
    const path = spec.id.slice(0, cut)
    // A path whose parent nobody declared is a root, not a dropped section:
    // losing a control because a section name had a slash in it would be the
    // worst kind of silent curation.
    return declared.has(path) ? path : undefined
  }

  const built = new Map<string, ControlGroup>()
  for (const spec of specs) {
    built.set(spec.id, {
      group: spec.id,
      label: groupLabel(spec),
      ...(spec.short ? { short: spec.short } : {}),
      items: verbs
        .filter((verb) => verb.group === spec.id)
        .map((verb) => toControl(verb, collect))
        .filter((control): control is ControlSpec => control !== null),
    })
  }

  // Children join their parents in declaration order; roots stay in it too.
  const roots: ControlGroup[] = []
  for (const spec of specs) {
    const group = built.get(spec.id)!
    const parent = parentOf(spec)
    if (parent && parent !== spec.id) built.get(parent)!.items.push(group)
    else roots.push(group)
  }

  const hasContent = (group: ControlGroup): boolean =>
    group.items.some((item) => (isGroup(item) ? hasContent(item) : true))
  const prune = (group: ControlGroup): ControlGroup => ({
    ...group,
    items: group.items.filter((item) => !isGroup(item) || hasContent(item)).map((item) => (isGroup(item) ? prune(item) : item)),
  })

  const items = roots.filter(hasContent).map(prune)

  return {
    items,
    // The condition worth reporting, and the reason this sits here rather than
    // on `relations`: it is a question about what got *drawn*, not about what
    // is true. A domain verb and its `expand`ed forms are two equally valid
    // renderings of one declaration — a select, or a row of radio buttons — and
    // showing both is a host forgetting to choose. The venue avoids it by hand
    // in its curation layer today, and nothing would have said so.
    audit() {
      const drawn = new Set<string>()
      const walk = (list: TreeItem[]) => {
        for (const item of list) isGroup(item) ? walk(item.items) : drawn.add(item.id)
      }
      walk(items)
      const conflicts: ControlConflict[] = []
      for (const { base, form } of relations(verbs).edges) {
        if (!drawn.has(base) || !drawn.has(form)) continue
        const found = conflicts.find((conflict) => conflict.base === base)
        if (found) found.forms.push(form)
        else conflicts.push({ base, forms: [form] })
      }
      return conflicts
    },
  }
}

/// Projection → a flat strip: the tree walked depth-first, with a separator
/// between top-level sections. This is the arrangement the toolbar projection
/// has always produced, and it is now what it always was underneath — **one
/// layout among several**, rather than the only answer the projection could
/// give. Nothing a surface eats changed shape.
export function controlSpecs(
  verbs: Verb[],
  groups: GroupList,
  { collect }: { collect?: Collector } = {},
): ControlItem[] {
  const flatten = (items: TreeItem[]): ControlSpec[] =>
    items.flatMap((item) => (isGroup(item) ? flatten(item.items) : [item]))
  return controlTree(verbs, groups, { collect }).items.flatMap(
    (section, i): ControlItem[] =>
      i ? [{ separator: true }, ...flatten([section])] : flatten([section]),
  )
}
