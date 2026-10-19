// Relations — what the register knows about itself.
//
// ProseMirror's Schema does not merely *list* nodes; it declares how they
// relate, through content expressions and groups. That nesting is half of what
// makes it a schema rather than a dictionary. This register listed verbs and
// declared no relations at all, so V1's analogy ran at half strength from the
// day it was written.
//
// The sort that keeps the repair disciplined (V14): **facts are derived,
// opinions are attributed**. Which group a verb sits in is an opinion — one
// editor groups by document object, another by task — so it stays an attribute
// in the cascade, where a host can disagree. Conjugation is not an opinion:
// `expand` curried one verb over its domain and minted the ids itself, so the
// edge is a fact, and this file recovers it by pure computation.
//
// Nothing is declared here. There is no `parent` field on an entry, and that is
// the point: a field can be wrong, and a derivation cannot.

import type { Verb } from './registry.js'

/** One conjugation edge: a base verb over a domain, and one of its forms. */
export interface RelationEdge {
  base: string
  form: string
}

/** The relations of a register, plus its sight — the shape every projection in
 * this package returns. */
export interface Relations {
  /** Every edge, in register order. */
  edges: RelationEdge[]
  /** A base verb's conjugated forms. */
  formsOf(id: string): Verb[]
  /** A form's base, or null — including for a form whose base isn't here. */
  baseOf(id: string): Verb | null
  /** A form's mutually exclusive siblings, itself excluded. */
  alternatesOf(id: string): Verb[]
  /** Every edge touching this verb, whichever end it sits on. */
  describe(id: string): RelationEdge[]
}

/// Derive the register's relations. Pure, inert, and cheap enough to call per
/// projection — a pass over the verbs and their first argument's domain.
///
/// **One stored edge kind.** Alternation is *implied* by conjugation — the forms
/// of one base are each other's alternatives, and the base's own readback proves
/// the exclusivity (it answers one member at a time, V7) — so it is a query over
/// the index, never a second edge in `edges`. The second copy is always the one
/// that goes stale.
///
/// **Self-verifying.** An edge is reported only when both ends are genuinely in
/// the register, so a form whose base was curated out of the composition
/// truthfully has no base, and a host that never called `expand` gets no edges
/// at all rather than a graph describing verbs that don't exist.
///
/// **Carried by the id convention** `expand` uses (`${base.id}:${member.value}`),
/// which is the one honest limit: a host exercising V10's sovereignty to re-key
/// entries before composing loses the edges. That is accepted over a `parent`
/// field stamped at expansion time, and the reason is the failure mode — a
/// broken convention *loses* an edge, a stale field *asserts a false one*.
/// Losing beats lying, and whoever did the re-keying is the one who can re-derive.
export function relations(verbs: readonly Verb[]): Relations {
  const byId = new Map(verbs.map((verb) => [verb.id, verb]))
  const edges: RelationEdge[] = []
  for (const verb of verbs) {
    const domain = verb.args?.[0]?.domain
    if (!Array.isArray(domain)) continue
    for (const member of domain) {
      const form = `${verb.id}:${member.value}`
      if (byId.has(form)) edges.push({ base: verb.id, form })
    }
  }

  const formsByBase = new Map<string, string[]>()
  const baseByForm = new Map<string, string>()
  for (const edge of edges) {
    const forms = formsByBase.get(edge.base)
    if (forms) forms.push(edge.form)
    else formsByBase.set(edge.base, [edge.form])
    baseByForm.set(edge.form, edge.base)
  }

  const resolve = (ids: string[]): Verb[] =>
    ids.map((id) => byId.get(id)).filter((verb): verb is Verb => !!verb)

  return {
    edges,
    formsOf: (id) => resolve(formsByBase.get(id) ?? []),
    baseOf: (id) => {
      const base = baseByForm.get(id)
      return base ? (byId.get(base) ?? null) : null
    },
    alternatesOf: (id) => {
      const base = baseByForm.get(id)
      if (!base) return []
      return resolve((formsByBase.get(base) ?? []).filter((form) => form !== id))
    },
    describe: (id) => edges.filter((edge) => edge.base === id || edge.form === id),
  }
}

// Deliberately no `audit()`. Audit exists where claims compete — two layers
// wanting one attribute, two keymaps wanting one chord — and derived facts do
// not compete. A mirror for something with no reflection would be symmetry
// rather than discipline. The condition that *is* worth auditing — a base verb
// and its forms both drawn as controls — is a question about a projection's
// output, not about these edges, and belongs to whoever draws.
