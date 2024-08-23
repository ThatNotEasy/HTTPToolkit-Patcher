const { HttpsProxyAgent } = require('https-proxy-agent')
const electron = require('electron')
const express = require('express')
const https = require('https')
const fs = require('fs')

const request = (method, url, redirectCount = 0) => new Promise((resolve, reject) => {
  const agent = globalProxy ? new HttpsProxyAgent(globalProxy.startsWith('http') ? globalProxy.replace(/^http:/, 'https:') : 'https://' + globalProxy) : undefined //? Use proxy if set (globalProxy is injected by the patcher)

  const req = https.request(url, { method, agent }, res => {
    let data = Buffer.alloc(0)

    res.on('data', chunk => data = Buffer.concat([data, chunk]))

    res.on('end', () => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= 5) {
          reject(new Error('Too many redirects'))
          return
        }
        resolve(request(method, res.headers.location, redirectCount + 1))
        return
      }
      resolve({
        data,
        statusCode: res.statusCode,
        headers: res.headers
      })
    })
  })

  req.on('error', reject)

  req.end()
})

const hasInternet = () => request('HEAD', 'https://app.httptoolkit.tech').then(r => r.statusCode >= 200 && r.statusCode < 400).catch(() => false)

const port = process.env.PORT || 5067
const tempPath = path.join(os.tmpdir(), 'httptoolkit-patch')

process.env.APP_URL = `http://localhost:${port}`
console.log(`[Patcher] Selected temp path: ${tempPath}`)

const app = express()

app.disable('x-powered-by')

app.all('*', async (req, res) => {
  console.log(`[Patcher] Request to: ${req.url}`)

  let filePath = path.join(tempPath, new URL(req.url, process.env.APP_URL).pathname === '/' ? 'index.html' : new URL(req.url, process.env.APP_URL).pathname)
  if (['/view', '/intercept', '/settings', '/mock'].includes(new URL(req.url, process.env.APP_URL).pathname)) {
    filePath += '.html'
  }

  //? Prevent loading service worker to avoid caching issues
  if (new URL(req.url, process.env.APP_URL).pathname === '/ui-update-worker.js') return res.status(404).send('Not found')

  if (!fs.existsSync(tempPath)) {
    console.log(`[Patcher] Temp path not found, creating: ${tempPath}`)
    fs.mkdirSync(tempPath)
  }

  if (!(await hasInternet())) {
    console.log(`[Patcher] No internet connection, trying to serve directly from temp path`)
    if (fs.existsSync(filePath)) {
      console.log(`[Patcher] Serving from temp path: ${filePath}`)
      res.sendFile(filePath)
    } else {
      console.log(`[Patcher] File not found in temp path: ${filePath}`)
      res.status(404).send('No internet connection and file is not cached')
    }
    return
  }

  try {
    if (fs.existsSync(filePath)) { //? Check if file exists in temp path
      try {
        const remoteDate = await request('HEAD', `https://app.httptoolkit.tech${req.url}`).then(res => new Date(res.headers['last-modified']))
        if (remoteDate < new Date(fs.statSync(filePath).mtime)) {
          console.log(`[Patcher] File not changed, serving from temp path`)
          res.sendFile(filePath)
          return
        }
      } catch (e) {
        console.error(`[Patcher] [ERR] Failed to fetch remote file date`, e)
      }
    } else console.log(`[Patcher] File not found in temp path, downloading`)

    const remoteFile = await request('GET', `https://app.httptoolkit.tech${req.url}`)

    for (const [key, value] of Object.entries(remoteFile.headers)) res.setHeader(key, value)

    const recursiveMkdir = dir => {
      if (!fs.existsSync(dir)) {
        recursiveMkdir(path.dirname(dir))
        fs.mkdirSync(dir)
      }
    }

    recursiveMkdir(path.dirname(filePath))
    let data = remoteFile.data
    if (new URL(req.url, process.env.APP_URL).pathname === '/main.js') { //? Patch main.js
      console.log(`[Patcher] Patching main.js`)
      res.setHeader('Cache-Control', 'no-store') //? Prevent caching

      data = data.toString()

      const accStoreName = data.match(/class ([0-9A-Za-z_]+){constructor\(e\){this\.goToSettings=e/)?.[1]
      const modName = data.match(/([0-9A-Za-z_]+).(getLatestUserData|getLastUserData)/)?.[1]

      if (!accStoreName) console.error(`[Patcher] [ERR] Account store name not found in main.js`)
      else if (!modName) console.error(`[Patcher] [ERR] Module name not found in main.js`)
      else {
        let patched = data
          .replace(`class ${accStoreName}{`, `["getLatestUserData","getLastUserData"].forEach(p=>Object.defineProperty(${modName},p,{value:()=>user}));class ${accStoreName}{`)
        if (patched === data) console.error(`[Patcher] [ERR] Patch failed`)
        else {
          patched = `const user=${JSON.stringify({
            email, //? Injected by the patcher
            subscription: {
              status: 'active',
              expiry: new Date('9999-12-31').toISOString(),
              plan: 'pro-annual',
            }
          })};user.subscription.expiry=new Date(user.subscription.expiry);` + patched
          data = patched
          console.log(`[Patcher] main.js patched`)
        }
      }
    }
    fs.writeFileSync(filePath, data)
    console.log(`[Patcher] File downloaded and saved: ${filePath}`)
    res.sendFile(filePath)
  } catch (e) {
    console.error(`[Patcher] [ERR] Failed to fetch remote file: ${filePath}`, e)
    res.status(500).send('Internal server error')
  }
})

app.listen(port, () => console.log(`[Patcher] Server listening on port ${port}`))

electron.app.on('ready', () => {
  //? Patching CORS headers to allow requests from localhost
  electron.session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    //* Blocking unwanted requests to prevent tracking
    const blockedHosts = ['events.httptoolkit.tech']
    if (blockedHosts.includes(new URL(details.url).hostname) || details.url.includes('sentry')) return callback({ cancel: true })
    details.requestHeaders.Origin = 'https://app.httptoolkit.tech'
    callback({ requestHeaders: details.requestHeaders })
  })
  electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    details.responseHeaders['Access-Control-Allow-Origin'] = [`http://localhost:${port}`]
    delete details.responseHeaders['access-control-allow-origin']
    callback({ responseHeaders: details.responseHeaders })
  })
})

//? Disable caching for all requests
electron.app.commandLine.appendSwitch('disable-http-cache')