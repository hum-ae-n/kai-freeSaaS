#!/usr/bin/env python3
"""Extract the human-readable conversation from a Claude Code session transcript.

Keeps user and assistant prose. Drops tool calls, tool results, subagent
sidechains, harness reminders and task notifications, which are the bulk of the
28MB raw file and are not the record worth keeping.

Redacts anything key-shaped before writing. The raw transcript contains a live
Stripe secret key that must never reach a git repository.
"""
import json, pathlib, re, sys, datetime

SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])

SECRETS = [
    (re.compile(r'\b(sk|rk)_(test|live)_[A-Za-z0-9]{8,}'), r'\1_\2_[REDACTED]'),
    (re.compile(r'\bpk_(test|live)_[A-Za-z0-9]{8,}'), r'pk_\1_[REDACTED]'),
    (re.compile(r'\bwhsec_[A-Za-z0-9]{8,}'), 'whsec_[REDACTED]'),
    (re.compile(r'\b(gh[pousr]_[A-Za-z0-9]{20,})'), '[REDACTED_GITHUB_TOKEN]'),
    (re.compile(r'(Bearer\s+)[A-Za-z0-9._\-]{20,}'), r'\1[REDACTED]'),
]

SKIP_PREFIXES = (
    '<system-reminder>', '[SYSTEM NOTIFICATION', '<task-notification>',
    'Caveat:', '<local-command', '<github-webhook-activity>',
    'Stop hook feedback:', '<user-prompt-submit-hook>',
)

def redact(text):
    for pat, repl in SECRETS:
        text = pat.sub(repl, text)
    return text

turns = []
for line in SRC.open(encoding='utf-8', errors='replace'):
    try:
        d = json.loads(line)
    except Exception:
        continue
    if d.get('isSidechain'):
        continue
    if d.get('type') not in ('user', 'assistant'):
        continue
    content = (d.get('message') or {}).get('content')
    parts = []
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get('type') == 'text':
                parts.append(c['text'])
    text = '\n'.join(p for p in parts if p and p.strip()).strip()
    if not text or text.startswith(SKIP_PREFIXES):
        continue
    turns.append((d.get('type'), d.get('timestamp', ''), redact(text)))

lines = [
    '# Session log: Free Stack, Phases 11 to 15',
    '',
    'Verbatim conversation from the Claude Code session that built Phases 11 through 15',
    'and the first payments wave, kept at Rocky\'s request on 2 August 2026.',
    '',
    '**What this is.** The user and assistant prose only, extracted from the raw session',
    'transcript. Tool calls, command output, file diffs and subagent transcripts are',
    'stripped: they ran to roughly 28MB and the reasoning, not the mechanics, is what is',
    'worth keeping. The commits, `BUILD-PLAN.md` and its changelog hold the mechanics.',
    '',
    '**What has been removed.** Every key-shaped string is redacted. The raw transcript',
    'contained a live Stripe secret key, which is exactly why the raw file is not',
    'committed. Harness noise (system reminders, task notifications, stop-hook messages)',
    'is dropped, so an occasional reply answers something that is not shown.',
    '',
    f'**Turns.** {len(turns)} ({sum(1 for t,_,_ in turns if t == "user")} from Rocky, '
    f'{sum(1 for t,_,_ in turns if t == "assistant")} from Claude).',
    '',
    '---',
    '',
]
for role, ts, text in turns:
    who = 'Rocky' if role == 'user' else 'Claude'
    stamp = ts[:19].replace('T', ' ') if ts else ''
    lines.append(f'## {who}' + (f'  <sub>{stamp}Z</sub>' if stamp else ''))
    lines.append('')
    lines.append(text)
    lines.append('')

OUT.write_text('\n'.join(lines), encoding='utf-8')
print(f'wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(turns)} turns)')
