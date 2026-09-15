"""Expiring, revocable, fixed-filter LAN shares. Tokens are held hashed in memory."""
import hashlib, secrets, socket, threading, time, uuid
from http.cookies import SimpleCookie

class Shares:
    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}
    def create(self, filters, scope, hours=24):
        token = secrets.token_urlsafe(32)
        item = {'id':uuid.uuid4().hex,'filters':dict(filters),'scope':scope,'expiresAt':time.time()+hours*3600}
        with self.lock:
            self.items = {k:v for k,v in self.items.items() if v['expiresAt']>time.time()}
            if len(self.items)>=100: raise ValueError('有效链接已达 100 个，请先撤销不需要的链接')
            self.items[hashlib.sha256(token.encode()).hexdigest()] = item
        return token,dict(item)
    def get(self, token, scope):
        if not token or len(token)>128:return None
        with self.lock:
            item=self.items.get(hashlib.sha256(token.encode()).hexdigest())
            if item and item['expiresAt']>time.time() and item['scope']==scope:return dict(item)
        return None
    def list(self):
        with self.lock:return [{k:v for k,v in item.items() if k!='scope'} for item in self.items.values() if item['expiresAt']>time.time()]
    def revoke(self, identifier):
        with self.lock:
            self.items={k:v for k,v in self.items.items() if v['id']!=identifier}

SHARES=Shares()
def lan_address():
    # Route discovery only: UDP connect does not send application data.
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sock:
        sock.connect(('10.255.255.255',80))
        return sock.getsockname()[0]

def cookie_token(value):
    try:
        cookie=SimpleCookie();cookie.load(value or '')
        return cookie['dashboard_share'].value if 'dashboard_share' in cookie else ''
    except Exception:return ''
