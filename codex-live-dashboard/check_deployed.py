import requests,os
base='https://bigdata-ai-docker-container2.transsion.com'
s=requests.Session();s.get(base+'/login');s.post(base+'/login',data={'_xsrf':s.cookies.get('_xsrf'),'password':os.environ['JUPYTER_PROBE_PASSWORD']})
r=s.get(base+'/files/work/dev/codex-live-dashboard/index.html');print('HTML',r.status_code,r.headers.get('Content-Type'),'CSP',r.headers.get('Content-Security-Policy'))
print('unauthenticated',requests.get(base+'/files/work/dev/codex-live-dashboard/index.html',allow_redirects=False).status_code)
