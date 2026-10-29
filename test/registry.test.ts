// Tests for the ProseMirror profile. verbr pins its own laws — composition,
// the cascade, the projection, the door; these pin what this package adds over
// it: commands as verbs, the door as a Command, the keyboard, the starter sets,
// and that a ProseMirror register projects through verbr the way it should.

import { describe, it, expect, vi } from 'vitest'
import { Schema } from 'prosemirror-model'
import { schema as basic } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import { EditorState } from 'prosemirror-state'
import type { Command } from 'prosemirror-state'
import { applyTaste, compose, flat, project } from '@egildo/verbr'
import {
  fromCommands,
  commandFor,
  basicVerbs,
  blocktypeVerb,
  expand,
  composeKeyboard,
  toKeymap,
  type Capability,
} from '../src/index.js'

const schema = new Schema({
  nodes: addListNodes(basic.spec.nodes, 'paragraph block*', 'block'),
  marks: basic.spec.marks,
})
const state = EditorState.create({ schema })

const noop: Command = () => true
const never: Command = () => false

const registerOf = (...entries: Capability[]) => compose([fromCommands(entries)])
const dressed = (...entries: Capability[]) => {
  const register = registerOf(...entries)
  return { register, taste: applyTaste(register, {}) }
}

describe('fromCommands — a command is a verb', () => {
  it('runs the command it was given, and its dry run is its availability', () => {
    const [yes] = fromCommands({ id: 'x', command: noop })
    const [no] = fromCommands({ id: 'y', command: never })
    expect(yes!.run(state)).toBe(noop)
    expect((yes!.enabled as (s: EditorState) => boolean)(state)).toBe(true)
    expect((no!.enabled as (s: EditorState) => boolean)(state)).toBe(false)
  })

  it('hands a factory its args, and keeps the gate an arg-verb declared', () => {
    const factory = vi.fn(() => noop)
    const [verb] = fromCommands({ id: 'x', command: factory, args: [{ name: 'v' }], enabled: () => false })
    expect(verb!.run(state, { v: 1 })).toBe(noop)
    expect(factory).toHaveBeenCalledWith({ v: 1 })
    expect((verb!.enabled as (s: EditorState) => boolean)(state)).toBe(false)
  })

  it('preserves extra properties — the NodeSpec allowance', () => {
    const [verb] = fromCommands({ id: 'x', command: noop, icon: 'star' })
    expect(verb!.icon).toBe('star')
    expect('command' in verb!).toBe(false)
  })
})

describe('the chord gate', () => {
  it('refuses a duplicate chord within the verb layer', () => {
    const { register, taste } = dressed(
      { id: 'a', command: noop, keys: ['Mod-b'] },
      { id: 'b', command: noop, keys: ['Mod-b'] },
    )
    expect(() => toKeymap(register, taste)).toThrow('chord "Mod-b" is claimed by both "a" and "b"')
  })

  it('reads the chords from the taste, so a host may rebind them', () => {
    const register = registerOf({ id: 'a', command: noop, keys: ['Mod-b'] })
    const taste = applyTaste(register, { verbs: { a: { keys: ['Mod-j'] } } })
    const keyboard = composeKeyboard(register, taste)
    expect(keyboard.describe('Mod-b')).toEqual([])
    expect(keyboard.describe('Mod-j')).toEqual([{ layer: 'verbs', verb: 'a' }])
  })

  it('skips arg-verb chords without a collector, binds them with one', () => {
    const { register, taste } = dressed({ id: 'x', command: () => noop, args: [{ name: 'v' }], keys: ['Mod-q'] })
    expect(composeKeyboard(register, taste).describe('Mod-q')).toEqual([])
    const keyboard = composeKeyboard(register, taste, [], { collect: () => ({ v: 1 }) })
    expect(keyboard.describe('Mod-q')).toEqual([{ layer: 'verbs', verb: 'x' }])
  })
})

describe('expand', () => {
  it('curries an enumerable-domain verb into per-member forms with derived boolean reads', () => {
    const forms = expand(blocktypeVerb(schema))
    const h2 = forms.find((form) => form.id === 'blocktype:h2')!
    expect(h2.label).toBe('Heading 2')
    expect(h2.keys).toEqual(['Shift-Mod-2'])
    expect(h2.section).toBe('blocktype')
    // In a fresh doc the cursor stands in a paragraph:
    const paragraph = forms.find((form) => form.id === 'blocktype:paragraph')!
    expect(paragraph.read!(state)).toBe(true)
    expect(h2.read!(state)).toBe(false)
  })

  it('returns nothing for a verb without an enumerable domain', () => {
    expect(expand(fromCommands({ id: 'x', command: noop })[0]!)).toEqual([])
  })

  it("expands bare members into bare verbs, each available by its own command's dry run", () => {
    // A domain's capability is its values; what the members are called is the
    // host's. A plugin shipping `[{value:'head'},…]` must still expand — into
    // ordinary verbs with ordinary ids, carrying no taste to argue with.
    const [base] = fromCommands({
      id: 'table:row-region',
      command: (args) => (args.region === 'foot' ? noop : never),
      args: [{ name: 'region', domain: [{ value: 'head' }, { value: 'foot' }] }],
      read: () => 'foot',
    })
    const forms = expand(base!)
    expect(forms.map((form) => form.id)).toEqual(['table:row-region:head', 'table:row-region:foot'])
    expect(Object.keys(forms[0]!).sort()).toEqual(['enabled', 'id', 'read', 'run'])
    expect(forms[1]!.read!(state)).toBe(true)
    const register = compose([forms])
    const taste = applyTaste(register, { verbs: { 'table:row-region:foot': { label: 'Footer rows' } } })
    const controls = flat(project(register, state, taste, { includeUnavailable: true }))
    expect(controls.map((control) => control.label)).toEqual(['Head', 'Footer rows']) // derived, then named
    expect(controls.map((control) => control.enabled)).toEqual([false, true])
  })
})

describe('commandFor — the door, as a Command', () => {
  const entry: Capability = { id: 'x', command: (args) => (args.ok ? noop : never), args: [{ name: 'ok' }] }

  it('dry-runs without ever collecting', () => {
    const collect = vi.fn()
    expect(commandFor(registerOf(entry), 'x', { collect })(state)).toBe(true)
    expect(collect).not.toHaveBeenCalled()
  })

  it('answers the declared enabled on a dry run', () => {
    expect(commandFor(registerOf({ ...entry, enabled: () => false }), 'x', { collect: () => ({ ok: true }) })(state)).toBe(false)
  })

  it('collects on a real run and forwards the args', () => {
    const dispatch = vi.fn()
    expect(commandFor(registerOf(entry), 'x', { collect: () => ({ ok: true }) })(state, dispatch)).toBe(true)
  })

  it('no-ops honestly on a cancel, and refuses to ask without a collector', () => {
    const dispatch = vi.fn()
    expect(commandFor(registerOf(entry), 'x', { collect: () => null })(state, dispatch)).toBe(false)
    expect(commandFor(registerOf(entry), 'x')(state)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('runs given args through the door, which refuses what does not fit', () => {
    const register = registerOf({ id: 'n', command: () => noop, args: [{ name: 'n', type: 'number', required: true }] })
    expect(commandFor(register, 'n', { args: { n: 3 } })(state, vi.fn())).toBe(true)
    expect(commandFor(register, 'n', { args: { n: 'three' } })(state, vi.fn())).toBe(false)
  })

  it('refuses a withheld verb and an unknown id', () => {
    const register = registerOf({ id: 'w', command: never })
    expect(commandFor(register, 'w')(state, vi.fn())).toBe(false)
    expect(commandFor(register, 'nobody')(state)).toBe(false)
  })
})

describe('composeKeyboard — the stack of courts', () => {
  const { register, taste } = dressed({ id: 'a', command: noop, keys: ['Mod-b'] })
  const keyboard = composeKeyboard(register, taste, [
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

describe('a ProseMirror register, projected through verbr', () => {
  const blocktype = blocktypeVerb(schema)
  const register = compose([basicVerbs(schema), blocktype])
  const taste = applyTaste(register, { sections: [{ id: 'marks' }, { id: 'blocktype' }] })
  const controls = flat(project(register, state, taste, { includeUnavailable: true, platform: 'mac' }))
  const byId = (id: string) => controls.find((control) => control.id === id)!

  it('reads what each verb is off the declaration: a mark toggles, a domain chooses, an href is a value', () => {
    expect(byId('strong')).toMatchObject({ kind: 'toggle', as: 'button', label: 'Bold', icon: 'bold', pressed: false, shortcut: '⌘B', section: 'marks' })
    expect(byId('blocktype')).toMatchObject({ kind: 'choice', as: 'select', value: 'paragraph' })
    expect(byId('link')).toMatchObject({ kind: 'value', as: 'field' })
  })

  it("carries the command's dry run as availability", () => {
    // An empty selection in an empty doc: toggleMark stores the mark, so it may.
    expect(byId('strong').enabled).toBe(true)
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
