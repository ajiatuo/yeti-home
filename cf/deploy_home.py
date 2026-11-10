#!/usr/bin/env python3
"""
awaker-home 部署脚本 — yeti-home 的 Cloudflare 移植版
- Worker: awaker-home, Assets(site/) + KV(生活数据) + GK_SECRET(plain_text, 每次部署随机生成, 只存于部署进程与 Worker 配置, 不落盘)
- 域名: home.awaker.edu.kg (Workers Custom Domain 精确绑定, 沿用 sea 的既有模式)
- 原项目: https://github.com/matingod/yeti-home (MIT)
"""
import sys, os, json, hashlib, base64, mimetypes, secrets as pysecrets
for p in ('/opt/muse/skills/custom-connector-setup/bin', '/opt/hatch/skills/skill-creator/bin'):
    if os.path.isdir(p):
        sys.path.insert(0, p)
from dynamic_credentials import add_surrogate_to_request, read_json_response
import urllib.request, urllib.error

ACCOUNT_ID = '0dd4cf77cc982d2fb1d62e64e3f6879a'
ZONE_ID = '01c5af33a83e8e2089e3373769ea4a71'
WORKER_NAME = 'awaker-home'
HOSTNAME = 'home.awaker.edu.kg'
KV_TITLE = 'awaker-home-data'
CF_BASE = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}'
HERE = os.path.dirname(os.path.abspath(__file__))
# 仓库根目录: cf/ 的上一级即为仓库根; 找不到时回退到本地克隆路径
_candidates = [os.path.dirname(HERE), os.path.expanduser('~/workspace/yeti-home-review')]
REPO = next((c for c in _candidates if os.path.isdir(os.path.join(c, 'site')) and os.path.isdir(os.path.join(c, 'gatekeeper'))), _candidates[-1])
SITE_DIR = os.path.join(REPO, 'site')

def cf_request(method, url, data=None, raw_body=None, content_type=None, use_surrogate=True, headers=None):
    h = dict(headers or {})
    if raw_body is not None:
        body = raw_body
        if content_type: h['Content-Type'] = content_type
    elif data is not None:
        body = json.dumps(data).encode(); h['Content-Type'] = 'application/json'
    else:
        body = None
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    if use_surrogate:
        add_surrogate_to_request(req, 'custom.cloudflare-deploy2', allowed_hosts=['api.cloudflare.com'])
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        return read_json_response(resp)
    except urllib.error.HTTPError as e:
        return {'success': False, 'http_error': e.code, 'body': e.read().decode()[:800]}

def get_login_html():
    os.environ['GK_DATA'] = '/tmp/yeti-gk-data'
    os.environ['GK_SECRET'] = pysecrets.token_urlsafe(48)
    os.makedirs('/tmp/yeti-gk-data', exist_ok=True)
    sys.path.insert(0, os.path.join(REPO, 'gatekeeper'))
    import gatekeeper
    return gatekeeper.LOGIN_HTML

def ensure_kv():
    r = cf_request('GET', f'{CF_BASE}/storage/kv/namespaces?per_page=100')
    for ns in r.get('result') or []:
        if ns.get('title') == KV_TITLE:
            print(f'   KV exists: {ns["id"]}'); return ns['id']
    r = cf_request('POST', f'{CF_BASE}/storage/kv/namespaces', data={'title': KV_TITLE})
    if not r.get('success'):
        print('KV CREATE FAILED:', json.dumps(r)[:500]); sys.exit(1)
    print(f'   KV created: {r["result"]["id"]}'); return r['result']['id']

def build_manifest(client_dir):
    manifest, file_contents = {}, {}
    for root, _, files in os.walk(client_dir):
        for f in files:
            full = os.path.join(root, f)
            rel = '/' + os.path.relpath(full, client_dir).replace(os.sep, '/')
            with open(full, 'rb') as fh: content = fh.read()
            ext = os.path.splitext(f)[1].lstrip('.')
            b64 = base64.b64encode(content).decode()
            h = hashlib.sha256((b64 + ext).encode()).hexdigest()[:32]
            manifest[rel] = {'hash': h, 'size': len(content)}
            file_contents[h] = (content, rel)
    return manifest, file_contents

def main():
    only = sys.argv[1] if len(sys.argv) > 1 else 'all'
    kv_id = None
    if only in ('all', 'worker'):
        print('== 1. KV namespace ==')
        kv_id = ensure_kv()
        print('== 2. Building manifest ==')
        manifest, file_contents = build_manifest(SITE_DIR)
        total = sum(v['size'] for v in manifest.values())
        print(f'   {len(manifest)} files, {total/1024/1024:.1f} MB')
        print('== 3. Assets upload session ==')
        r = cf_request('POST', f'{CF_BASE}/workers/scripts/{WORKER_NAME}/assets-upload-session', data={'manifest': manifest})
        if not r.get('success'):
            print('FAILED:', json.dumps(r)[:600]); sys.exit(1)
        res = r['result']; upload_jwt = res.get('jwt'); buckets = res.get('buckets') or []
        completion_jwt = upload_jwt if not buckets else None
        print(f'   buckets to upload: {len(buckets)}')
        for i, bucket in enumerate(buckets):
            boundary = '----Boundary' + os.urandom(8).hex()
            body = b''
            for file_hash in bucket:
                item = file_contents.get(file_hash)
                if item is None: print(f'   WARNING: hash {file_hash} missing'); continue
                content, path = item
                b64 = base64.b64encode(content).decode()
                body += f'--{boundary}\r\n'.encode()
                body += f'Content-Disposition: form-data; name="{file_hash}"; filename="{file_hash}"\r\n'.encode()
                ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
                body += f'Content-Type: {ctype}\r\n'.encode()
                body += b'Content-Transfer-Encoding: base64\r\n\r\n'
                body += b64.encode() + b'\r\n'
            body += f'--{boundary}--\r\n'.encode()
            r = cf_request('POST', f'{CF_BASE}/workers/assets/upload?base64=true', raw_body=body,
                           content_type=f'multipart/form-data; boundary={boundary}',
                           headers={'Authorization': f'Bearer {upload_jwt}'}, use_surrogate=False)
            if not r.get('success'):
                print(f'   bucket {i} FAILED:', json.dumps(r)[:400]); sys.exit(1)
            if r['result'].get('jwt'): completion_jwt = r['result']['jwt']
            print(f'   bucket {i+1}/{len(buckets)} ok')
        if not completion_jwt: print('FAILED: no completion jwt'); sys.exit(1)
        print('== 4. Deploying worker ==')
        worker_src = open(os.path.join(HERE, 'worker.js'), encoding='utf-8').read()
        login_html = get_login_html()
        assert '/*__LOGIN_HTML__*/""' in worker_src
        worker_src = worker_src.replace('/*__LOGIN_HTML__*/""', json.dumps(login_html, ensure_ascii=False))
        gk_secret = pysecrets.token_urlsafe(48)
        metadata = {
            'main_module': 'worker.js',
            'bindings': [
                {'type': 'assets', 'name': 'ASSETS'},
                {'type': 'kv_namespace', 'name': 'DATA', 'namespace_id': kv_id},
                {'type': 'plain_text', 'name': 'GK_SECRET', 'text': gk_secret},
            ],
            'assets': {'jwt': completion_jwt, 'config': {'run_worker_first': True}},
            'compatibility_date': '2025-10-01',
        }
        boundary = '----Boundary' + os.urandom(8).hex()
        body = b''
        body += f'--{boundary}\r\n'.encode()
        body += b'Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'
        body += json.dumps(metadata).encode() + b'\r\n'
        body += f'--{boundary}\r\n'.encode()
        body += b'Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'
        body += worker_src.encode('utf-8') + b'\r\n'
        body += f'--{boundary}--\r\n'.encode()
        r = cf_request('PUT', f'{CF_BASE}/workers/scripts/{WORKER_NAME}', raw_body=body,
                       content_type=f'multipart/form-data; boundary={boundary}')
        if not r.get('success'):
            print('DEPLOY FAILED:', json.dumps(r)[:800]); sys.exit(1)
        print('   worker deployed OK, version:', (r.get('result') or {}).get('id'))
    if only in ('all', 'bind'):
        print('== 5. Attaching Workers Custom Domain ==')
        r = cf_request('GET', f'{CF_BASE}/workers/domains')
        attached = [d for d in (r.get('result') or []) if d.get('hostname') == HOSTNAME]
        if attached:
            print(f'   already attached: {attached[0].get("service")}')
        else:
            r = cf_request('GET', f'https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records?name={HOSTNAME}')
            for rec in r.get('result') or []:
                d = cf_request('DELETE', f'https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records/{rec["id"]}')
                print(f'   deleted pre-existing DNS {rec["type"]}: {d.get("success")}')
            r = cf_request('PUT', f'{CF_BASE}/workers/domains', data={'hostname': HOSTNAME, 'service': WORKER_NAME, 'environment': 'production'})
            if not r.get('success'):
                print('DOMAIN ATTACH FAILED:', json.dumps(r)[:600]); sys.exit(1)
            print('   custom domain attached:', json.dumps(r['result'])[:200])
    print('DONE')

if __name__ == '__main__':
    main()
