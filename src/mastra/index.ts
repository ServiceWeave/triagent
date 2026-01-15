import { Mastra } from "@mastra/core";
import { createDebuggerAgent, buildIncidentPrompt, InvestigationResultSchema } from "./agents/debugger.js";
import type { Config } from "../config.js";

let mastraInstance: Mastra | null = null;

export async function createMastraInstance(config: Config): Promise<Mastra> {
  if (mastraInstance) {
    return mastraInstance;
  }

  const debuggerAgent = await createDebuggerAgent(config);

  mastraInstance = new Mastra({
    agents: {
      debugger: debuggerAgent,
    },
  });

  return mastraInstance;
}

export function getMastra(): Mastra {
  if (!mastraInstance) {
    throw new Error("Mastra not initialized. Call createMastraInstance first.");
  }
  return mastraInstance;
}

export function getDebuggerAgent() {
  const mastra = getMastra();
  return mastra.getAgent("debugger");
}

export { createDebuggerAgent, buildIncidentPrompt, InvestigationResultSchema };
export type { IncidentInput, InvestigationResult } from "./agents/debugger.js";
