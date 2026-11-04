import { z } from "zod";
import type { NsErrorCategory, NsProgressEvent, NsQuestion } from "../core";

// Protocolo do `ns rpc`: uma mensagem JSON por linha (NDJSON) em cada sentido.
// Formato e regras: docs/adr/0003-ns-rpc-adapter-stdio.md.

export const PROTOCOL_VERSION = 1;

/** Categorias do núcleo, mais as do próprio protocolo. */
export type RpcErrorCategory = NsErrorCategory | "protocolo" | "interno";

export interface RpcErrorBody {
  category: RpcErrorCategory;
  message: string;
  hint?: string;
}

export type RpcOutgoing =
  | { type: "ready"; protocol: number; ops: string[] }
  | { type: "event"; id: string; event: NsProgressEvent }
  | { type: "ask"; id: string; ask: string; question: NsQuestion }
  | { type: "result"; id: string; result: unknown }
  | { type: "error"; id: string | null; error: RpcErrorBody };

const requestId = z.string().min(1);

const opMessage = z.object({
  type: z.literal("op"),
  id: requestId,
  op: z.string().min(1),
  input: z.unknown().optional(),
});

const answerMessage = z.object({
  type: z.literal("answer"),
  id: requestId,
  ask: z.string().min(1),
  value: z.boolean(),
});

export const incomingMessage = z.discriminatedUnion("type", [opMessage, answerMessage]);

export type RpcIncoming = z.infer<typeof incomingMessage>;

export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}
