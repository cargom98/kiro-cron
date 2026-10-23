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

export interface CreateSessionResult {
  sessionId?: string;
}

/** Returns true if the required Kiro agent commands are registered. */
export async function isKiroAgentAvailable(): Promise<boolean> {
  const all = await vscode.commands.getCommands(true);
  return (
    all.includes(CMD_SESSION_CREATE) && all.includes(CMD_SESSION_SEND_PROMPT)
  );
}

/**
 * Creates a fresh Kiro agent session and submits `prompt` to it.
 * Resolves with the sessionId on success; throws on failure.
 */
export async function runPrompt(prompt: string): Promise<string> {
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

  await vscode.commands.executeCommand(
    CMD_SESSION_SEND_PROMPT,
    sessionId,
    prompt
  );

  return sessionId;
}
