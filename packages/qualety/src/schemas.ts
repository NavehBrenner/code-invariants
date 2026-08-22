import { z } from "zod";

export const requiresSchema = z.array(z.string().min(1));

export const ruleMetaSchema = z.object({
  docs: z.object({
    description: z.string().min(1),
    url: z.string().optional(),
  }),
  requires: requiresSchema.optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  fixable: z.enum(["code", "whitespace"]).optional(),
});

export const functionSchema = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === "function",
);

export const ruleSchema = z.object({
  meta: ruleMetaSchema,
  create: functionSchema,
});

export const artifactProviderSchema = z.object({
  build: functionSchema,
});

export const pluginProvidesSchema = z.record(z.string().min(1), artifactProviderSchema);

export const pluginSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  rules: z.record(z.string().min(1), ruleSchema).optional(),
  provides: pluginProvidesSchema.optional(),
  configs: z.object({ recommended: z.unknown().optional() }).optional(),
});
