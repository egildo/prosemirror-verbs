import { describe, it, expect } from 'vitest'
import { Schema } from 'prosemirror-model'
import { schema as basic } from 'prosemirror-schema-basic'
import type { Command } from 'prosemirror-state'
import {
  blocktypeVerb, expand, composeVerbs, relations, controlTree, controlSpecs, isGroup,
} from '../src/index.js'
import type { ControlGroup, ControlSpec, TreeItem, VerbEntry } from '../src/index.js'

// The register's structure. Facts (conjugation) are derived and never declared;
// opinions (which section a verb sits in) are attributed and arrive as the
// projection's parameter. Pins for both, and for the flat strip staying exactly
// what it was once it became a view of the tree.

const schema = new Schema({ nodes: basic.spec.nodes, marks: basic.spec.marks })
const noop: Command = () => true

describe('relations — conjugation, derived', () => {
  const blocktype = blocktypeVerb(schema)

  it('finds base → form edges for an expanded domain verb', () => {
    const verbs = composeVerbs(blocktype, expand(blocktype))
    const rel = relations(verbs)
    expect(rel.edges.length).toBe(blocktype.args![0]!.domain!.length)
    expect(rel.edges.every((edge) => edge.base === 'blocktype')).toBe(true)
    expect(rel.formsOf('blocktype').map((verb) => verb.id)).toContain('blocktype:h2')
    expect(rel.baseOf('blocktype:h2')!.id).toBe('blocktype')
  })

  it('finds nothing when the host never expanded — no graph over verbs that do not exist', () => {
    expect(relations(composeVerbs(blocktype)).edges).toEqual([])
    expect(relations(composeVerbs(blocktype)).formsOf('blocktype')).toEqual([])
  })

  it('is self-verifying: a form whose base was curated out truthfully has no base', () => {
    // The venue's actual case — `blocktype` is given manner:'none' and filtered
    // away before projection, leaving its forms behind as honest radio buttons.
    const formsOnly = composeVerbs(expand(blocktype))
    const rel = relations(formsOnly)
    expect(rel.edges).toEqual([])
    expect(rel.baseOf('blocktype:h2')).toBeNull()
    // …and with no base there are no alternates, because alternation is a
    // *query over* conjugation, not a second edge that could survive it.
    expect(rel.alternatesOf('blocktype:h2')).toEqual([])
  })

  it('alternatesOf returns the siblings and excludes the verb itself', () => {
    const rel = relations(composeVerbs(blocktype, expand(blocktype)))
    const alternates = rel.alternatesOf('blocktype:h2').map((verb) => verb.id)
    expect(alternates).toContain('blocktype:h1')
    expect(alternates).toContain('blocktype:paragraph')
    expect(alternates).not.toContain('blocktype:h2')
    expect(alternates.length).toBe(rel.formsOf('blocktype').length - 1)
  })

  it('describe answers for either end of an edge', () => {
    const rel = relations(composeVerbs(blocktype, expand(blocktype)))
    expect(rel.describe('blocktype').length).toBe(rel.edges.length)
    expect(rel.describe('blocktype:h1')).toEqual([{ base: 'blocktype', form: 'blocktype:h1' }])
    expect(rel.describe('nobody')).toEqual([])
  })

  it('carries no audit, because derived facts do not compete', () => {
    expect('audit' in relations(composeVerbs(blocktype))).toBe(false)
  })
})

describe('controlTree — sections, nested', () => {
  const button = (id: string, group: string): VerbEntry => ({ id, icon: '•', command: noop, group })
  const verbs = composeVerbs(
    button('table:add-row', 'table/rows'),
    button('table:del-row', 'table/rows'),
    button('table:add-col', 'table/cols'),
    button('table:caption', 'table'),
    button('undo', 'history'),
  )
  const GROUPS = [
    { id: 'table', label: 'Table', icon: '⊞' },
    { id: 'table/rows' },
    { id: 'table/cols', label: 'Columns' },
    { id: 'history' },
  ]

  const ids = (items: TreeItem[]): unknown[] =>
    items.map((item) => (isGroup(item) ? [item.group, ids(item.items)] : (item as ControlSpec).id))

  it('nests from a slash path in the section id', () => {
    const { items } = controlTree(verbs, GROUPS)
    expect(ids(items)).toEqual([
      ['table', ['table:caption', ['table/rows', ['table:add-row', 'table:del-row']], ['table/cols', ['table:add-col']]]],
      ['history', ['undo']],
    ])
  })

  it('names a section, or derives one from the last path segment', () => {
    const { items } = controlTree(verbs, GROUPS)
    const table = items[0] as { label: string; short?: string; items: TreeItem[] }
    expect(table.label).toBe('Table')
    expect(table.icon).toBe('⊞')
    // 'table/rows' declared no label: the last segment, humanized — the sibling
    // of how an unnamed verb gets called after its id.
    expect((table.items[1] as { label: string }).label).toBe('Rows')
    expect((table.items[2] as { label: string }).label).toBe('Columns')
  })

  it('nests from an explicit parent too, and treats an undeclared parent as a root', () => {
    const { items } = controlTree(verbs, [
      { id: 'history' },
      { id: 'table/rows', parent: 'history' },
      { id: 'table/cols' }, // 'table' undeclared ⇒ a root, not a dropped section
    ])
    expect(ids(items)).toEqual([
      ['history', ['undo', ['table/rows', ['table:add-row', 'table:del-row']]]],
      ['table/cols', ['table:add-col']],
    ])
  })

  it('omits a section with nothing in it, and one whose children are all empty', () => {
    const { items } = controlTree(composeVerbs(button('undo', 'history')), [
      { id: 'table' },
      { id: 'table/rows' },
      { id: 'history' },
    ])
    expect(ids(items)).toEqual([['history', ['undo']]])
  })

  it('shows only declared sections — curation by omission, as the flat strip always did', () => {
    const { items } = controlTree(verbs, [{ id: 'history' }])
    expect(ids(items)).toEqual([['history', ['undo']]])
  })
})

describe('controlTree — which face counts', () => {
  const noIcon = (id: string, group: string): VerbEntry => ({ id, label: id, command: noop, group })
  const verbs = composeVerbs(
    { id: 'strong', icon: '•', command: noop, group: 'marks' },
    noIcon('insert:image', 'marks'),
  )

  it('drops a faceless verb by default — a strip needs a picture', () => {
    const { items } = controlTree(verbs, ['marks'])
    expect((items[0] as ControlGroup).items.map((item) => (item as ControlSpec).id)).toEqual(['strong'])
  })

  it('keeps it when the face is words — a palette reaching what a strip cannot', () => {
    // V15 promised an unpromoted verb stays "reachable by chord and by palette".
    // Until this option there was no way for a palette to reach it: the tree
    // could not produce the item at all.
    const { items } = controlTree(verbs, ['marks'], { face: 'words' })
    const drawn = (items[0] as ControlGroup).items as ControlSpec[]
    expect(drawn.map((spec) => spec.id)).toEqual(['strong', 'insert:image'])
    // Still deduced, not declared: no readback, so it is an action.
    expect(drawn[1]!.kind).toBe('action')
    expect(drawn[1]!.label).toBe('insert:image')
  })

  it('leaves a faceless *choice* alone either way — its shape never needed a picture', () => {
    const choice = composeVerbs({
      id: 'blocktype',
      command: () => noop,
      group: 'marks',
      args: [{ name: 'blocktype', domain: [{ value: 'p' }] }],
    } as VerbEntry)
    for (const face of ['icon', 'words'] as const) {
      const { items } = controlTree(choice, ['marks'], { face })
      expect(((items[0] as ControlGroup).items[0] as ControlSpec).kind).toBe('choice')
    }
  })
})

describe('controlTree.audit — a host that forgot to choose', () => {
  const blocktype = blocktypeVerb(schema)

  it('reports a base verb drawn alongside its own forms', () => {
    // Two equally valid renderings of one declaration — a select, or a row of
    // radio buttons. Showing both is a curation the host forgot, and until now
    // nothing said so.
    const dressed = composeVerbs(
      { ...blocktype, group: 'blocktype' },
      expand({ ...blocktype, group: 'blocktype' }).map((form) => ({ ...form, icon: form.icon ?? 'H' })),
    )
    const [conflict, ...rest] = controlTree(dressed, ['blocktype']).audit()
    expect(rest).toEqual([])
    expect(conflict!.base).toBe('blocktype')
    expect(conflict!.forms).toContain('blocktype:h1')
  })

  it('is silent when only the forms are drawn — the venue is not in error', () => {
    const formsOnly = composeVerbs(
      expand(blocktype).map((form) => ({ ...form, group: 'blocktype', icon: form.icon ?? 'H' })),
    )
    expect(controlTree(formsOnly, ['blocktype']).audit()).toEqual([])
  })
})

describe('controlSpecs — the flat strip is a view of the tree', () => {
  const button = (id: string, group: string): VerbEntry => ({ id, icon: '•', command: noop, group })
  const verbs = composeVerbs(
    button('a', 'one'),
    button('b', 'one/deep'),
    button('c', 'two'),
  )

  it('walks depth-first and separates only the top-level sections', () => {
    const flat = controlSpecs(verbs, [{ id: 'one' }, { id: 'one/deep' }, { id: 'two' }])
    expect(flat.map((item) => ('separator' in item ? 'SEP' : item.id))).toEqual(['a', 'b', 'SEP', 'c'])
  })

  it('takes a bare string list exactly as before', () => {
    const flat = controlSpecs(verbs, ['one', 'two'])
    expect(flat.map((item) => ('separator' in item ? 'SEP' : item.id))).toEqual(['a', 'SEP', 'c'])
  })
})
