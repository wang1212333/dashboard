from pathlib import Path
import requests, os, json, uuid, urllib.parse
from websockets.sync.client import connect
base='https://bigdata-ai-docker-container2.transsion.com'
s=requests.Session()
r=s.get(base+'/login',timeout=20);r.raise_for_status()
xsrf=s.cookies.get('_xsrf')
r=s.post(base+'/login',data={'_xsrf':xsrf,'password':os.environ['JUPYTER_PROBE_PASSWORD']},timeout=20)
headers={'X-XSRFToken':s.cookies.get('_xsrf','')}
if os.environ.get('UPLOAD_APP'):
 remote='/api/contents/work/dev/codex-live-dashboard'
 exists=s.get(base+remote+'?content=0',timeout=20)
 if exists.status_code==404:
  s.put(base+remote,headers=headers,json={'type':'directory'},timeout=20).raise_for_status()
 else:exists.raise_for_status()
 for file in Path('codex-live-dashboard/jupyter-deploy').iterdir():
  if file.is_file():
   s.put(base+remote+'/'+file.name,headers=headers,json={'type':'file','format':'text','content':file.read_text(encoding='utf-8')},timeout=20).raise_for_status()
 print('Application upload: PASS')

r=s.get(base+'/api/contents/work/dev?content=0',timeout=20)
print('Workspace access:',r.status_code)
if r.status_code!=200:raise SystemExit('Authentication or workspace access failed')
kernel=None
try:
 r=s.post(base+'/api/kernels',headers=headers,json={'name':'python3'},timeout=30);r.raise_for_status();kernel=r.json()['id']
 cookie='; '.join(c.name+'='+c.value for c in s.cookies)
 with connect(base.replace('https://','wss://')+'/api/kernels/'+kernel+'/channels',additional_headers={'Cookie':cookie},origin=base,open_timeout=20) as ws:
  msgid=uuid.uuid4().hex
  code=Path(os.environ['REMOTE_CODE_FILE']).read_text(encoding='utf-8-sig')
  if os.environ.get('TRANSFER_MCP_CONFIG'):
   import tomllib
   cfg=tomllib.loads((Path.home()/'.codex/config.toml').read_text(encoding='utf-8'))['mcp_servers']['data-gateway']
   code='deployment_mcp_config='+repr(cfg)+'\n'+code
  def execute(code):
   mid=uuid.uuid4().hex
   ws.send(json.dumps({'header':{'msg_id':mid,'username':'codex','session':msgid,'msg_type':'execute_request','version':'5.3'},'parent_header':{},'metadata':{},'channel':'shell','content':{'code':code,'silent':False,'store_history':False,'user_expressions':{},'allow_stdin':False,'stop_on_error':True}}))
   output=''
   while True:
    event=json.loads(ws.recv(timeout=45))
    if event.get('parent_header',{}).get('msg_id')!=mid:continue
    typ=event.get('msg_type',event.get('header',{}).get('msg_type'))
    if typ=='stream':output+=event['content']['text']
    if typ=='error':raise RuntimeError(event['content']['ename']+': '+event['content']['evalue'])
    if typ=='status' and event['content']['execution_state']=='idle':return output
  print(execute(code))
finally:
 if kernel:
  r=s.delete(base+'/api/kernels/'+kernel,headers=headers,timeout=20);print('Temporary kernel cleanup:',r.status_code)
