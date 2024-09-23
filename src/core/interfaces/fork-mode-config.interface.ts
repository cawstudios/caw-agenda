import { ForkOptions } from "child_process";

export interface IForkModeConfig {
	forkHelper?: { path: string; options?: ForkOptions };
	forkedWorker?: boolean;
}