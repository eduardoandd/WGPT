import { AgentConfig } from "../core/types.js";
import { eduardo } from "./eduardo.js";
import { renan } from "./renan.js";
import { demo } from "./demo.js";

export const AGENT_PROFILES: Record<string, AgentConfig> = {
    eduardo,
    renan,
    demo,
};
