import { staticValue } from "@graph/same.js";
import { staticValue as repeatedStaticValue } from "@graph/same.js";
import { sharedValue } from "./shared.js";
import { packageValue } from "@spinon/exports-fixture";
import { virtualValue } from "./virtual-entry.js";
import { unusedValue } from "./tree-shaken.js";
import "./module-meta.js";
import "./side-effect.js";
export const loadDynamicOnly = () => import("./dynamic-only.js");
import "./screen.css";

export const graphState = `${staticValue}:${repeatedStaticValue}:${sharedValue}:${packageValue}:${virtualValue}`;
export { reExportedSharedValue } from "./re-export.js";
export const loadSame = () => import("@graph/same.js");
export const loadSameAgain = () => import("@graph/same.js");
export const loadLazy = () => import("./lazy.js");
