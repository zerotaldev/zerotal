import type { Job } from "./Job.ts";
import type { Batch, BatchOptions, SerializedJob } from "./Batch.ts";

type BatchDispatcher = {
  dispatchBatch(pending: PendingBatch): Promise<Batch>;
};

function toSerialized(job: Job | Job[]): SerializedJob[] {
  return (Array.isArray(job) ? job : [job]).map((j) => ({
    className: j.className,
    payload: j.payload(),
  }));
}

export class PendingBatch {
  private _name = "";
  private _thenJobs: SerializedJob[] = [];
  private _catchJobs: SerializedJob[] = [];
  private _finallyJobs: SerializedJob[] = [];

  constructor(
    private readonly _jobs: Job[],
    private readonly _dispatcher: BatchDispatcher,
  ) {}

  name(n: string): this {
    this._name = n;
    return this;
  }

  then(job: Job | Job[]): this {
    this._thenJobs.push(...toSerialized(job));
    return this;
  }
  catch(job: Job | Job[]): this {
    this._catchJobs.push(...toSerialized(job));
    return this;
  }
  finally(job: Job | Job[]): this {
    this._finallyJobs.push(...toSerialized(job));
    return this;
  }

  async dispatch(): Promise<Batch> {
    return this._dispatcher.dispatchBatch(this);
  }

  // ── Internal accessors (used by QueueManager) ──────────────────────────

  get jobs(): Job[] {
    return this._jobs;
  }
  get batchName(): string {
    return this._name;
  }
  get options(): BatchOptions {
    return {
      thenJobs: this._thenJobs.length ? this._thenJobs : undefined,
      catchJobs: this._catchJobs.length ? this._catchJobs : undefined,
      finallyJobs: this._finallyJobs.length ? this._finallyJobs : undefined,
    };
  }
}
