/**
 * Narrow Redis command port (roadmap §13.3).
 *
 * Stores depend only on this interface — never on a specific client type.
 * Do not expand into a large generic Redis abstraction.
 */

/**
 * Minimal command surface for audited scripts and index ops.
 * `command` is an uppercase Redis command name (e.g. `"EVAL"`, `"HGETALL"`).
 * `args` are string-encoded RESP arguments.
 */
export interface RedisCommandPort {
  send(command: string, args: readonly string[]): Promise<unknown>;
}

export type EvalHelper = {
  /**
   * Run a Lua script with KEYS / ARGV.
   * Uses EVALSHA when a SHA is known; falls back to EVAL on NOSCRIPT.
   */
  eval(
    script: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown>;
  /** Drop cached SHAs (e.g. after reconnect / FLUSHALL). */
  clearScriptCache(): void;
};

function isNoscript(err: unknown): boolean {
  if (err === null || typeof err !== "object") {
    const msg = typeof err === "string" ? err : "";
    return msg.toUpperCase().includes("NOSCRIPT");
  }
  const e = err as { message?: unknown; message_?: unknown };
  const msg = String(e.message ?? e.message_ ?? err);
  return msg.toUpperCase().includes("NOSCRIPT");
}

/**
 * Build an EVAL / EVALSHA helper over a {@link RedisCommandPort}.
 * SHAs are cached per script body string.
 */
export function createEvalHelper(port: RedisCommandPort): EvalHelper {
  const shaByScript = new Map<string, string>();

  async function evalRaw(
    script: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown> {
    const numKeys = String(keys.length);
    return port.send("EVAL", [script, numKeys, ...keys, ...args]);
  }

  async function evalSha(
    sha: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown> {
    const numKeys = String(keys.length);
    return port.send("EVALSHA", [sha, numKeys, ...keys, ...args]);
  }

  return {
    clearScriptCache() {
      shaByScript.clear();
    },

    async eval(
      script: string,
      keys: readonly string[],
      args: readonly string[],
    ): Promise<unknown> {
      let sha = shaByScript.get(script);
      if (sha === undefined) {
        // Best-effort SCRIPT LOAD; if unsupported, fall through to EVAL.
        try {
          const loaded = await port.send("SCRIPT", ["LOAD", script]);
          if (typeof loaded === "string" && loaded.length > 0) {
            sha = loaded;
            shaByScript.set(script, sha);
          }
        } catch {
          // Some restricted proxies disallow SCRIPT LOAD — use EVAL only.
        }
      }

      if (sha !== undefined) {
        try {
          return await evalSha(sha, keys, args);
        } catch (err) {
          if (!isNoscript(err)) throw err;
          shaByScript.delete(script);
          // Fall through to EVAL once.
        }
      }

      const result = await evalRaw(script, keys, args);
      return result;
    },
  };
}

/** Type guard for injected ports. */
export function isRedisCommandPort(value: unknown): value is RedisCommandPort {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RedisCommandPort).send === "function"
  );
}
