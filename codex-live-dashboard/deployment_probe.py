import requests, os, json, uuid, urllib.parse
from websockets.sync.client import connect
base='https://bigdata-ai-docker-container2.transsion.com'
s=requests.Session()
r=s.get(base+'/login',timeout=20);r.raise_for_status()
xsrf=s.cookies.get('_xsrf')
r=s.post(base+'/login',data={'_xsrf':xsrf,'password':os.environ['JUPYTER_PROBE_PASSWORD']},timeout=20)
headers={'X-XSRFToken':s.cookies.get('_xsrf','')}
r=s.get(base+'/api/contents/work/dev?content=0',timeout=20)
print('Workspace access:',r.status_code)
if r.status_code!=200:raise SystemExit('Authentication or workspace access failed')
name='codex-deployment-check-'+uuid.uuid4().hex[:10]+'.txt'
path='/api/contents/work/dev/'+name
kernel=None
try:
 r=s.put(base+path,headers=headers,json={'type':'file','format':'text','content':'Codex temporary upload and execution connectivity check.\n'},timeout=20);r.raise_for_status()
 print('Upload:',r.status_code)
 check=s.get(base+path,timeout=20);check.raise_for_status();assert 'Codex temporary' in check.json()['content'];print('Upload readback: PASS')
 r=s.post(base+'/api/kernels',headers=headers,json={'name':'python3'},timeout=30);r.raise_for_status();kernel=r.json()['id']
 cookie='; '.join(c.name+'='+c.value for c in s.cookies)
 with connect(base.replace('https://','wss://')+'/api/kernels/'+kernel+'/channels',additional_headers={'Cookie':cookie},origin=base,open_timeout=20) as ws:
  msgid=uuid.uuid4().hex
  code="""import sys, os, json, importlib.util, tempfile, socket, subprocess, urllib.request
info={'python':sys.version.split()[0], 'platform':sys.platform,'workspace_writable':os.access('/home/jovyan/work/dev',os.W_OK),'proxy_package':bool(importlib.util.find_spec('jupyter_server_proxy'))}
try:
 with urllib.request.urlopen('https://pfgateway.transsion.com/data-mcp-gateway-service/mcp',timeout=10) as r:info['gateway_http']=r.status
except Exception as e:info['gateway_http']=getattr(e,'code',type(e).__name__)
probe_dir=tempfile.TemporaryDirectory(prefix='codex-probe-')
with open(os.path.join(probe_dir.name,'index.html'),'w') as f:f.write('CODEX_DEPLOYMENT_PROBE_OK')
with socket.socket() as sock:sock.bind(('127.0.0.1',0));probe_port=sock.getsockname()[1]
probe_proc=subprocess.Popen([sys.executable,'-m','http.server',str(probe_port),'--bind','127.0.0.1','--directory',probe_dir.name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
info['probe_port']=probe_port
print(json.dumps(info))
"""
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
  output=execute(code);print('Container:',output.strip());info=json.loads(output.strip())
  try:
   r=s.get(base+'/proxy/'+str(info['probe_port'])+'/',timeout=20)
   print('Existing domain service proxy:',r.status_code,'marker=', 'CODEX_DEPLOYMENT_PROBE_OK' in r.text)
  finally:print('Probe process cleanup:',execute('probe_proc.terminate(); probe_proc.wait(timeout=10); probe_dir.cleanup(); print("OK")').strip())
finally:
 if kernel:
  r=s.delete(base+'/api/kernels/'+kernel,headers=headers,timeout=20);print('Temporary kernel cleanup:',r.status_code)
 r=s.delete(base+path,headers=headers,timeout=20);print('Temporary file cleanup:',r.status_code)
