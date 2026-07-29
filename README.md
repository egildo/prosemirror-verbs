# prosemirror-verbs

The editor's **verb-Schema**. ProseMirror's `Schema` registers the document's *nouns* — the nodes and marks a document is made of. This registers its *verbs* — the commands, and how they are summoned.

It is one small package: the registry and its pure projections, nothing else. It ships no UI — surfaces (a toolbar, a palette, a console rig) are the host's furniture, built once by consuming the registry. Its proving ground is [pm-testing-venue](https://github.com/egildo/pm-testing-venue), where every principle is exercised against a live editor. The reasoning lives in [tablet.md](tablet.md); this file is how to use it.

## The entry contract

A verb is declared once, as plain data — and the shape below is a **structural contract, with nothing to import at runtime**: a plugin declares by exporting plain objects, paying zero dependency on this package (tablet, *the composition law*). Only hosts, which project, depend on it. A TypeScript plugin may `import type { Capability } from 'prosemirror-verbs'` — type-only, erased at build, so the zero-dependency claim holds.

An entry has two halves, and the line between them is the doctrine (tablet V12). **The capability** is what only the plugin can know:

```js
{
  id:       'strong',                          // REQUIRED — unique across the composition
  command:  toggleMark(schema.marks.strong),   // REQUIRED — a Command, or (args) => Command
  read:     (state) => boolean | 'h2' | 2,     // the readback, if the verb addresses state — optional
  enabled:  (state) => boolean,                // availability for arg-verbs; no-arg verbs use the command's own dry run
  args:     [{ name, type?, domain? }],        // present ⇒ command is a factory
}
```

**The taste** is what only the host can know — what to call it, which glyph it wears, which chord answers to it, where it sits. It may ride on the entry (this package's own starter sets do, being host-side furniture), but it belongs to the host, which writes it as a **cascade of layers** (tablet V13) and wins every disagreement:

```js
{
  label:    'Bold',                            // human name — absent ⇒ derived from the id
  short:    'B',                               // compact toolbar face; its absence is curation
  keys:     ['Mod-b'],                         // chord(s) → the keyboard
  keywords: ['bold', 'strong'],                // extra search terms → palette
  group:    'marks',                           // category → surface curation
  // …and whatever a surface layer needs: room, manner, priority, unavailable
}
```

The test that tells them apart, for any new field: **could a second editor reasonably disagree?** If yes, it is taste. A plugin that wants to spare its hosts the naming may ship its suggestions as a *separate* export — plain data keyed by id, which a host seats as one layer or ignores (prosemirror-spreads' `spreadsTaste` is the worked example).

The normative clauses:

- **Required pair**: `id` and `command`. An entry with only these is a complete, API-callable verb, and `humanizeId` names it until someone names it better.
- **The invariant**: `args` declared ⟺ `command` is a factory `(args) => Command`.
- **One readback**: `read` returns the current value of whatever state the verb addresses — a boolean for a toggle, a member value for one-of-N, a count for a wrap. There is no separate `active`; a surface lights on the reading it gets.
- **Purity clause**: dry runs and readbacks are called on *every* editor transaction by syncing consumers — they must be pure and cheap.
- **Extra properties are preserved, never refused** — the NodeSpec allowance (prosemirror-tables rides `tableRole` on it). Stash an `icon` or your own hints; consumers ignore what they don't know.
- **A set guards its nouns**: a verb set returns only entries whose node and mark types exist in the schema it was given (`schema.nodes.x && {…}`, the way every set in this package does it). Composed into a host without your nouns, your set yields nothing — never entries that crash.
- **`args[].type` is an open vocabulary** until collectors exist — it belongs to whoever collects.

Composition normalizes every entry to one internal shape — `run: (args) => Command` — so no consumer branches on whether a verb takes arguments.

## Composing

`composeVerbs(...sets)` is the host's first act (tablet, *the composition law*): it takes arrays or single entries, normalizes them, and **refuses a duplicate id at build time** — the same law the keyboard applies to chords, possible only because one point sees every claim. Namespace your ids by taste (`insert:image`, `table:addRow`); the gate makes convention emerge rather than mandating one. And because entries are plain data, the host stays sovereign for free: re-key, strip, or override any entry with a `map` before composing — no API.

## Dressing

`applyAttrs(verbs, layers)` is the host's second act (tablet V13): the taste, written as an ordered stack of layers over the composed register. Composition answers *what can this editor do*; attribution answers *what shall we call it, where does it go, what does it answer to* — different questions, so a venue writes them as two files.

```js
const registry = applyAttrs(composeVerbs(/* … */), [
  { name: 'spreads', attrs: (verb) => spreadsTaste[verb.id] ?? {} },   // a plugin's suggestions, seated
  { name: 'sections', match: 'table:*', attrs: { group: 'table' } },   // a glob
  { name: 'room', attrs: (verb) => ({ room: verb.args ? 'bounded' : 'glyph' }) },
  { name: 'value bar', match: (v) => v.room === 'unbounded', attrs: { manner: 'docked' } },
  { name: 'ours', match: 'table:abbr', attrs: { label: 'Reference name' } },
])
registry.verbs          // the dressed register — what you project
registry.describe(id)   // every claim on this verb, in court order, the winner per key marked
registry.audit()        // the sweep: every (verb, key) more than one layer claimed
```

- **Layers resolve in order, later winning per key**, and a layer sees the verb *as resolved so far* — so `match` can test what an earlier layer derived (`room` above), which is what makes this a cascade rather than a pile of patches.
- **`match`** is an exact id, a `prefix*` glob, `*`, or a predicate. Deliberately not CSS — the day it needs specificity rules it has stopped being a stack of a host's opinions.
- **Two layers are seated for you, beneath yours**: `naming`, which derives a label from the id, and `declaration`, whatever taste the entries carry. Both are ordinary layers, visible in `describe`, and yours beat them.
- **Capability keys are closed**: a layer setting `id`, `command`, `read`, `enabled` or `args` throws at build. Taste may rename a verb, never redefine what it does.
- **The bag is open**: `room`, `manner`, `priority` — words this package never learns ride through the projections untouched, to the surface that acts on them.

## Availability, activity, domains

Every verb answers "can I run here?" for free — a `Command` decides applicability before `dispatch` is consulted, so the dry run is the whole availability story (tablet V2). *Activity* is different: only a verb that addresses a piece of state answers "am I on?", and the answer is a **readback** of that state over a **domain** of values. The document-side domains come from the document's own anatomy (tablet V7), and the registry ships one readback per kind:

- `markActive(state, type)` — mark-set membership → boolean. Bold is on or off.
- `markupActive(state, type, attrs)` — textblock identity → one-of-N. A block *is* exactly one markup (ProseMirror's own word for type + attrs).
- `wrapDepth(state, type)` — ancestor-path multiplicity → count. How deep in blockquotes?

Plugin state is the other readback source — a verb just writes its predicate over its plugin's own state (tablet V7's by-charter opening, proven by the venue's highlight specimen). Verbs that create (`insert …`) or move along history (undo, redo) address nothing and are honestly mute: no `read`, and nothing missing.

## Sources of verbs

- **Declared** — `basicVerbs(schema)` (the marks: bold, italic, code, link), `wrapVerbs(schema)` (blockquote, bullet list, ordered list), `historyVerbs()` (undo, redo). Hand-written starter sets, the way `prosemirror-schema-basic` ships starter nouns; a host may write its own entries instead.
- **Derived** — `insertVerbs(schema)` computes one *insert X* verb per node type from the schema itself, using `insertPoint` to answer "can this node go here?" (tablet V3).
- **Declared once, expanded** — `blocktypeVerb(schema)` is *one* verb over the enumerable domain of textblock markups (paragraph, heading 1–6, code block). `expand(verb)` curries it into per-member no-arg forms — `blocktype:h2` with its face, chords, and a boolean `read` derived from the verb's member-valued one — that every projection eats unchanged (tablet V9, pinned). Hosts keep both: the verb for arg-taking consumers, the forms for keymap and toolbar.

All of it meets in the one act: `composeVerbs(basicVerbs(schema), blocktype, expand(blocktype), wrapVerbs(schema), historyVerbs(), insertVerbs(schema))`.

## Projections

The API grants pure, single-sourced computation; a consumer projects it into its native representation (tablet V8) — furniture for humans, signatures for machines.

- `composeKeyboard(verbs, policies, { collect })` — the whole keyboard as an ordered stack of layers (tablet, *the stack of courts*). The verb **chords** come first, flat-gated (a duplicate chord within the layer is a build error; arg-verbs bind through the collector when one is supplied, and are skipped otherwise); then the host's **policies** in the order given — `{ name, bindings }`, where a policy is one key carrying a chain resolved by position (Enter), the base keymap seated openly as the last of them. Returns `{ plugins, describe, audit }`: `plugins` is the ordered keymap plugins for the editor; `describe(key, state?)` answers who claims a key, in layer order, and — given a state — dry-runs the claimants to say who takes it now; `audit()` is the sweep — every key with more than one claimant across the stack, reported for the host's eye after composing a new plugin in, refusing nothing (cross-layer shadowing is the mechanism). Describe's honest limit: it sees layers and claims, never inside an imported `chainCommands`.
- `toKeymap(verbs, { collect })` — the verb chord layer alone, for hosts that keep their other keymaps out of the composition.
- `collectingCommand(verb, collect)` — the sync collector's wrap: an arg-verb as a plain dispatch-guarded command (see Arguments). `composeKeyboard` and `toolbarSpecs` apply it automatically when given `{ collect }`.
- `toolbarSpecs(verbs, groups, { collect })` — the shape a toolbar-grade surface eats, curated to an ordered list of groups with a separator marker between sections; filtered to entries with a `short` face; arg-verbs included only when `collect` is supplied. The spec's `active` is derived from `read` by truthiness (a boolean directly, a count when > 0) — the surface's native rendering of any domain. Each spec carries its `keys` so a surface can show chords. One-of-N forms render as honest radio: lit when current, no-op when pressed again (the toggle-back question is open — tablet, *the default member*).
- `formatKeys(key, { mac })` — a chord for humans: `Mod-b` → `⌘B` or `Ctrl+B`. Pure string work; the platform is the caller's conf, so the registry stays free of the DOM.

More projections (`paletteItems`, a `toolManifest` for agent consumers) join as their consumers arrive.

## Arguments

A verb that needs input — `link` needs an `href`, `insert image` a `src` — is an **arg-verb**: its `command` is a factory `(args) => Command`, and its `args` name what a collector must ask for (for inserts, read back from the node's own required attributes; for `blocktype`, an enumerable `domain`). Collection forks sync from async (tablet V6), and the **sync half is built**: `collectingCommand(verb, collect)` wraps an arg-verb in a self-prompting command, dispatch-guarded — the dry run answers availability without ever asking; only a real run collects, and a cancelled collection (`null`) no-ops. `collect(verb, state)` is chrome: the host supplies it (the proving venue's is a bare `window.prompt` asker) and hands it to the projections as `{ collect }` — with it, arg-verbs' chords bind and their toolbar faces appear; without it they stay declared, not collected. A collector should prefill from the verb's readback — link's `read` is the href you stand in, offered back ready to edit: domains are shared vocabulary between reading a value back and collecting one forward. Still ahead: the async collector (a surface that asks first, then dispatches — the palette's field).

## Hosting it

One import for the package; the surfaces are the host's own furniture:

```js
import { basicVerbs, blocktypeVerb, wrapVerbs, historyVerbs, insertVerbs, expand,
         composeVerbs, composeKeyboard, toolbarSpecs } from 'prosemirror-verbs'

const blocktype = blocktypeVerb(schema)
const verbs = composeVerbs(basicVerbs(schema), blocktype, expand(blocktype),
                           wrapVerbs(schema), historyVerbs(), insertVerbs(schema))

const keyboard = composeKeyboard(verbs, [
  { name: 'list behavior', bindings: listBehavior(schema) },
  { name: 'base', bindings: baseKeymap },
], { collect })

const state = EditorState.create({
  doc,
  plugins: [...keyboard.plugins, /* your surfaces, cursors, history, … */],
})
```

A toolbar built on `toolbarSpecs` is a form bound to the selection: readbacks are its current values, verbs its setters. A headless consumer is the same registry with no DOM in the loop — the package does not care who calls; `keyboard.describe('Enter')` is its sight made tangible.

A plugin joins without importing anything from here — its capabilities are plain data, its behavior keys are an exported policy layer, and what it would *call* things is a third export the host seats or ignores:

```js
// in prosemirror-spreads, say — no runtime import from prosemirror-verbs
export const tableCapabilities = (schema) =>
  schema.nodes.table
    ? [{ id: 'table:add-row-after', command: addRowAfter } /* … */]
    : [] // a set guards its nouns
export const tableKeys = (schema) => ({ 'Tab': goToNextCell(1), 'Shift-Tab': goToNextCell(-1) })
export const tableTaste = { 'table:add-row-after': { label: 'Add row after', short: '⊕↓' } }

// in the host — one more argument to each act, and an audit to eyeball the stack
const registry = applyAttrs(composeVerbs(basicVerbs(schema), tableCapabilities(schema)), [
  { name: 'table', attrs: (verb) => tableTaste[verb.id] ?? {} },
  { name: 'sections', match: 'table:*', attrs: { group: 'table' } },
])
const keyboard = composeKeyboard(registry.verbs, [
  { name: 'table keys', bindings: tableKeys(schema) },
  { name: 'list behavior', bindings: listBehavior(schema) },
  { name: 'base', bindings: baseKeymap },
], { collect })
console.table(keyboard.audit()) // who shadows whom, in court order
console.table(registry.audit()) // and the same sweep over attributes
```

## Status

An autonomous package, extracted from its proving venue on 2026-07-19 with the tablet carried along. The venue still hosts it as a specimen and keeps every surface (toolbar element, console rig, prompt collector) as its own furniture — plugins ship capabilities, hosts ship verbs and chrome (tablet V12, amended 2026-07-29). The async collector, the unified toolbar→palette surface, and the top-layer (`popover`) floating are deferred — see [tablet.md](tablet.md)'s open questions.
