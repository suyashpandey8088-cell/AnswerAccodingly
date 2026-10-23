import { z } from "zod";

export const EmptyIpcArguments = z.tuple([]);

export function validateIpcArguments(args: unknown[]): [] {
  return EmptyIpcArguments.parse(args);
}
