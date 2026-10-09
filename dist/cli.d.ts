#!/usr/bin/env node
import { type PipelineDB } from './index.js';
export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
export declare function usage(): void;
export declare function createDemoDB(): PipelineDB;
export declare function main(): Promise<void>;
