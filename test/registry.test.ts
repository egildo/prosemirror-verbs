// Tests for the pure machinery. The proving venue exercises everything against a
// live editor; these pin the registry's own laws — the gates, the guard, the
// projections — where a package can check them without a DOM.

import { describe, it, expect, vi } from 'vitest'
import { Schema } from 'prosemirror-model'
import { schema as basic } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import { EditorState } from 'prosemirror-state'
import type { Command } from 'prosemirror-state'
import {
  composeVerbs,
  basicVerbs,
  blocktypeVerb,
  expand,
  collectingCommand,
  composeKeyboard,
  toKeymap,
  formatKeys,
  controlSpecs,
  toolbarSpecs,
  applyAttrs,
  humanizeId,
  type VerbEntry,
  type ControlSpec,
  type AttrLayer,
} from '../src/index.js'

const schema = new Schema({
  nodes: addListNodes(basic.spec.nodes, 'paragraph block*', 'block'),
  marks: basic.spec.marks,
})
const state = EditorState.create({ schema })

const noop: Command = () => true
const never: Command = () => false

describe('composeVerbs', () => {
  it('normalizes every entry to run: (args) => Command', () => {
    const [verb] = composeVerbs({ id: 'x', label: 'X', command: noop })
    expect(typeof verb.run).toBe('function')
    expect(verb.run()(state)).toBe(true)
  })

  it('refuses a duplicate id, naming both claimants', () => {
    expect(() =>
      composeVerbs(
        { id: 'x', label: 'First', command: noop },
        { id: 'x', label: 'Second', command: noop },
      ),
    ).toThrow('id "x" is declared by both "First" and "Second"')
  })

  it('preserves extra properties — the NodeSpec allowance', () => {
    const [verb] = composeVerbs({ id: 'x', label: 'X', command: noop, icon: 'star' })
    expect(verb.icon).toBe('star')
  })

  it('accepts arrays and single entries alike', () => {
    const verbs = composeVerbs(
      [{ id: 'a', label: 'A', command: noop }],
      { id: 'b', label: 'B', command: noop },
    )
    expect(verbs.map((verb) => verb.id)).toEqual(['a', 'b'])
  })
})

describe('the chord gate', () => {
  it('refuses a duplicate chord within the verb layer', () => {
    const verbs = composeVerbs(
      { id: 'a', label: 'A', command: noop, keys: ['Mod-b'] },
      { id: 'b', label: 'B', command: noop, keys: ['Mod-b'] },
    )
    expect(() => toKeymap(verbs)).toThrow('chord "Mod-b" is claimed by both "a" and "b"')
  })

  it('skips arg-verb chords without a collector, binds them with one', () => {
    const entry: VerbEntry = {
      id: 'x',
      label: 'X',
      command: () => noop,
      args: [{ name: 'v', label: 'V' }],
      keys: ['Mod-q'],
    }
    expect(() => toKeymap(composeVerbs(entry))).not.toThrow()
    const keyboard = composeKeyboard(composeVerbs(entry), [], { collect: () => ({ v: 1 }) })
    expect(keyboard.describe('Mod-q')).toEqual([{ layer: 'verbs', verb: 'x' }])
  })
})

describe('expand', () => {
  it('curries an enumerable-domain verb into per-member forms with derived boolean reads', () => {
    const forms = expand(blocktypeVerb(schema))
    const h2 = forms.find((form) => form.id === 'blocktype:h2')!
    expect(h2.label).toBe('Heading 2')
    expect(h2.keys).toEqual(['Shift-Mod-2'])
    // In a fresh doc the cursor stands in a paragraph:
    const paragraph = forms.find((form) => form.id === 'blocktype:paragraph')!
    expect(paragraph.read!(state)).toBe(true)
    expect(h2.read!(state)).toBe(false)
  })

  it('returns nothing for a verb without an enumerable domain', () => {
    expect(expand({ id: 'x', label: 'X', command: noop })).toEqual([])
  })

  it('expands bare members into bare capabilities the cascade can dress', () => {
    // A domain's capability is its values; what the members are called is the
    // host's. A plugin shipping `[{value:'head'},…]` must still expand — into
    // ordinary entries with ordinary ids, carrying no taste to argue with.
    const forms = expand({
      id: 'table:row-region',
      command: (args) => (args.region === 'foot' ? noop : never),
      args: [{ name: 'region', domain: [{ value: 'head' }, { value: 'foot' }] }],
      read: () => 'foot',
    })
    expect(forms.map((form) => form.id)).toEqual(['table:row-region:head', 'table:row-region:foot'])
    expect(Object.keys(forms[0]!).sort()).toEqual(['command', 'id', 'read'])
    expect(forms[1]!.read!(state)).toBe(true)
    const { verbs } = applyAttrs(composeVerbs(forms), [
      { name: 'host', attrs: (verb) => (verb.id.endsWith(':foot') ? { label: 'Footer rows', short: '⊥' } : {}) },
    ])
    expect(verbs.map((verb) => verb.label)).toEqual(['Head', 'Footer rows']) // derived, then named
    expect(verbs[1]!.short).toBe('⊥')
  })
})

describe('applyAttrs — the host dresses what the plugin declared', () => {
  // A bare capability: what it can do, what it can tell you. No name, no glyph,
  // no chord, no group — the plugin does not know it is called a verb.
  const capability: VerbEntry = { id: 'table:add-row-after', command: noop }

  const dress = (entry: VerbEntry, layers: AttrLayer[] = []) => applyAttrs(composeVerbs(entry), layers)

  it('names an unnamed register from its ids alone — install-and-go survives the split', () => {
    expect(humanizeId('table:add-row-after')).toBe('Add row after')
    expect(humanizeId('blocktype:h1')).toBe('H1')
    expect(humanizeId('bullet_list')).toBe('Bullet list')
    expect(humanizeId('strong')).toBe('Strong')
    expect(dress(capability).verbs[0]!.label).toBe('Add row after')
  })

  it('layers resolve in order, later winning per key', () => {
    const { verbs } = dress(capability, [
      { name: 'house', attrs: { label: 'Insert row', group: 'table', short: '⊕' } },
      { name: 'venue', attrs: { short: '⊕↓' } },
    ])
    expect(verbs[0]!.label).toBe('Insert row') // beat the naming default
    expect(verbs[0]!.short).toBe('⊕↓') // beat the house layer
    expect(verbs[0]!.group).toBe('table') // untouched by the later layer
  })

  it("the declaration is a layer too — it beats the naming default and loses to the host", () => {
    const declaring: VerbEntry = { id: 'x', label: 'Declared', short: 'D', command: noop }
    expect(dress(declaring).verbs[0]!.label).toBe('Declared')
    const overridden = dress(declaring, [{ name: 'venue', attrs: { label: 'Host says' } }])
    expect(overridden.verbs[0]!.label).toBe('Host says')
    expect(overridden.verbs[0]!.short).toBe('D') // what the host left alone still stands
  })

  it('matches by exact id, by prefix glob, and by predicate', () => {
    const verbs = composeVerbs(
      { id: 'table:one', command: noop },
      { id: 'table:two', command: noop },
      { id: 'mark:bold', command: noop },
    )
    const seen = (layer: AttrLayer) =>
      applyAttrs(verbs, [layer])
        .verbs.filter((verb) => verb.hit)
        .map((verb) => verb.id)
    expect(seen({ name: 'l', match: 'table:one', attrs: { hit: true } })).toEqual(['table:one'])
    expect(seen({ name: 'l', match: 'table:*', attrs: { hit: true } })).toEqual(['table:one', 'table:two'])
    expect(seen({ name: 'l', match: '*', attrs: { hit: true } })).toHaveLength(3)
    expect(seen({ name: 'l', attrs: { hit: true } })).toHaveLength(3) // absent match = every verb
    expect(seen({ name: 'l', match: (verb) => verb.id.endsWith('two'), attrs: { hit: true } })).toEqual(['table:two'])
  })

  it('a layer may be a function of the verb — how a derived attribute is expressed', () => {
    // The registry never learns what "room" means; the layer computes it from
    // the shape the plugin declared, and the bag carries it through untouched.
    const verbs = composeVerbs(
      { id: 'plain', command: noop },
      { id: 'bounded', command: () => noop, args: [{ name: 'm', label: 'M', domain: [{ value: 'a', label: 'A' }] }] },
      { id: 'unbounded', command: () => noop, args: [{ name: 'v', label: 'V', type: 'text' }] },
    )
    const room: AttrLayer = {
      name: 'derived room',
      attrs: (verb) => ({
        room: !verb.args ? 'glyph' : verb.args[0]!.domain ? 'bounded' : 'unbounded',
      }),
    }
    expect(applyAttrs(verbs, [room]).verbs.map((verb) => verb.room)).toEqual(['glyph', 'bounded', 'unbounded'])
  })

  it('a later layer sees what an earlier one decided — these are layers, not patches', () => {
    const verbs = composeVerbs(
      { id: 'glyphy', command: noop },
      { id: 'long', command: () => noop, args: [{ name: 'v', label: 'V', type: 'text' }] },
    )
    const dressed = applyAttrs(verbs, [
      { name: 'derived room', attrs: (verb) => ({ room: verb.args ? 'unbounded' : 'glyph' }) },
      { name: 'placement', attrs: { manner: 'anchored' } },
      // Matches on room, which no verb declared and the layer above computed.
      { name: 'the value bar', match: (verb) => verb.room === 'unbounded', attrs: { manner: 'docked' } },
    ])
    expect(dressed.verbs.map((verb) => [verb.id, verb.manner])).toEqual([
      ['glyphy', 'anchored'],
      ['long', 'docked'],
    ])
  })

  it('carries an attribute it has never heard of — the open-bag law', () => {
    const { verbs } = dress(capability, [{ name: 'surface', attrs: { manner: 'docked', priority: 3, nonsense: {} } }])
    expect(verbs[0]!.manner).toBe('docked')
    expect(verbs[0]!.priority).toBe(3)
    expect(verbs[0]!.nonsense).toEqual({})
  })

  it('never lets taste redefine the capability', () => {
    for (const key of ['command', 'read', 'enabled', 'args', 'id']) {
      expect(() => dress(capability, [{ name: 'greedy', attrs: { [key]: noop } }])).toThrow(
        /may not set .* that is the capability's/,
      )
    }
    // And the capability itself survives dressing untouched.
    const { verbs } = dress(capability, [{ name: 'venue', attrs: { label: 'X' } }])
    expect(verbs[0]!.run()(state)).toBe(true)
  })

  it('owes sight, not refusal: describe names every claimant and the winner', () => {
    const { describe: claims } = dress({ id: 'x', label: 'Declared', command: noop }, [
      { name: 'house', attrs: { label: 'House' } },
      { name: 'venue', match: 'x', attrs: { label: 'Venue' } },
    ])
    expect(claims('x').map((claim) => [claim.layer, claim.value, !!claim.wins])).toEqual([
      ['naming', 'X', false],
      ['declaration', 'Declared', false],
      ['house', 'House', false],
      ['venue', 'Venue', true],
    ])
    expect(claims('nobody')).toEqual([])
  })

  it('audits the contested keys, refusing none of them', () => {
    const { audit } = dress({ id: 'x', command: noop }, [
      { name: 'house', attrs: { group: 'a' } },
      { name: 'venue', attrs: { group: 'b' } },
    ])
    const contested = audit()
    expect(contested.find((row) => row.key === 'group')!.claims.map((claim) => claim.layer)).toEqual([
      'house',
      'venue',
    ])
    // label is contested too (naming vs nothing declared) — only keys more than
    // one layer claimed are reported, so a lone naming claim is not listed.
    expect(contested.every((row) => row.claims.length > 1)).toBe(true)
  })

  it('a dressed register feeds the projections it always fed', () => {
    const { verbs } = applyAttrs(composeVerbs({ id: 'table:add-row-after', command: noop }), [
      { name: 'venue', attrs: { short: '⊕↓', group: 'table' } },
    ])
    const [spec] = toolbarSpecs(verbs, 'table')
    expect(spec).toMatchObject({ id: 'table:add-row-after', label: '⊕↓', title: 'Add row after' })
  })
})

describe('controlSpecs — the shape names the control', () => {
  const ask = () => ({ v: 'asked' })
  const controls = (verbs: ReturnType<typeof composeVerbs>, collect?: typeof ask) =>
    controlSpecs(verbs, 'g', collect ? { collect } : {}).filter(
      (item): item is ControlSpec => !('separator' in item),
    )

  const plain: VerbEntry = { id: 'plain', label: 'Plain', short: 'P', command: noop, group: 'g' }
  const field: VerbEntry = {
    id: 'field',
    label: 'Field verb',
    command: (args) => (args.v === 'x' ? noop : never),
    args: [{ name: 'v', label: 'Value', type: 'text' }],
    read: () => 'standing',
    enabled: () => true,
    group: 'g',
  }
  const select: VerbEntry = {
    id: 'select',
    label: 'Select verb',
    command: () => noop,
    args: [{ name: 'm', label: 'Member', domain: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }],
    read: () => 'b',
    group: 'g',
  }
  const pair: VerbEntry = {
    id: 'pair',
    label: 'Two args',
    short: '⊞',
    command: () => noop,
    args: [{ name: 'x', label: 'X' }, { name: 'y', label: 'Y' }],
    group: 'g',
  }

  it('reads button, field and select off the declaration alone', () => {
    const specs = controls(composeVerbs(plain, field, select))
    expect(specs.map((spec) => [spec.id, spec.kind])).toEqual([
      ['plain', 'button'],
      ['field', 'field'],
      ['select', 'select'],
    ])
  })

  it('keeps the readback whole — the domain the toolbar projection throws away', () => {
    const [spec] = controls(composeVerbs(field))
    expect(spec!.value!(state)).toBe('standing')
    // The same verb, projected for a strip of buttons, can only say "lit".
    const [flat] = toolbarSpecs(composeVerbs({ ...field, short: 'F' }), 'g', { collect: ask })
    expect((flat as { active: (s: unknown) => boolean }).active(state)).toBe(true)
  })

  it('a field commits through write, needing no collector', () => {
    const [spec] = controls(composeVerbs(field))
    expect(spec!.write!('x')(state)).toBe(true)
    expect(spec!.write!('other')(state)).toBe(false)
    expect(spec!.label).toBe('Value') // the argument's own words
    expect(spec!.type).toBe('text')
  })

  it("a label-less argument leaves the field's face to the cascade — and so to the host", () => {
    // `args` is a capability key, closed to layers. A label buried in it would
    // be the one piece of taste no attribute could reach, so a plugin that
    // ships bare capabilities declares none, and the field wears the verb's
    // label — which a host layer governs like every other name.
    const bare: VerbEntry = { ...field, args: [{ name: 'v', type: 'text' }] }
    expect(controls(composeVerbs(bare))[0]!.label).toBe('Field verb') // the verb's own
    const renamed = applyAttrs(composeVerbs(bare), [
      { name: 'host', match: 'field', attrs: { label: 'Reference name' } },
    ])
    expect(controls(renamed.verbs)[0]!.label).toBe('Reference name')
    expect(controls(renamed.verbs)[0]!.title).toBe('Reference name')
    // Undeclared everywhere, the id still answers.
    const nameless = composeVerbs({ id: 'table:abbr', command: noop, read: () => 'x', group: 'g', args: [{ name: 'abbr' }] })
    expect(controls(nameless)[0]!.label).toBe('Abbr')
  })

  it("a field's command dry-runs the enabled gate and asks only on a real run", () => {
    const gated = composeVerbs({ ...field, enabled: () => false })
    expect(controls(gated)[0]!.command(state, undefined)).toBe(false)
    const open = controls(composeVerbs(field), ask)[0]!
    expect(open.command(state, undefined)).toBe(true)
    const dispatch = vi.fn()
    open.command(state, dispatch)
    expect(dispatch).not.toHaveBeenCalled() // 'asked' is not 'x'; the verb refused honestly
  })

  it('a select carries its members and its current one', () => {
    const [spec] = controls(composeVerbs(select))
    expect(spec!.options!.map((option) => option.value)).toEqual(['a', 'b'])
    expect(spec!.value!(state)).toBe('b')
    expect(spec!.label).toBe('Select verb')
  })

  it('a multi-arg verb stays a modal button, and needs a collector to appear', () => {
    expect(controls(composeVerbs(pair))).toEqual([])
    const [spec] = controls(composeVerbs(pair), ask)
    expect(spec!.kind).toBe('button')
    expect(spec!.label).toBe('⊞')
  })

  it('omits what has no control: no args and no face, or an argument with nothing to show', () => {
    const faceless: VerbEntry = { id: 'faceless', label: 'F', command: noop, group: 'g' }
    const blind: VerbEntry = {
      id: 'blind',
      label: 'B',
      command: () => noop,
      args: [{ name: 'v', label: 'V' }],
      group: 'g',
    }
    expect(controls(composeVerbs(faceless, blind), ask)).toEqual([])
  })

  it('sections meet at a separator, in the order the surface asks for', () => {
    const verbs = composeVerbs(plain, { ...select, id: 'other', group: 'h' })
    const items = controlSpecs(verbs, ['h', 'g'])
    expect(items.map((item) => ('separator' in item ? '|' : item.id))).toEqual(['other', '|', 'plain'])
  })
})

describe('collectingCommand — the dispatch guard', () => {
  const entry: VerbEntry = {
    id: 'x',
    label: 'X',
    command: (args) => (args.ok ? noop : never),
    args: [{ name: 'ok', label: 'OK' }],
  }

  it('dry-runs without ever collecting', () => {
    const collect = vi.fn()
    const [verb] = composeVerbs(entry)
    expect(collectingCommand(verb, collect)(state)).toBe(true)
    expect(collect).not.toHaveBeenCalled()
  })

  it('answers the declared enabled on a dry run', () => {
    const [verb] = composeVerbs({ ...entry, enabled: () => false })
    expect(collectingCommand(verb, () => ({ ok: true }))(state)).toBe(false)
  })

  it('collects on a real run and forwards the args', () => {
    const [verb] = composeVerbs(entry)
    const dispatch = vi.fn()
    expect(collectingCommand(verb, () => ({ ok: true }))(state, dispatch)).toBe(true)
  })

  it('no-ops honestly on a cancel', () => {
    const [verb] = composeVerbs(entry)
    const dispatch = vi.fn()
    expect(collectingCommand(verb, () => null)(state, dispatch)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('composeKeyboard — the stack of courts', () => {
  const verbs = composeVerbs({ id: 'a', label: 'A', command: noop, keys: ['Mod-b'] })
  const keyboard = composeKeyboard(verbs, [
    { name: 'first policy', bindings: { Enter: never } },
    { name: 'second policy', bindings: { 'Enter': noop, 'Mod-x': noop } },
  ])

  it('describes claimants in court order, dry runs deciding who wins', () => {
    expect(keyboard.describe('Enter', state)).toEqual([
      { layer: 'first policy', applies: false },
      { layer: 'second policy', applies: true, wins: true },
    ])
  })

  it('names the verb behind a chord claim', () => {
    expect(keyboard.describe('Mod-b')).toEqual([{ layer: 'verbs', verb: 'a' }])
  })

  it('audits only keys with more than one claimant', () => {
    expect(keyboard.audit()).toEqual([
      { key: 'Enter', claims: [{ layer: 'first policy' }, { layer: 'second policy' }] },
    ])
  })

  it('emits one keymap plugin per layer, in order', () => {
    expect(keyboard.plugins).toHaveLength(3)
  })
})

describe('formatKeys', () => {
  it('renders mac symbols in conventional order', () => {
    expect(formatKeys('Mod-b', { mac: true })).toBe('⌘B')
    expect(formatKeys('Shift-Mod-2', { mac: true })).toBe('⇧⌘2')
  })

  it('renders PC chords in conventional order, whatever the declared order', () => {
    expect(formatKeys('Mod-b')).toBe('Ctrl+B')
    expect(formatKeys('Shift-Mod-2')).toBe('Ctrl+Shift+2')
  })

  it('leaves named keys alone', () => {
    expect(formatKeys('Enter', { mac: true })).toBe('Enter')
  })
})

describe('the starter sets guard their nouns', () => {
  it('yields nothing for a schema without the marks', () => {
    const bare = new Schema({
      nodes: { doc: { content: 'p+' }, p: { content: 'text*' }, text: {} },
    })
    expect(basicVerbs(bare)).toEqual([])
  })
})
