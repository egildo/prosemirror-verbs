import { describe, it, expect } from 'vitest'
import { Schema } from 'prosemirror-model'
import { schema as basic } from 'prosemirror-schema-basic'
import { blocktypeVerb, expand, relations } from '../src/index.js'

// The register's structure. Facts (conjugation) are derived and never declared;
// opinions (which section a verb sits in) are taste, and verbr's to lay out.

const schema = new Schema({ nodes: basic.spec.nodes, marks: basic.spec.marks })

describe('relations — conjugation, derived', () => {
  const blocktype = blocktypeVerb(schema)

  it('finds base → form edges for an expanded domain verb', () => {
    const verbs = [blocktype, ...expand(blocktype)]
    const rel = relations(verbs)
    expect(rel.edges.length).toBe(blocktype.args![0]!.domain!.length)
    expect(rel.edges.every((edge) => edge.base === 'blocktype')).toBe(true)
    expect(rel.formsOf('blocktype').map((verb) => verb.id)).toContain('blocktype:h2')
    expect(rel.baseOf('blocktype:h2')!.id).toBe('blocktype')
  })

  it('finds nothing when the host never expanded — no graph over verbs that do not exist', () => {
    expect(relations([blocktype]).edges).toEqual([])
    expect(relations([blocktype]).formsOf('blocktype')).toEqual([])
  })

  it('is self-verifying: a form whose base was curated out truthfully has no base', () => {
    // The venue's actual case — `blocktype` is given manner:'none' and filtered
    // away before projection, leaving its forms behind as honest radio buttons.
    const formsOnly = expand(blocktype)
    const rel = relations(formsOnly)
    expect(rel.edges).toEqual([])
    expect(rel.baseOf('blocktype:h2')).toBeNull()
    // …and with no base there are no alternates, because alternation is a
    // *query over* conjugation, not a second edge that could survive it.
    expect(rel.alternatesOf('blocktype:h2')).toEqual([])
  })

  it('alternatesOf returns the siblings and excludes the verb itself', () => {
    const rel = relations([blocktype, ...expand(blocktype)])
    const alternates = rel.alternatesOf('blocktype:h2').map((verb) => verb.id)
    expect(alternates).toContain('blocktype:h1')
    expect(alternates).toContain('blocktype:paragraph')
    expect(alternates).not.toContain('blocktype:h2')
    expect(alternates.length).toBe(rel.formsOf('blocktype').length - 1)
  })

  it('describe answers for either end of an edge', () => {
    const rel = relations([blocktype, ...expand(blocktype)])
    expect(rel.describe('blocktype').length).toBe(rel.edges.length)
    expect(rel.describe('blocktype:h1')).toEqual([{ base: 'blocktype', form: 'blocktype:h1' }])
    expect(rel.describe('nobody')).toEqual([])
  })

  it('carries no audit, because derived facts do not compete', () => {
    expect('audit' in relations([blocktype])).toBe(false)
  })
})
