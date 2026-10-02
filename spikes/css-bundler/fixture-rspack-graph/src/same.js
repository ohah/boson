import { sharedValue } from "./shared.js";

export const staticValue = "same-target";
export const dynamicValue = "same-target-dynamic";
export const cycleValue = () => sharedValue;
