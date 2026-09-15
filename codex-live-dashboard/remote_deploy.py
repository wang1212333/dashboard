import pathlib,os,json
private=pathlib.Path.home()/'.config/codex-live-dashboard'
private.mkdir(parents=True,exist_ok=True,mode=0o700)
config=private/'config.toml'
# Write only the specifically authorized MCP connection, outside the published app.
content='[mcp_servers.data-gateway]\nurl = '+json.dumps(deployment_mcp_config['url'])+'\n[mcp_servers.data-gateway.http_headers]\n'
content+='\n'.join(json.dumps(k)+' = '+json.dumps(v) for k,v in deployment_mcp_config['http_headers'].items())+'\n'
fd=os.open(config,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:f.write(content)
os.chmod(config,0o600)
del deployment_mcp_config,content
import sys
sys.path.insert(0,'/home/jovyan/work/dev/codex-live-dashboard')
from app_bridge import run_query
result=run_query({'start':'2026-09-01','end':'2026-09-03','brand':'TECNO'})
print(json.dumps({k:result.get(k) for k in ['error','validated','durationMs','startDate','endDate','brand']}))
