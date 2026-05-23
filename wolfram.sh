#!/bin/bash
# wolfram.sh - Run Wolfram Language code via the MCP server
# Usage: wolfram.sh "Plot[Sin[x], {x, 0, 2Pi}]"

CODE="$1"
if [ -z "$CODE" ]; then
  echo "Usage: wolfram.sh <wolfram-code>"
  echo ""
  echo "Examples:"
  echo '  wolfram.sh "2+2"'
  echo '  wolfram.sh "Plot[Sin[x], {x, -2Pi, 2Pi}]"'
  echo '  wolfram.sh "Solve[x^2 - 4x + 3 == 0, x]"'
  echo '  wolfram.sh "Integrate[x^2, {x, 0, 1}]"'
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 -c "
import subprocess, json, time, sys, os, signal

# Start MCP server
proc = subprocess.Popen(
    ['bun', 'run', '$SCRIPT_DIR/wolfram-kernel-service/dist/index.js'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
time.sleep(3)

def send(method, params=None):
    msg = {'jsonrpc': '2.0', 'id': 1, 'method': method}
    if params: msg['params'] = params
    proc.stdin.write((json.dumps(msg) + '\n').encode())
    proc.stdin.flush()

def recv():
    time.sleep(2)
    import os
    os.set_blocking(proc.stdout.fileno(), False)
    try:
        data = proc.stdout.read()
        return json.loads(data.decode())
    except json.JSONDecodeError:
        # Try to find JSON object
        text = data.decode()
        start = text.find('{')
        end = text.rfind('}') + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        return {'error': 'parse error', 'text': text[:500]}
    except Exception as e:
        return {'error': str(e)}

# Create session
r = send('tools/call', {'name': 'wolfram_session_create', 'arguments': {'name': 'bash-session'}})
r = recv()
if 'error' in r:
    print('Session error:', r.get('error', {}).get('message', str(r)))
    proc.kill()
    sys.exit(1)

# Extract session ID from the result
text = r['result']['content'][0]['text']
import re
sid_match = re.search(r'\((\`[^\`]+\`)\)', text)
if not sid_match:
    print('Failed to extract session ID from:', text)
    proc.kill()
    sys.exit(1)
sid = sid_match.group(1).strip('\`')

# Execute code
code = '''$CODE'''
# Auto-wrap in Print if it's an expression (not a compound statement)
if not ';' in code and not '[' in code:
    code = code  # just evaluate

r = send('tools/call', {'name': 'wolfram_execute', 'arguments': {'sessionId': sid, 'code': code}})
r = recv()
if 'result' in r:
    content = r['result']['content'][0]['text']
    # Extract only the output part (skip session/timing header)
    lines = content.split('\n')
    in_output = False
    for line in lines:
        if line.startswith('**Outputs:**'):
            in_output = True
            continue
        if in_output:
            if line.startswith('  '):
                print(line.strip())
            elif line.strip():
                print(line.strip())
    if not in_output:
        # Fallback: show everything after '**Outputs:**'
        idx = content.find('**Outputs:**')
        if idx >= 0:
            after = content[idx+len('**Outputs:**'):].strip()
            print(after)
        else:
            print(content[:1000])
else:
    print('Error:', json.dumps(r, indent=2, ensure_ascii=False)[:500])

# Cleanup
send('tools/call', {'name': 'wolfram_session_delete', 'arguments': {'sessionId': sid}})
time.sleep(0.5)
proc.terminate()
proc.wait()
"
