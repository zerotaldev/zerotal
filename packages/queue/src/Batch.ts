export type SerializedJob = { className: string; payload: Record<string, unknown> };

export interface BatchOptions {
  thenJobs?: SerializedJob[] | undefined;
  catchJobs?: SerializedJob[] | undefined;
  finallyJobs?: SerializedJob[] | undefined;
}

export interface BatchRecord {
  id: string;
  name: string;
  totalJobs: number;
  pendingJobs: number;
  failedJobs: number;
  failedJobIds: number[];
  options: BatchOptions;
  createdAt: string;
  finishedAt: string | undefined;
}

export class Batch {
  constructor(private readonly _r: BatchRecord) {}

  get id(): string {
    return this._r.id;
  }
  get name(): string {
    return this._r.name;
  }
  get totalJobs(): number {
    return this._r.totalJobs;
  }
  get pendingJobs(): number {
    return this._r.pendingJobs;
  }
  get failedJobs(): number {
    return this._r.failedJobs;
  }
  get failedJobIds(): number[] {
    return this._r.failedJobIds;
  }
  get options(): BatchOptions {
    return this._r.options;
  }
  get createdAt(): string {
    return this._r.createdAt;
  }
  get finishedAt(): string | undefined {
    return this._r.finishedAt;
  }

  finished(): boolean {
    return this._r.finishedAt !== undefined;
  }
  failed(): boolean {
    return this._r.failedJobs > 0;
  }
  progress(): number {
    return this._r.totalJobs === 0
      ? 1
      : (this._r.totalJobs - this._r.pendingJobs) / this._r.totalJobs;
  }
}
