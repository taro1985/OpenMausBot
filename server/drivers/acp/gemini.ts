// Gemini CLI harness support — Google's `gemini` CLI over ACP stdio
// (`gemini --experimental-acp`). Rides the generic runtime in acp/core.ts.
//
// RETIRED FROM THE DEFAULT FLEET: Google stopped serving Gemini CLI requests
// for the free/Pro/Ultra tiers on 2026-06-18 and pointed everyone at the
// Antigravity CLI (see drivers/antigravity.ts), so this only reaches a model
// on an enterprise licence. Kept registered for exactly that case — add
// {"instances": {"gemini": {"driver": "geminiAgent"}}} to config.json.
//
// Auth is intentionally lenient (authFailure "continue"): the Gemini CLI
// commonly runs off an ambient login — an OAuth session from a prior
// `gemini` run (~/.gemini/oauth_creds.json) or GEMINI_API_KEY in the env —
// so we attempt the advertised authenticate method but never hard-fail the
// turn on it, unlike Grok's subscription-bound cached_token.
//
// NOTE: untested against a live `gemini` CLI on this machine (not installed);
// the ACP flag + auth method ids follow the published Gemini CLI ACP contract
// and should be re-verified end-to-end once the CLI is present.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { createAcpDriver, type AcpSupport } from "./core.ts";

// Prefer Vertex AI, then explicit key method, then personal OAuth — but fall
// back to whatever the CLI advertises so a new method id still works.
const AUTH_PREFERENCE = ["vertex-ai", "gemini-api-key", "oauth-personal"];

const support: AcpSupport = {
  driverKind: "geminiAgent",
  displayName: "Gemini",
  models: {
    default: "gemini-3.8-flash",
    options: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Vertex AI)" },
      { id: "gemini-3.8-flash-cyber", label: "Gemini 3.8 Flash Cyber" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
  defaultCli: "gemini",
  nativeSource: "gemini.acp",
  loginNote: "Gemini CLI is not signed in — run `gemini` once to log in, or set GEMINI_API_KEY / Vertex AI ADC",

  spawnArgs: (_config, turn) => ["--experimental-acp", ...(turn.model ? ["-m", turn.model] : [])],

  transformEnv: (env) => {
    // Automatically inject Vertex AI configuration for Gemini 3.8 / 2.5
    env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    env.GOOGLE_CLOUD_PROJECT = env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0967206367";
    env.GOOGLE_CLOUD_LOCATION = env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "global";
  },

  pickAuthMethod: (methods) => {
    const ids = methods.map((m) => m.id).filter((id): id is string => typeof id === "string");
    for (const pref of AUTH_PREFERENCE) if (ids.includes(pref)) return pref;
    return ids[0] ?? null;
  },
  authFailure: "continue",

  isAuthenticated: (env) =>
    Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENAI_USE_VERTEXAI || process.env.GOOGLE_GENAI_USE_VERTEXAI) ||
    existsSync(join(homedir(), ".gemini", "oauth_creds.json")) ||
    existsSync(join(homedir(), ".config", "gcloud", "application_default_credentials.json")),

  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
  defaultFullAuto: true,
};

export const GeminiAgentDriver = createAcpDriver(support);
