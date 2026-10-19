# prosemirror-verbs

The editor's **verb-Schema**. ProseMirror's `Schema` registers the document's *nouns* — the nodes and marks a document is made of. This registers its *verbs* — the commands, and how they are summoned.

It is a **ProseMirror profile of [verbr](../../verbr)**, the command register it was generalised into. verbr owns the register, the taste, the projection and the one checked door (`compose`, `applyTaste`, `project`, `invoke`); this package says what only ProseMirror can — that a verb's context is an `EditorState`, that what it runs is a `Command`, that a command's dry run is its availability, that the keyboard is a stack of keymap plugins — and ships the starter sets read off the schema. It ships no UI — surfaces (a toolbar, a palette, a console rig) are the host's furniture, built once by consuming the registry. Its proving ground is [pm-testing-venue](https://github.com/egildo/pm-testing-venue), where every principle is exercised against a live editor. The reasoning lives in [tablet.md](tablet.md); this file is how to use it.

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

**The taste** is what only the host can know — what to call it, which picture it wears, which chord answers to it, where it sits. It may ride on the entry (this package's own starter sets do, being host-side furniture), but it belongs to the host, which writes it as a **cascade of layers** (tablet V13) and wins every disagreement:

```js
{
  label:    'Bold',                            // human name — absent ⇒ derived from the id
  icon:     'bold',                            // the NAME of a picture; its absence is curation
  as:       'switch',                          // how to draw it, overriding what the shape implied
  keys:     ['Mod-b'],                         // chord(s) → the keyboard
  keywords: ['bold', 'strong'],                // extra search terms → palette
  section:  'marks',                           // which section it sits in → surface layout
  // …and whatever a surface layer needs: room, manner, priority
}
```

The test that tells them apart, for any new field: **could a second editor reasonably disagree?** If yes, it is taste. A plugin that wants to spare its hosts the naming may ship its suggestions as a *separate* export — plain data keyed by id, which a host seats as one taste document or ignores (prosemirror-spreads' `spreadsTaste` is the worked example).

The normative clauses:

- **Required pair**: `id` and `command`. An entry with only these is a complete, API-callable verb, and verbr's naming default names it until someone names it better.
- **The invariant**: `args` declared ⟺ `command` is a factory `(args) => Command`.
- **One readback**: `read` returns the current value of whatever state the verb addresses — a boolean for a toggle, a member value for one-of-N, a count for a wrap. There is no separate `active`; a surface lights on the reading it gets.
- **Purity clause**: dry runs and readbacks are called on *every* editor transaction by syncing consumers — they must be pure and cheap.
- **Extra properties are preserved, never refused** — the NodeSpec allowance (prosemirror-tables rides `tableRole` on it). Stash an `icon` or your own hints; consumers ignore what they don't know.
- **A set guards its nouns**: a verb set returns only entries whose node and mark types exist in the schema it was given (`schema.nodes.x && {…}`, the way every set in this package does it). Composed into a host without your nouns, your set yields nothing — never entries that crash.
- **`args[].type` is verbr's vocabulary** — `text`, `number`, `url` and whatever the host adds at `compose` — checked at the door, so a name nobody holds is refused at build. `required: true` marks what a collector must supply.

`fromCommands(entries)` turns capabilities into verbr verbs, once, before composing: `run` hands back the Command (a factory gets the args), and a bare command's **dry run becomes its `enabled`**, so availability is declared nowhere twice. An arg-verb keeps the gate it declared. Every set this package exports is already converted; a plugin's plain entries go through `fromCommands` at the host.

## Composing

verbr's `compose(sets, vocabulary)` is the host's first act (tablet, *the composition law*): it **refuses a duplicate id at build time** — the same law the keyboard applies to chords, possible only because one point sees every claim. Namespace your ids by taste (`insert:image`, `table:add-row`); the gate makes convention emerge rather than mandating one. And because entries are plain data, the host stays sovereign for free: re-key, strip, or override any entry with a `map` before composing — no API.

## Dressing

The taste is verbr's `applyTaste(register, documents, derivations)` (tablet V13): documents stacked root-first — a plugin's suggestions, then the host's — each holding per-verb opinions (`verbs`), rules over many verbs (`layers`), the `sections` a surface may lay verbs out in, and the words for withheld `reasons`. A document is **data**: a layer selects with `where` (an id glob, a `kind`, an attribute an earlier layer resolved) and computes, where it must, through a function the host names (`{ derive: 'room' }`). `describe`, `audit` and `orphans` are the sight a cascade owes. The declaration's own taste — a starter set's label, icon, keys and section — is the floor beneath every document.

```js
const taste = applyTaste(register, [
  { name: 'spreads', verbs: spreadsTaste },                                    // a plugin's suggestions, seated
  { name: 'venue',
    sections: [{ id: 'marks', label: 'Format' }, { id: 'table', label: 'Table', as: 'menu' }],
    layers: [
      { name: 'sections', where: { id: 'table:*' }, attrs: { section: 'table' } },
      { name: 'room', attrs: { room: { derive: 'room' } } },
      { name: 'value bar', where: { room: 'unbounded' }, attrs: { manner: 'docked' } },
    ] },
], { room: (verb) => (verb.args ? 'bounded' : 'glyph') })
```

Capability keys are closed to taste, and so are the keys the projection reads from the state. The bag is otherwise open: `room`, `manner`, `priority` ride through to the surface that acts on them. **Sections are a closed vocabulary**: a section a starter set names must be declared by some document, or the verb moved out of it, or `applyTaste` refuses.

## Availability, activity, domains

Every verb answers "can I run here?" for free — a `Command` decides applicability before `dispatch` is consulted, so the dry run is the whole availability story (tablet V2). *Activity* is different: only a verb that addresses a piece of state answers "am I on?", and the answer is a **readback** of that state over a **domain** of values. The document-side domains come from the document's own anatomy (tablet V7), and the registry ships one readback per kind:

- `markActive(state, type)` — mark-set membership → boolean. Bold is on or off.
- `markupActive(state, type, attrs)` — textblock identity → one-of-N. A block *is* exactly one markup (ProseMirror's own word for type + attrs).
- `wrapDepth(state, type)` — ancestor-path multiplicity → count. How deep in blockquotes?

Plugin state is the other readback source — a verb just writes its predicate over its plugin's own state (tablet V7's by-charter opening, proven by the venue's highlight specimen). Verbs that create (`insert …`) or move along history (undo, redo) address nothing and are honestly mute: no `read`, and nothing missing.

## Sources of verbs

- **Declared** — `wrapVerbs(schema)` (blockquote, bullet list, ordered list), `historyVerbs()` (undo, redo). Hand-written starter sets, the way `prosemirror-schema-basic` ships starter nouns; a host may write its own entries instead.
- **Derived** — the verb-Schema reading the noun-Schema (tablet V3), in `derive.ts`:
  - `markVerbs(schema)` — one capability per mark. No required attrs ⇒ a toggle with a boolean readback; a mark carrying an attribute the spec gives no default (a link's `href`) ⇒ an **arg-verb** whose readback is the value you stand in and whose gate is the command's own dry run.
  - `insertVerbs(schema)` — one *insert X* per node type, `insertPoint` answering "can this node go here?" position-aware, required attrs becoming the arg-schema.
  - `basicVerbs(schema)` — `markVerbs` dressed in the conventional taste (Bold/B/`Mod-b`, and the fact that an href is a URL, which no schema says). The starter set is now derived rather than hand-listed, so a schema carrying an underline gets it for free, with the same readback and the same gate as the four anyone thought about.

### What derivation can't know, and the `authoring` hint

The schema declares what is **grammatically legal**, never what is **legitimately user-creatable**. A table row is legal inside a table body, so `insertPoint` finds a spot — and a derived insert verb will put a raw row into somebody's spreadsheet, past every command its owner wrote. So the plugin that owns a noun says so, on the NodeSpec, under the allowance `tableRole` already uses:

```js
table: {
  content: 'caption? row+',
  authoring: {
    sealed: true,     // every type reachable only through me is mine — derive nothing for it
    insert: false,    // …and not mine either; I declare my own
    // insert: (type) => myInsertCommand(type)   // …or derive it, but build it with this
  },
}
```

This is a **capability fact, not taste**: no second editor could reasonably disagree that a table cell is not a top-level insert — which is exactly V12's test, run the other way. `sealed` states the cause once instead of the consequence on every interior spec; `interiorTypes(schema)` returns what it computed, because a whole-schema rule has to stay inspectable rather than magic. And `sealed` is **not** `isolating`, which it will often sit beside: that one governs whether selection and deletion cross a boundary.
- **Declared once, expanded** — `blocktypeVerb(schema)` is *one* verb over the enumerable domain of textblock markups (paragraph, heading 1–6, code block). `expand(verb)` curries it into per-member no-arg forms — `blocktype:h2` with its face, chords, and a boolean `read` derived from the verb's member-valued one — that every projection eats unchanged (tablet V9, pinned). Each form's availability is its own command's dry run. Hosts keep both: the verb for arg-taking consumers, the forms for keymap and toolbar.

All of it meets in the one act: `compose([basicVerbs(schema), blocktype, expand(blocktype), wrapVerbs(schema), historyVerbs(), insertVerbs(schema)])`.

## The door, the keyboard, the projection

Every surface names a verb by id and runs it through one door, so a chord cannot run what a button refuses.

- `commandFor(register, id, { args, collect })` — verbr's `invoke`, as a ProseMirror **Command**. Its dry run answers availability and never collects; a real run checks availability and args at the door, then runs. An arg-verb summoned *without* args — a chord, a palette row — asks the collector on a real run; a cancel no-ops, and without a collector it refuses.
- `composeKeyboard(register, taste, policies, { collect })` — the whole keyboard as an ordered stack of layers (tablet, *the stack of courts*). The verb **chords**, read from the taste's `keys`, come first, flat-gated (a duplicate chord within the layer is a build error; arg-verbs bind only with a collector); then the host's **policies** in the order given — `{ name, bindings }`, where a policy is one key carrying a chain resolved by position (Enter), the base keymap seated openly as the last of them. Returns `{ plugins, describe, audit }`: `describe(key, state?)` answers who claims a key, in layer order, and who takes it now; `audit()` is the sweep — every key with more than one claimant, refusing nothing. Describe's honest limit: it sees layers and claims, never inside an imported `chainCommands`.
- `toKeymap(register, taste, { collect })` — the verb chord layer alone.

**The projection is verbr's** `project(register, state, taste, options)`: plain JSON a surface draws — a tree of sections holding `Control`s, each with its deduced `kind` (action, toggle, choice, value), its `as`, its words and picture, `enabled`, `pressed` or `value` read from the state, and its `shortcut` formatted for the platform. A surface holds no function; it re-projects when the state changes and runs by id. [prosemirror-surface](../prosemirror-surface) draws exactly that shape.

## Relations

`relations(verbs)` returns what the register knows about itself — `{ edges, formsOf, baseOf, alternatesOf, describe }`. Today that is **conjugation**: which verbs are the expanded forms of which domain verb.

Nothing declares it. The edges are derived by looking for `${base.id}:${member.value}` in the register, so there is no `parent` field to go stale and no way to assert an edge that isn't there. Two consequences worth knowing:

- **Self-verifying** — a form whose base was curated out of the composition truthfully has no base, and a host that never called `expand` gets no edges rather than a graph describing verbs that don't exist.
- **Carried by the id convention**, so a host re-keying entries before composing (host sovereignty, tablet V10) loses the edges. Accepted deliberately: a broken convention *loses* an edge, a stale field *asserts a false one*.

There is no `audit()` here — audit exists where claims compete, and derived facts don't. The condition that *is* worth reporting — **a domain verb drawn alongside its own forms**, a host showing a select and a row of radio buttons for one declaration — is a question about what got drawn, and belongs to whoever draws: the venue's console asks it of a projection with these edges.

## Arguments

A verb that needs input — `link` needs an `href`, `insert image` a `src` — is an **arg-verb**: its `command` is a factory `(args) => Command`, and its `args` name what must be supplied (for inserts and marks, read off the node's own required attributes; for `blocktype`, an enumerable `domain`). There are two ways to supply them. A **field** or a **select** is the collector, inlined: the projection calls the verb a `value` or a `choice`, the surface shows its readback, and commits by running the id with args. A chord or a palette row has no control to read, so `commandFor` asks the **collector** on a real run — `collect(verb, state)`, chrome the host supplies (the proving venue's is a bare `window.prompt`), returning the args or `null` for a cancel. The dry run never asks. A collector should prefill from the verb's readback — link's `read` is the href you stand in, offered back ready to edit: domains are shared vocabulary between reading a value back and collecting one forward. Still ahead: the async collector (a surface that asks first, then dispatches).

## Hosting it

```js
import { compose, applyTaste, project } from 'verbr'
import { basicVerbs, blocktypeVerb, wrapVerbs, historyVerbs, insertVerbs, expand,
         commandFor, composeKeyboard } from 'prosemirror-verbs'

const blocktype = blocktypeVerb(schema)
const register = compose([basicVerbs(schema), blocktype, expand(blocktype),
                          wrapVerbs(schema), historyVerbs(), insertVerbs(schema)])
const taste = applyTaste(register, { sections: [{ id: 'marks' }, { id: 'blocktype' },
  { id: 'wraps' }, { id: 'insert' }, { id: 'history' }] })

const keyboard = composeKeyboard(register, taste, [
  { name: 'list behavior', bindings: listBehavior(schema) },
  { name: 'base', bindings: baseKeymap },
], { collect })

// a surface: re-project on every state, run by id through the one door
const controls = (state) => project(register, state, taste, { face: 'icon', includeUnavailable: true })
const run = (id, args, view) => commandFor(register, id, { args, collect })(view.state, view.dispatch, view)
```

A headless consumer is the same register with no DOM in the loop — the package does not care who calls; `keyboard.describe('Enter')` is its sight made tangible.

A plugin joins without importing anything from here — its capabilities are plain data, its behavior keys are an exported policy layer, and what it would *call* things is a third export the host seats or ignores:

```js
// in prosemirror-spreads, say — no runtime import from prosemirror-verbs
export const tableCapabilities = (schema) =>
  schema.nodes.table
    ? [{ id: 'table:add-row-after', command: addRowAfter } /* … */]
    : [] // a set guards its nouns
export const tableKeys = (schema) => ({ 'Tab': goToNextCell(1), 'Shift-Tab': goToNextCell(-1) })
export const tableTaste = { 'table:add-row-after': { label: 'Add row after', icon: 'row-add-after' } }

// in the host — the capabilities become verbs, the suggestions a taste document
const register = compose([basicVerbs(schema), fromCommands(tableCapabilities(schema))])
const taste = applyTaste(register, [
  { name: 'table', verbs: tableTaste },
  { name: 'venue', sections: [{ id: 'marks' }, { id: 'table' }],
    layers: [{ name: 'sections', where: { id: 'table:*' }, attrs: { section: 'table' } }] },
])
const keyboard = composeKeyboard(register, taste, [
  { name: 'table keys', bindings: tableKeys(schema) },
  { name: 'base', bindings: baseKeymap },
], { collect })
console.table(keyboard.audit()) // who shadows whom, in court order
console.table(taste.audit())    // and the same sweep over taste
```

## Status

An autonomous package, extracted from its proving venue on 2026-07-19 with the tablet carried along, and rebased on verbr on 2026-10-19: the composition, the cascade, the control projection and the sections moved there, and this package kept what is ProseMirror's. verbr is linked locally (`file:../../verbr`) until it is published. The venue still hosts it as a specimen and keeps every surface (toolbar element, console rig, prompt collector) as its own furniture — plugins ship capabilities, hosts ship verbs and chrome (tablet V12, amended 2026-07-29). The async collector is deferred — see [tablet.md](tablet.md)'s open questions. The tablet still speaks the old words (`group`, `applyAttrs`, `controlTree`); amending it is its author's call.
