import json
import tomllib
import http.client
from urllib.parse import urlsplit
from pathlib import Path

class Gateway:
    def __init__(self):
        config = tomllib.loads((Path.home()/'.config/codex-live-dashboard/config.toml').read_text(encoding='utf-8'))['mcp_servers']['data-gateway']
        self.url = config['url']
        self.headers = {**config['http_headers'], 'Content-Type':'application/json', 'Accept':'application/json, text/event-stream'}
        self.sequence = 0
        target = urlsplit(self.url)
        if target.scheme != 'https': raise ValueError('MCP 必须使用 HTTPS')
        self.connection = http.client.HTTPSConnection(target.hostname, target.port or 443, timeout=60)
        self.path = target.path + ('?' + target.query if target.query else '')
        result = self.call('initialize', {'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'codex-live-dashboard','version':'1.0'}})
        self.headers['MCP-Protocol-Version'] = result['protocolVersion']
        self.call('notifications/initialized', notification=True)

    def call(self, method, params=None, notification=False):
        self.sequence += 1
        payload = {'jsonrpc':'2.0','method':method}
        if params is not None: payload['params'] = params
        if not notification: payload['id'] = self.sequence
        self.connection.request('POST', self.path, body=json.dumps(payload).encode(), headers=self.headers)
        with self.connection.getresponse() as response:
            if response.status >= 300:
                self.connection.close()
                raise RuntimeError('MCP HTTP request failed')
            if response.headers.get('Mcp-Session-Id'): self.headers['Mcp-Session-Id'] = response.headers['Mcp-Session-Id']
            if notification:
                response.read()
                return None
            if 'text/event-stream' in response.headers.get('Content-Type',''):
                result = None
                for raw in response:
                    line = raw.decode().strip()
                    if not line.startswith('data:'): continue
                    try: candidate = json.loads(line[5:].strip())
                    except json.JSONDecodeError: continue
                    if candidate.get('id') == payload['id']:
                        result = candidate
                        self.connection.close()
                        break
            else: result = json.load(response)
        if not result or 'error' in result: raise RuntimeError('MCP request failed: '+str(result.get('error') if result else 'empty response'))
        return result['result']

    def close(self): self.connection.close()

if __name__ == '__main__':
    print(json.dumps(Gateway().call('tools/list'), ensure_ascii=False, indent=2))
