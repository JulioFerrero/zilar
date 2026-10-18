import { Schema, SchemaAST, SchemaRepresentation } from 'effect';

// The model reads one plain JSON Schema per tool: no dialect marker, no shared
// definitions, no `null` branches for optional fields.
export function toolParameters(schema: Schema.Constraint): Record<string, unknown> {
  const document = SchemaRepresentation.toJsonSchemaDocument(
    SchemaRepresentation.toRepresentation(SchemaAST.toType(schema.ast)),
    { onExcessProperty: 'error', includeAnnotationKey: (key) => key === 'additionalProperties' },
  );
  const definitions = (document.schema.$defs ?? {}) as Record<string, unknown>;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    const record = value as Record<string, unknown>;
    const reference = record.$ref;
    if (typeof reference === 'string' && reference.startsWith('#/$defs/')) {
      const target = definitions[reference.slice('#/$defs/'.length)];
      if (target !== undefined) {
        return visit(target);
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (key !== '$defs' && key !== '$schema') {
        out[key] = visit(entry);
      }
    }
    const branches = out.anyOf;
    if (Array.isArray(branches) && branches.length === 2 && isNullSchema(branches[1])) {
      return branches[0];
    }
    if (out.maximum === Number.MAX_SAFE_INTEGER) {
      // Every JavaScript integer stops at this ceiling; naming it adds nothing
      // the model can act on.
      delete out.maximum;
    }
    return out;
  };
  return visit(document.schema) as Record<string, unknown>;
}

function isNullSchema(value: unknown): boolean {
  return (
    value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'null'
  );
}
