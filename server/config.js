// Watson configuration. Values come from .env in the project root (created on
// first run) and can be overridden by real environment variables.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
const ENV_FILE = path.join(ROOT, '.env');

fs.mkdirSync(DATA_DIR, { recursive: true });

// First run: create .env with a random access token so Watson is never
// reachable without one (it can run commands on this machine).
if (!fs.existsSync(ENV_FILE)) {
  const token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(ENV_FILE, [
    '# Watson settings. Restart Watson after changing these.',
    '# Anyone with this token can control Watson. Keep it private.',
    `WATSON_TOKEN=${token}`,
    'WATSON_PORT=8787',
    '# The project Watson codes in by default (a WSL path).',
    `WATSON_PROJECT_DIR=${path.join(os.homedir(), 'projects', 'wolf-hall-app')}`,
    'WATSON_MODEL=claude-opus-5-5',
    '# low | medium | high | xhigh | max',
    'WATSON_EFFORT=high',
    '# default | acceptEdits | auto  (risky actions always need your OK either way)',
    'WATSON_PERMISSION_MODE=acceptEdits',
    '# Optional: stop a single request once it has cost this many US dollars.',
    'WATSON_MAX_BUDGET_USD=',
    '# Optional: set to use an Anthropic API key instead of your Claude Code login.',
    '# ANTHROPIC_API_KEY=',
    '',
  ].join('\n'), { mode: 0o600 });
}
process.loadEnvFile(ENV_FILE);

const env = (k, d) => (process.env[k] && process.env[k].trim()) || d;

export const config = {
  token: env('WATSON_TOKEN'),
  port: Number(env('WATSON_PORT', '8787')),
  // Bind to loopback only. Remote access goes through a tunnel, never an open port.
  host: '127.0.0.1',
  projectDir: env('WATSON_PROJECT_DIR', path.join(os.homedir(), 'projects', 'wolf-hall-app')),
  model: env('WATSON_MODEL', 'claude-opus-5-5'),
  effort: env('WATSON_EFFORT', 'high'),
  permissionMode: env('WATSON_PERMISSION_MODE', 'acceptEdits'),
  maxBudgetUsd: env('WATSON_MAX_BUDGET_USD') ? Number(env('WATSON_MAX_BUDGET_USD')) : undefined,
  // How long Watson waits for a yes/no before treating it as "no".
  approvalTimeoutMs: 10 * 60 * 1000,
  // Trust mode (default on, per Horace 2026-10-25): only sending messages to other
  // people and deleting things need a tap. Set WATSON_TRUST=off for the full gate.
  trust: env('WATSON_TRUST', 'on') !== 'off',
  // ElevenLabs voice. The key is read from ELEVENLABS_API_KEY or from keyFile
  // (shared with the Wolf Hall sound-effects work), so it isn't copied into .env.
  tts: {
    keyFile: env('ELEVENLABS_KEY_FILE', path.join(os.homedir(), '.config', 'wolf-hall-secrets', 'elevenlabs.env')),
    voiceId: env('WATSON_TTS_VOICE', 'EXAVITQu4vr4xnSDxMaL'), // Sarah: mature, warm, reassuring (the Oracle, 2026-10-25; was Brian)
    model: env('WATSON_TTS_MODEL', 'eleven_flash_v2_5'), // fast, and half the characters of the full models
  },
};

if (!config.token || config.token.length < 16) {
  throw new Error('WATSON_TOKEN in .env is missing or too short (need 16+ characters).');
}
if (!['default', 'acceptEdits', 'auto'].includes(config.permissionMode)) {
  throw new Error(`WATSON_PERMISSION_MODE must be default, acceptEdits or auto (got "${config.permissionMode}").`);
}
