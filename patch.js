const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios').default;
const electron = require('electron');
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

function showPatchError(message) {
  console.error(message);
  electron.dialog.showErrorBox('Patch Error', `${message}\n\nPlease report this issue on GitHub (https://github.com/ThatNotEasy/HTTPToolkit-Patcher)`);
}

const axiosInstance = axios.create({
  baseURL: 'https://app.httptoolkit.tech',
  httpsAgent: globalProxy
    ? new HttpsProxyAgent(
        globalProxy.startsWith('http')
          ? globalProxy.replace(/^http:/, 'https:')
          : 'https://' + globalProxy
      )
    : undefined,
});

const hasInternet = () => axiosInstance.head('/').then(() => true).catch(() => false);

const port = process.env.PORT || 5067;
const tempPath = path.join(os.tmpdir(), 'httptoolkit-patch');

process.env.APP_URL = `http://localhost:${port}`;
console.log(`[Patcher] Selected temp path: ${tempPath}`);

const app = express();
app.disable('x-powered-by');

app.all('*', async (req, res) => {
  console.log(`[Patcher] Request to: ${req.url}`);
  
  let filePath = path.join(
    tempPath,
    new URL(req.url, process.env.APP_URL).pathname === '/' ? 'index.html' : new URL(req.url, process.env.APP_URL).pathname
  );
  
  if (['/view', '/intercept', '/settings', '/mock'].includes(new URL(req.url, process.env.APP_URL).pathname)) {
    filePath += '.html';
  }

  if (new URL(req.url, process.env.APP_URL).pathname === '/ui-update-worker.js') {
    return res.status(404).send('Not found');
  }

  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath);
  }

  if (!(await hasInternet())) {
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    return res.status(404).send('No internet connection and file is not cached');
  }

  try {
    if (fs.existsSync(filePath)) {
      const remoteDate = await axiosInstance.head(req.url).then((res) => new Date(res.headers['last-modified']));
      if (remoteDate < new Date(fs.statSync(filePath).mtime)) {
        return res.sendFile(filePath);
      }
    }

    const remoteFile = await axiosInstance.get(req.url, { responseType: 'arraybuffer' });
    for (const [key, value] of Object.entries(remoteFile.headers)) res.setHeader(key, value);

    const recursiveMkdir = (dir) => {
      if (!fs.existsSync(dir)) {
        recursiveMkdir(path.dirname(dir));
        fs.mkdirSync(dir);
      }
    };

    recursiveMkdir(path.dirname(filePath));
    let data = remoteFile.data;
    
    if (new URL(req.url, process.env.APP_URL).pathname === '/main.js') {
      data = data.toString();
      
      const accStoreName = data.match(/class ([0-9A-Za-z_$]+){constructor\(e\){this\.goToSettings=e/)?.[1];
      const modName = data.match(/([0-9A-Za-z_$]+).(getLatestUserData|getLastUserData)/)?.[1];
      
      if (!accStoreName) showPatchError(`[Patcher] [ERR] Account store name not found in main.js`);
      else if (!modName) showPatchError(`[Patcher] [ERR] Module name not found in main.js`);
      else {
        let patched = data.replace(
          `class ${accStoreName}{`,
          `["getLatestUserData","getLastUserData"].forEach(p=>Object.defineProperty(${modName},p,{value:()=>user}));class ${accStoreName}{`
        );
        
        if (patched !== data) {
          patched = `const user=${JSON.stringify({
            email, 
            subscription: {
              status: 'active',
              quantity: 1,
              expiry: new Date('9999-12-31').toISOString(),
              sku: 'pro-annual',
              plan: 'pro-annual',
              tierCode: 'pro',
              interval: 'annual',
              canManageSubscription: true,
              updateBillingDetailsUrl: 'https://github.com/ThatNotEasy/HTTPToolkit-Patcher',
            }
          })};user.subscription.expiry=new Date(user.subscription.expiry);` + patched;
          
          data = patched;
        } else showPatchError(`[Patcher] [ERR] Patch failed`);
      }
    }
    
    fs.writeFileSync(filePath, data);
    res.sendFile(filePath);
  } catch (e) {
    console.error(`[Patcher] [ERR] Failed to fetch remote file: ${filePath}`, e);
    res.status(500).send('Internal server error');
  }
});

app.listen(port, () => console.log(`[Patcher] Server listening on port ${port}`));

electron.app.on('ready', () => {
  electron.session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const blockedHosts = ['events.httptoolkit.tech'];
    if (blockedHosts.includes(new URL(details.url).hostname) || details.url.includes('sentry')) return callback({ cancel: true });
    details.requestHeaders.Origin = 'https://app.httptoolkit.tech';
    callback({ requestHeaders: details.requestHeaders });
  });
  electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    details.responseHeaders['Access-Control-Allow-Origin'] = [`http://localhost:${port}`];
    callback({ responseHeaders: details.responseHeaders });
  });
});

electron.app.commandLine.appendSwitch('disable-http-cache');
