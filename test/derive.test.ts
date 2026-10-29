import { describe, it, expect } from 'vitest'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { schema as basic } from 'prosemirror-schema-basic'
import type { Command } from 'prosemirror-state'
import { compose } from '@egildo/verbr'
import { basicVerbs, insertVerbs, interiorTypes, markVerbs } from '../src/index.js'

// Derivation — the verb-Schema reading the noun-Schema. Pins: the sealed
// closure computes the right set and no more, insert-derivation honours it,
// and marks derive with the readback and gate the hand-written set had.

// A miniature of prosemirror-spreads' shape: a sealed container whose interior
// nouns are legal by the grammar and are nobody's to insert. `caption` holds
// inline content, so `text` is reachable both inside and outside — the case
// that would break a naive "everything under the container" rule.
const grid = new Schema({
  nodes: basic.spec.nodes.append({
    table: {
      content: 'caption? row+',
      group: 'block',
      authoring: { sealed: true, insert: false },
      toDOM: () => ['table', 0],
    },
    caption: { content: 'inline*', toDOM: () => ['caption', 0] },
    row: { content: 'cell+', toDOM: () => ['tr', 0] },
    cell: { content: 'text*', toDOM: () => ['td', 0] },
  }),
  marks: basic.spec.marks,
})

const names = (types: { name: string }[]) => types.map((type) => type.name).sort()

describe('interiorTypes — the sealed closure', () => {
  it('is empty for a schema that seals nothing', () => {
    expect(interiorTypes(basic)).toEqual([])
  })

  it('names every type reachable only through the container', () => {
    expect(names(interiorTypes(grid))).toEqual(['caption', 'cell', 'row'])
  })

  it('leaves alone what lives outside too, and the container itself', () => {
    const interior = names(interiorTypes(grid))
    // `text`, `image` and `hard_break` are in the caption *and* in every
    // paragraph — a path to them avoids the table, so they are not interior.
    for (const shared of ['text', 'image', 'hard_break', 'paragraph']) {
      expect(interior, shared).not.toContain(shared)
    }
    // The container is reachable from the doc, so it is never interior to
    // itself — which is why sealing a subtree does not silently seal its own
    // insert verb (and why `insert: false` is a separate field).
    expect(interior).not.toContain('table')
  })
})

describe('insertVerbs honours authoring', () => {
  it('derives nothing for a sealed interior, nor for a noun that declares its own', () => {
    const ids = insertVerbs(grid).map((verb) => verb.id)
    for (const gone of ['insert:table', 'insert:caption', 'insert:row', 'insert:cell']) {
      expect(ids, gone).not.toContain(gone)
    }
    // Everything else the schema offers still derives.
    expect(ids).toContain('insert:paragraph')
    expect(ids).toContain('insert:blockquote')
    expect(insertVerbs(grid)).toHaveLength(insertVerbs(basic).length)
  })

  it('uses a declared factory in place of createAndFill', () => {
    const marked: Command = () => true
    const schema = new Schema({
      nodes: basic.spec.nodes.append({
        widget: { group: 'block', authoring: { insert: () => marked }, toDOM: () => ['div'] },
      }),
      marks: basic.spec.marks,
    })
    const widget = insertVerbs(schema).find((verb) => verb.id === 'insert:widget')!
    expect(widget.run(EditorState.create({ schema }))).toBe(marked)
  })

  it('the hazard it closes: a bare cell was insertable into a row', () => {
    // Recorded rather than described. Before the hint, `insertPoint` found a
    // legal spot for a `cell` inside a `row` — the grammar's answer, not the
    // owner's — and a derived verb put one there. In the venue on 2026-07-29
    // that left a two-column table with a three-cell row. Here the same
    // derivation, run against a schema that declares nothing, still says yes;
    // the sealed one no longer offers the verb at all.
    const open = new Schema({ nodes: grid.spec.nodes.update('table', { ...grid.spec.nodes.get('table'), authoring: undefined }) })
    const cell = insertVerbs(open).find((verb) => verb.id === 'insert:cell')!
    const doc = open.node('doc', null, [
      open.node('table', null, [open.node('row', null, [open.node('cell')])]),
    ])
    const state = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(3)) })
    expect(cell.enabled).toBeTypeOf('function')
    expect((cell.enabled as (s: EditorState) => boolean)(state)).toBe(true)
    expect(insertVerbs(grid).find((verb) => verb.id === 'insert:cell')).toBeUndefined()
  })
})

describe('markVerbs — one capability per mark', () => {
  const state = EditorState.create({ schema: basic })

  it('derives a toggle with a boolean readback for a mark with no required attrs', () => {
    const strong = markVerbs(basic).find((verb) => verb.id === 'strong')!
    expect(strong.args).toBeUndefined()
    expect(strong.read!(state)).toBe(false)
    expect(strong.run(state)(state, undefined)).toBe(true)
    // A bare command's dry run is its availability.
    expect((strong.enabled as (s: EditorState) => boolean)(state)).toBe(true)
    // Bare capability: nothing here names it.
    expect(Object.keys(strong).sort()).toEqual(['enabled', 'id', 'read', 'run'])
  })

  it('derives an arg-verb for a mark carrying a required attribute', () => {
    const link = markVerbs(basic).find((verb) => verb.id === 'link')!
    expect(link.args!.map((arg) => arg.name)).toEqual(['href'])
    // schema-basic writes `validate: "string"` on href — the closest the
    // noun-Schema comes to declaring an argument's type.
    expect(link.args![0]!.type).toBe('text')
    // Optional, because no address means no link: the set removes it.
    expect(link.args![0]!.required).toBeUndefined()
    expect((link.enabled as (s: EditorState) => boolean)(state)).toBe(true)
    expect(link.read!(state)).toBeNull()
  })

  it("an attr readback answers the value you stand in, reading forward at a boundary", () => {
    const link = markVerbs(basic).find((verb) => verb.id === 'link')!
    const mark = basic.marks.link.create({ href: 'https://example.org' })
    const doc = basic.node('doc', null, [
      basic.node('paragraph', null, [basic.text('go '), basic.text('there', [mark])]),
    ])
    const inside = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(6)) })
    expect(link.read!(inside)).toBe('https://example.org')
    // At the link's start boundary the marks *before* the cursor are the
    // unlinked "go " — reading backwards would answer null.
    const boundary = EditorState.create({ doc, selection: TextSelection.create(doc, 4, 9) })
    expect(link.read!(boundary)).toBe('https://example.org')
  })

  it('yields nothing for a schema with no marks', () => {
    const bare = new Schema({ nodes: { doc: { content: 'p+' }, p: { content: 'text*' }, text: {} } })
    expect(markVerbs(bare)).toEqual([])
  })

  it('reaches every mark, not only the four somebody thought about', () => {
    const extended = new Schema({
      nodes: basic.spec.nodes,
      marks: basic.spec.marks.append({ underline: { toDOM: () => ['u', 0] } }),
    })
    const ids = basicVerbs(extended).map((verb) => verb.id)
    expect(ids).toContain('underline')
    // The familiar four keep their familiar order; the newcomer follows.
    expect(ids).toEqual(['strong', 'em', 'code', 'link', 'underline'])
    // …undressed, because nobody knows what to call it. The naming layer will.
    expect(basicVerbs(extended).find((verb) => verb.id === 'underline')!.label).toBeUndefined()
  })

  it('basicVerbs is markVerbs dressed — same capability, conventional taste', () => {
    const [strong] = compose([basicVerbs(basic)]).verbs
    expect(strong!.id).toBe('strong')
    expect(strong!.label).toBe('Bold')
    expect(strong!.icon).toBe('bold')
    expect(strong!.keys).toEqual(['Mod-b'])
    expect(strong!.section).toBe('marks')
    // The one thing the schema cannot say: an href is a URL, not a string.
    const link = basicVerbs(basic).find((verb) => verb.id === 'link')!
    expect(link.args![0]).toEqual({ name: 'href', label: 'URL', type: 'url' })
    expect(link.run(state, { href: 'https://x.org' })).toBeTypeOf('function')
  })
})

describe('an attribute mark is set, never toggled', () => {
  const link = markVerbs(basic).find((verb) => verb.id === 'link')!
  const mark = basic.marks.link.create({ href: 'https://old.org' })
  const doc = basic.node('doc', null, [
    basic.node('paragraph', null, [basic.text('go '), basic.text('there', [mark]), basic.text(' now')]),
  ])
  // Runs the verb and hands back the state it leaves behind.
  const apply = (state: EditorState, args: Record<string, unknown>) => {
    let next = state
    const ran = link.run(state, args)(state, (tr) => (next = state.apply(tr)))
    return { ran, next }
  }
  const hrefs = (state: EditorState) => {
    const found: [string, string][] = []
    state.doc.descendants((node) => {
      const on = basic.marks.link.isInSet(node.marks)
      if (node.isText && on) found.push([node.text!, on.attrs.href as string])
    })
    return found
  }

  it('rewrites the whole link the cursor stands in — the bug a toggle had', () => {
    const inside = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(6)) })
    const { ran, next } = apply(inside, { href: 'https://new.org' })
    expect(ran).toBe(true)
    expect(hrefs(next)).toEqual([['there', 'https://new.org']])
    expect(link.read!(next)).toBe('https://new.org')
  })

  it('sets a selection, linking what was not linked', () => {
    const range = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 3) })
    expect(hrefs(apply(range, { href: 'https://new.org' }).next)).toEqual([
      ['go', 'https://new.org'],
      ['there', 'https://old.org'],
    ])
  })

  it('takes the mark away when given no value', () => {
    const inside = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(6)) })
    expect(hrefs(apply(inside, {}).next)).toEqual([])
  })

  it('outside any link, sets what you type next, and has nothing to remove', () => {
    const outside = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(2)) })
    const { next } = apply(outside, { href: 'https://new.org' })
    expect(hrefs(next)).toEqual([['there', 'https://old.org']])
    expect(link.read!(next)).toBe('https://new.org')
    expect(apply(outside, {}).ran).toBe(false)
  })
})
