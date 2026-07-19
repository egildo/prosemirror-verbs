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
  type VerbEntry,
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
