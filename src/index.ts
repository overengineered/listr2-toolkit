import { Toolkit, Worker, decorateLines } from "listr2-scheduler";
export { schedule, Worker } from "listr2-scheduler";

type RunOptions = {
  readonly reject?: boolean;
  readonly timestamp?: boolean;
  readonly cwd?: string;
};

type ReadOptions = {
  readonly reject?: boolean | "status" | "stderr";
  readonly cwd?: string;
};

type ToolkitLogger = {
  (...args: unknown[]): void;
  e(...args: unknown[]): void;
  v(...args: unknown[]): void;
};

declare module "listr2-scheduler" {
  interface Toolkit {
    log: ToolkitLogger;
    run(command: string, options?: RunOptions): Promise<number>;
    run(
      file: string,
      arguments: string[],
      options?: RunOptions
    ): Promise<number>;
    read(command: string, options?: ReadOptions): Promise<string>;
    read(
      file: string,
      arguments: string[],
      options?: ReadOptions
    ): Promise<string>;
  }
}

export function attach(worker: Worker): Toolkit {
  function print(target: NodeJS.WritableStream, args: unknown[]) {
    const { inspect } = require("node:util");
    const toStr = (it: unknown) => (typeof it === "string" ? it : inspect(it));
    decorateLines(worker, args.map(toStr).join(" ") + "\n", target);
  }

  function log(...args: unknown[]) {
    print(process.stdout, args);
  }
  log.e = (...args: unknown[]) => print(process.stderr, args);
  log.v = (...args: unknown[]) =>
    worker.printer === "verbose" && print(process.stderr, args);

  return {
    log,
    async run(
      command: string,
      options?: string[] | RunOptions,
      config?: RunOptions
    ) {
      const { execa, $ } = await import("execa");
      const settings: RunOptions | undefined =
        config != null ? config : !Array.isArray(options) ? options : undefined;
      const reject = settings?.reject ?? true;
      const verbose = worker.printer === "verbose";
      const timestamp = settings?.timestamp ?? true;
      const cwd = settings?.cwd;
      const sub = Array.isArray(options)
        ? execa(command, options, { reject, cwd })
        : $({ reject, cwd })(tsa(command));
      worker.reportStatus(
        Array.isArray(options) ? [command, ...options].join(" ") : command
      );
      if (verbose) {
        const cnfo = { getTag: worker.getTag, timestamp };
        sub.stdout && decorateLines(cnfo, sub.stdout, process.stdout);
        const cnfe = { getTag: () => `E${worker.getTag()}`, timestamp };
        sub.stderr && decorateLines(cnfe, sub.stderr, process.stderr);
      }
      const result = await sub;
      return result.exitCode;
    },
    async read(
      command: string,
      options?: string[] | ReadOptions,
      config?: ReadOptions
    ) {
      const { execa, $ } = await import("execa");
      const settings: ReadOptions | undefined =
        config != null ? config : !Array.isArray(options) ? options : undefined;
      const reject = [true, "status"].includes(settings?.reject ?? true);
      const all = !(settings?.reject === "stderr" || settings?.reject === true);
      const cwd = settings?.cwd;
      const sub = Array.isArray(options)
        ? execa(command, options, { reject, all, cwd })
        : $({ reject, all, cwd })(tsa(command));
      const result = await sub;
      if (!all) {
        if (result.stderr.trim().length > 0) {
          throw new Error(result.stderr);
        } else {
          return result.stdout ? result.stdout.trim() : "";
        }
      }
      return result.all ? result.all.trim() : "";
    },
  };
}

const verbosity = /^-(-verbose|.*v.*)$/;
export function selectPrinter(
  args: string[],
  forceVerbose?: unknown
): "verbose" | "vivid" {
  const verbose = forceVerbose || args.some((value) => value.match(verbosity));
  return verbose ? "verbose" : "vivid";
}

function tsa(value: string): TemplateStringsArray {
  return Object.defineProperty([value], "raw", { value }) as never;
}
