import os
import requests
from flask import Flask, request, send_from_directory, jsonify
from urllib.parse import urljoin, urlparse
from datetime import datetime
import shutil

app = Flask(__name__)
app.config['X_FRAME_OPTIONS'] = 'SAMEORIGIN'

PORT = int(os.getenv('PORT', 5067))
TEMP_PATH = os.path.join(os.path.expanduser('~'), 'httptoolkit-patch')
APP_URL = f'http://localhost:{PORT}'

def request_url(method, url, redirect_count=0):
    global_proxy = os.getenv('GLOBAL_PROXY')
    proxies = {'https': global_proxy} if global_proxy else None

    try:
        response = requests.request(method, url, proxies=proxies, allow_redirects=False)
        if 300 <= response.status_code < 400 and 'Location' in response.headers:
            if redirect_count >= 5:
                raise Exception('Too many redirects')
            return request_url(method, response.headers['Location'], redirect_count + 1)
        return response
    except requests.RequestException as e:
        raise e

def has_internet():
    try:
        response = request_url('HEAD', 'https://app.httptoolkit.tech')
        return 200 <= response.status_code < 400
    except Exception:
        return False

@app.before_first_request
def setup():
    if not os.path.exists(TEMP_PATH):
        os.makedirs(TEMP_PATH)
    print(f'[Patcher] Selected temp path: {TEMP_PATH}')

@app.route('/<path:filename>', methods=['GET', 'HEAD'])
def serve_file(filename):
    print(f'[Patcher] Request to: {request.path}')
    file_path = os.path.join(TEMP_PATH, 'index.html' if request.path == '/' else request.path.lstrip('/'))
    if request.path in ['/view', '/intercept', '/settings', '/mock']:
        file_path += '.html'

    if request.path == '/ui-update-worker.js':
        return 'Not found', 404

    if not has_internet():
        print(f'[Patcher] No internet connection, trying to serve directly from temp path')
        if os.path.exists(file_path):
            print(f'[Patcher] Serving from temp path: {file_path}')
            return send_from_directory(TEMP_PATH, file_path)
        else:
            print(f'[Patcher] File not found in temp path: {file_path}')
            return 'No internet connection and file is not cached', 404

    try:
        if os.path.exists(file_path):
            try:
                remote_response = request_url('HEAD', urljoin('https://app.httptoolkit.tech', request.path))
                remote_date = datetime.strptime(remote_response.headers.get('Last-Modified', ''), '%a, %d %b %Y %H:%M:%S %Z')
                local_date = datetime.fromtimestamp(os.path.getmtime(file_path))
                if remote_date <= local_date:
                    print(f'[Patcher] File not changed, serving from temp path')
                    return send_from_directory(TEMP_PATH, file_path)
            except Exception as e:
                print(f'[Patcher] [ERR] Failed to fetch remote file date', e)
        
        print(f'[Patcher] File not found in temp path, downloading')
        remote_file = request_url('GET', urljoin('https://app.httptoolkit.tech', request.path))
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        data = remote_file.content

        if request.path == '/main.js':
            print(f'[Patcher] Patching main.js')
            response_headers = dict(remote_file.headers)
            response_headers['Cache-Control'] = 'no-store'

            data = data.decode()

            acc_store_name = re.search(r'class ([0-9A-Za-z_]+){constructor\(e\){this\.goToSettings=e', data)
            mod_name = re.search(r'([0-9A-Za-z_]+).(getLatestUserData|getLastUserData)', data)

            if acc_store_name:
                acc_store_name = acc_store_name.group(1)
            if mod_name:
                mod_name = mod_name.group(1)

            if not acc_store_name:
                print(f'[Patcher] [ERR] Account store name not found in main.js')
            elif not mod_name:
                print(f'[Patcher] [ERR] Module name not found in main.js')
            else:
                patched = data.replace(f'class {acc_store_name}{{', f'["getLatestUserData","getLastUserData"].forEach(p=>Object.defineProperty({mod_name},p{{value:()=>user}}));class {acc_store_name}{{')
                if patched == data:
                    print(f'[Patcher] [ERR] Patch failed')
                else:
                    patched = f'const user={json.dumps({{"email": "user@example.com", "subscription": {"status": "active", "expiry": "9999-12-31T00:00:00Z", "plan": "pro-annual"}}})};user.subscription.expiry=new Date(user.subscription.expiry);' + patched
                    data = patched
                    print(f'[Patcher] main.js patched')

        with open(file_path, 'wb') as f:
            f.write(data.encode() if isinstance(data, str) else data)
        print(f'[Patcher] File downloaded and saved: {file_path}')
        return send_from_directory(TEMP_PATH, file_path)
    except Exception as e:
        print(f'[Patcher] [ERR] Failed to fetch remote file: {file_path}', e)
        return 'Internal server error', 500

if __name__ == '__main__':
    app.run(port=PORT)
