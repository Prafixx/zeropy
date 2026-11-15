// Public surface of the kit for scene modules.
export { defineScene } from './stage';
export type { Stage, SceneInstance } from './stage';
export { variableBoxes } from './actors/variable-boxes';
export type { BoxItem, BoxVar, CallFrame, Feed, Pick, SyncHints, VariableBoxes } from './actors/variable-boxes';
export { programRun } from './actors/program-run';
export type { ProgramRun, RunFrame } from './actors/program-run';
