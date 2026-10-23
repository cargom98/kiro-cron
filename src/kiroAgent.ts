import * as vscode from "vscode";

/**
 * Bridge to the Kiro built-in agent (extension id `kiro.kiro-agent`).
 *
 * The execution path used here was verified empirically against Kiro IDE:
 *
 *   const { sessionId } = await executeCommand("kiroAgent.sessions.create");
 *   await executeCommand("kiroAgent.sessions.sendPrompt", sessionId, text);
 *
 * `sessions.sendPrompt` maps to the agent client's ACP `session_prompt`
 * request, i.e. it genuinely submits and runs the prompt. The UI-level
 * `kiroAgent.focusChatInput` command only stages text in the input box and
 * does NOT submit, so it is intentionally not used.
 */

const CMD_SESSION_CREATE = "kiroAgent.sessions.create";
const CMD_SESSION_SEND_PROMPT = "kiroAgent.sessions.sendPrompt";
const CMD_VIEW_SESSION = "kiroAgent.viewSession";

/**
 * Reveals a session in the sidebar. NOTE: this necessarily focuses/switches to
 * the session (the only reveal command available is
 * `kiroAgent.viewSession` -> `switchToSidebarSession`, which steals focus).
 * There is no non-focusing reveal, so this is opt-in and off by default.
 *
 * The Kiro agent does not expose any command to set a session title; it
 * auto-titles sessions from the first prompt. So no title is passed here.
 */
export async function revealSession(sessionId: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(CMD_VIEW_SESSION, sessionId);
  } catch {
    // Non-fatal: the prompt already ran; revealing just failed.
  }
}

export interface CreateSessionResult {
  sessionId?: string;
}

export interface RunResult {
  /** The session the prompt was sent to. */
  sessionId: string;
  /** True when a brand-new session was created for this run. */
  created: boolean;
}

/** Returns true if the required Kiro agent commands are registered. */
export async function isKiroAgentAvailable(): Promise<boolean> {
  const all = await vscode.commands.getCommands(true);
  return (
    all.includes(CMD_SESSION_CREATE) && all.includes(CMD_SESSION_SEND_PROMPT)
  );
}

/** Creates a fresh Kiro agent session, returning its id. */
export async function createSession(): Promise<string> {
  const result = (await vscode.commands.executeCommand(
    CMD_SESSION_CREATE
  )) as CreateSessionResult | undefined;
  const sessionId = result?.sessionId;
  if (!sessionId) {
    throw new Error(
      `${CMD_SESSION_CREATE} did not return a sessionId (got: ${JSON.stringify(
        result
      )})`
    );
  }
  return sessionId;
}

/** Sends `prompt` to an existing session. Throws if the session is invalid. */
export async function sendPrompt(
  sessionId: string,
  prompt: string
): Promise<void> {
  await vscode.commands.executeCommand(
    CMD_SESSION_SEND_PROMPT,
    sessionId,
    prompt
  );
}

/**
 * Submits `prompt` to the Kiro agent, reusing `existingSessionId` when given.
 *
 * Reuse strategy:
 *  - If `existingSessionId` is provided, try sending to it first. This keeps
 *    successive scheduled runs in the same conversation/session.
 *  - If that send fails (session was closed, the window reloaded, or the id is
 *    otherwise stale), fall back to creating a fresh session and retry, so a
 *    schedule self-heals rather than getting stuck on a dead session.
 *  - If no id is provided, create a new session.
 *
 * Returns the session used and whether it was newly created.
 */
export async function runPrompt(
  prompt: string,
  existingSessionId?: string
): Promise<RunResult> {
  if (existingSessionId) {
    try {
      await sendPrompt(existingSessionId, prompt);
      return { sessionId: existingSessionId, created: false };
    } catch (err) {
      // Stale/closed session — fall through to create a fresh one.
    }
  }

  const sessionId = await createSession();
  await sendPrompt(sessionId, prompt);
  return { sessionId, created: true };
}
