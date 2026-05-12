#!/usr/bin/env tsx
// scripts/agent-x.ts — terminal client for the DataFlow GTM Campaign Builder ("Agent X").
//
// Drives the same /api/agent/conversations endpoints the web UI uses, so the
// full chat -> approve -> preview -> launch flow is available from the
// terminal. Pass --model claude-sonnet-4-6 (or any other claude-* model) to
// route the planner's LLM call through Anthropic instead of the default
// Azure gpt-5-mini.
//
// Usage:
//   npx tsx scripts/agent-x.ts new   "<prompt>"       [--model <id>]
//   npx tsx scripts/agent-x.ts turn  <id> "<message>" [--model <id>]
//   npx tsx scripts/agent-x.ts get   <id>
//   npx tsx scripts/agent-x.ts preview <id>
//   npx tsx scripts/agent-x.ts launch  <id>           [--limit <n>]
//   npx tsx scripts/agent-x.ts list
//   npx tsx scripts/agent-x.ts delete <id>
//
// Env:
//   DATAFLOW_BASE_URL  default https://dataflow-pi.vercel.app
//   DATAFLOW_API_KEY   bearer token for /api/* (already in .env.local)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadEnvLocal() {
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* no .env.local — fine */
  }
}
loadEnvLocal();

const BASE_URL = process.env.DATAFLOW_BASE_URL || 'https://dataflow-pi.vercel.app';
const API_KEY = process.env.DATAFLOW_API_KEY || '';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h.Authorization = `Bearer ${API_KEY}`;
  return h;
}

async function request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || text.slice(0, 400) || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
  }
  return data;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = 'true';
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function summarizePlan(plan: any): string {
  if (!plan || typeof plan !== 'object') return '';
  const lines: string[] = [];
  lines.push(`  plan: ${plan.name ?? '(unnamed)'}  source=${plan.source ?? '?'}`);
  if (plan.rationale) lines.push(`  rationale: ${String(plan.rationale).slice(0, 200)}`);
  if (Array.isArray(plan.stages)) {
    plan.stages.forEach((stage: any, i: number) => {
      const stepCount = Array.isArray(stage?.steps) ? stage.steps.length : 0;
      lines.push(`  stage ${i + 1}: ${stage?.title ?? '(no title)'}  (${stepCount} step${stepCount === 1 ? '' : 's'})`);
      if (Array.isArray(stage?.steps)) {
        for (const step of stage.steps) {
          lines.push(`    - ${step?.type ?? '?'}`);
        }
      }
    });
  }
  return lines.join('\n');
}

function printChatResponse(data: any) {
  console.log(`conversation: ${data.conversationId}`);
  if (data.title) console.log(`title:        ${data.title}`);
  console.log(`status:       ${data.status}`);
  console.log(`nextAction:   ${data.nextAction}`);
  const assistant = Array.isArray(data.messages)
    ? data.messages.filter((m: any) => m.role === 'assistant').slice(-1)[0]
    : null;
  if (assistant?.content) {
    console.log('\nassistant:');
    console.log(assistant.content);
  }
  if (Array.isArray(data.clarifyingQuestions) && data.clarifyingQuestions.length) {
    console.log('\nclarifying questions:');
    for (const q of data.clarifyingQuestions) console.log(`  - ${q}`);
  }
  if (data.planJson) {
    console.log('\nplan:');
    console.log(summarizePlan(data.planJson));
  }
}

async function cmdNew(positional: string[], flags: Record<string, string>) {
  const prompt = positional[0];
  if (!prompt) throw new Error('usage: agent-x new "<prompt>" [--model <id>]');
  const body: Record<string, unknown> = { prompt };
  if (flags.model) body.model = flags.model;
  const data = await request('POST', '/api/agent/conversations', body);
  printChatResponse(data);
}

async function cmdTurn(positional: string[], flags: Record<string, string>) {
  const [convId, message] = positional;
  if (!convId || !message) throw new Error('usage: agent-x turn <id> "<message>" [--model <id>]');
  const body: Record<string, unknown> = { message };
  if (flags.model) body.model = flags.model;
  const data = await request('POST', `/api/agent/conversations/${encodeURIComponent(convId)}/turn`, body);
  printChatResponse(data);
}

async function cmdGet(positional: string[]) {
  const [convId] = positional;
  if (!convId) throw new Error('usage: agent-x get <id>');
  const data = await request('GET', `/api/agent/conversations/${encodeURIComponent(convId)}`);
  const conv = data.conversation;
  console.log(`conversation: ${conv.id}`);
  console.log(`title:        ${conv.title}`);
  console.log(`status:       ${conv.status}`);
  console.log(`campaignId:   ${conv.campaignId ?? '(none)'}`);
  const lastAssistant = Array.isArray(data.messages)
    ? data.messages.filter((m: any) => m.role === 'assistant').slice(-1)[0]
    : null;
  if (lastAssistant) {
    console.log('\nlast assistant message:');
    console.log(lastAssistant.content);
  }
  if (conv.planJson) {
    console.log('\nplan:');
    console.log(summarizePlan(conv.planJson));
  }
  if (data.campaign) {
    const c = data.campaign;
    console.log('\ncampaign:');
    console.log(`  id:       ${c.id}`);
    console.log(`  status:   ${c.status}`);
    console.log(`  workbook: ${c.workbookId ?? '(none)'}`);
    console.log(`  progress: step ${c.progress?.currentStep ?? '?'} / ${c.progress?.totalSteps ?? '?'}  (${c.progress?.completedSteps ?? 0} complete)`);
    if (Array.isArray(c.steps)) {
      for (const s of c.steps) {
        const tag = s.status === 'complete' ? 'OK' : s.status === 'error' ? 'ERR' : s.status === 'running' ? '..' : '  ';
        console.log(`    [${tag}] ${s.step}. ${s.type}${s.error ? '  err=' + String(s.error).slice(0, 120) : ''}`);
      }
    }
  }
}

async function cmdPreview(positional: string[]) {
  const [convId] = positional;
  if (!convId) throw new Error('usage: agent-x preview <id>');
  const data = await request('POST', `/api/agent/conversations/${encodeURIComponent(convId)}/preview`, {});
  console.log(`status:         ${data.status}`);
  console.log(`searchType:     ${data.searchType}`);
  console.log(`estimatedTotal: ${data.estimatedTotal ?? 'n/a'}`);
  console.log(`previewCount:   ${data.previewCount ?? 0}`);
  if (Array.isArray(data.preview) && data.preview.length) {
    console.log('\nfirst 3 preview rows:');
    for (const row of data.preview.slice(0, 3)) {
      console.log('  - ' + JSON.stringify(row).slice(0, 240));
    }
  }
}

async function cmdLaunch(positional: string[], flags: Record<string, string>) {
  const [convId] = positional;
  if (!convId) throw new Error('usage: agent-x launch <id> [--limit <n>]');
  const body: Record<string, unknown> = {};
  if (flags.limit) {
    const n = Number(flags.limit);
    if (!Number.isFinite(n) || n <= 0) throw new Error('--limit must be a positive number');
    body.confirmedLimit = Math.floor(n);
  }
  const data = await request('POST', `/api/agent/conversations/${encodeURIComponent(convId)}/launch`, body);
  console.log(`status:     ${data.status}`);
  console.log(`campaignId: ${data.campaignId}`);
  console.log(`workbook:   ${data.workbookId ?? '(none)'}`);
  console.log(`totalSteps: ${data.totalSteps}`);
  if (data.message) console.log(`message:    ${data.message}`);
}

async function cmdList() {
  const data = await request('GET', '/api/agent/conversations');
  const rows = Array.isArray(data.conversations) ? data.conversations : [];
  if (!rows.length) {
    console.log('(no conversations)');
    return;
  }
  for (const r of rows) {
    console.log(`${r.id}  ${r.status.padEnd(20)}  ${r.updatedAt}  ${r.title}`);
  }
}

async function cmdDelete(positional: string[]) {
  const [convId] = positional;
  if (!convId) throw new Error('usage: agent-x delete <id>');
  const data = await request('DELETE', `/api/agent/conversations/${encodeURIComponent(convId)}`);
  console.log(`deleted: ${convId}  cancelledCampaign=${!!data.cancelledCampaign}`);
}

function usage() {
  console.log(`agent-x — terminal client for DataFlow Agent X (GTM Campaign Builder)

Commands:
  new   "<prompt>"        [--model <id>]   start a new conversation
  turn  <id> "<message>"  [--model <id>]   append a follow-up turn
  get   <id>                               show conversation + campaign status
  preview <id>                             run search-count preview
  launch  <id>            [--limit <n>]    launch the approved plan as a campaign
  list                                     list recent conversations
  delete <id>                              delete a conversation

Env:
  DATAFLOW_BASE_URL  (default: https://dataflow-pi.vercel.app)
  DATAFLOW_API_KEY   (read from .env.local; required for non-agent endpoints)

Model override (passed to the planner LLM):
  --model claude-sonnet-4-6      # use Anthropic via ANTHROPIC_API_KEY on the server
  --model claude-opus-4-7
  --model gpt-5-mini             # default (Azure)`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }
  const { positional, flags } = parseFlags(rest);
  switch (cmd) {
    case 'new':     return cmdNew(positional, flags);
    case 'turn':    return cmdTurn(positional, flags);
    case 'get':     return cmdGet(positional);
    case 'preview': return cmdPreview(positional);
    case 'launch':  return cmdLaunch(positional, flags);
    case 'list':    return cmdList();
    case 'delete':  return cmdDelete(positional);
    default:
      usage();
      process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
