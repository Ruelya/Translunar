export * from "./protocol.generated.js";

import type {
  NotificationCatalog,
  RpcError,
  RpcMethodCatalog,
} from "./protocol.generated.js";

export const PROTOCOL_VERSION = 1;

export type EngineMethod = keyof RpcMethodCatalog;
export type EngineParams<Method extends EngineMethod> =
  RpcMethodCatalog[Method]["params"];
export type EngineResult<Method extends EngineMethod> =
  RpcMethodCatalog[Method]["result"];

export type EngineNotificationName = keyof NotificationCatalog;
export type EngineNotificationParams<Name extends EngineNotificationName> =
  NotificationCatalog[Name];

/** Client-to-engine stdin frame with the method-specific params attached. */
export interface EngineRequestFrame<
  Method extends EngineMethod = EngineMethod,
> {
  id: number;
  method: Method;
  params: EngineParams<Method>;
}

export interface EngineResponseFrame {
  kind: "response";
  id?: number | null;
  result?: unknown;
  error?: RpcError | null;
}

export interface EngineNotificationFrame {
  kind: "notification";
  method: string;
  params?: unknown;
}

export type AnyEngineFrame = EngineResponseFrame | EngineNotificationFrame;

export const ENGINE_METHODS = [
  "engine.initialize",
  "engine.shutdown",
  "project.create",
  "project.list",
  "project.get",
  "project.update",
  "project.archive",
  "document.import",
  "document.list",
  "document.remove",
  "document.export",
  "segment.list",
  "segment.update",
  "segment.updateSource",
  "segment.replace",
  "segment.confirm",
  "segment.lock",
  "tm.lookup",
  "tm.list",
  "tm.update",
  "tm.delete",
  "tm.import",
  "tm.export",
  "tm.pretranslate",
  "memory.create",
  "memory.list",
  "memory.attach",
  "memory.detach",
  "memory.update",
  "memory.rename",
  "memory.delete",
  "termbase.create",
  "termbase.list",
  "termbase.attach",
  "termbase.detach",
  "termbase.update",
  "termbase.import",
  "termbase.export",
  "term.add",
  "term.update",
  "term.delete",
  "term.list",
  "term.lookup",
  "qa.run",
  "qa.list",
  "qa.waive",
  "qa.fix.list",
  "qa.fix.apply",
  "qa.profile.get",
  "qa.profile.update",
  "ai.configure",
  "ai.status",
  "ai.profile.add",
  "ai.profile.list",
  "ai.profile.remove",
  "ai.assist.start",
  "ai.assist.status",
  "ai.assist.cancel",
  "ai.agent.start",
  "ai.agent.status",
  "ai.agent.review",
  "ai.agent.cancel",
] as const satisfies readonly EngineMethod[];

export const ENGINE_NOTIFICATIONS = [
  "notify.engine.ready",
  "notify.ai.agent.step",
] as const satisfies readonly EngineNotificationName[];

export function isEngineMethod(value: string): value is EngineMethod {
  return (ENGINE_METHODS as readonly string[]).includes(value);
}
