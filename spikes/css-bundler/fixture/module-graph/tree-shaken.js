import { cycleValue } from "./cycle-a.js";

export const treeShakenValue = `not referenced by the entry output:${typeof cycleValue}`;
