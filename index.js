// @ts-check
import { spawn } from 'child_process'
import asar from '@electron/asar'
import prompts from 'prompts'
import yargs from 'yargs'
import chalk from 'chalk'
import path from 'path'
import fs from 'fs'
import os from 'os'

const argv = await yargs(process.argv.slice(2))
  .usage(`Usage: ${path.basename(process.argv0, '.exe')} . <command> [options]`)
  .command('patch', 'Patch HTTP Toolkit')
  .option('proxy', {
    alias: 'p',
    describe: 'Specify a global proxy (only http/https supported)',
    type: 'string'
  })
  .option('path', {
    alias: 'P',
    describe: 'Specify the path to the HTTP Toolkit folder (auto-detected by default)',
    type: 'string'
  })
  .command('restore', 'Restore HTTP Toolkit')
  .command('start', 'Start HTTP Toolkit with debug logs enabled')
  .demandCommand(1, 'You need at least one command before moving on')
  .alias('h', 'help')
  .describe('help', 'Show this help message')
  .parse()

const globalProxy = argv.proxy

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

//* why is there so many different paths, god damn
const getAppPath = () => {
  if (argv.path) return argv.path.endsWith(isMac ? '/Resources' : '/resources') ? argv.path : path.join(argv.path, isMac ? '/Resources' : '/resources')
  if (isWin) return path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'httptoolkit', 'resources')
  if (isMac) return '/Applications/HTTP Toolkit.app/Contents/Resources'
  if (fs.existsSync('/opt/HTTP Toolkit/resources')) return '/opt/HTTP Toolkit/resources'
  return '/opt/httptoolkit/resources'
}

const appPath = getAppPath()

const isSudo = !isWin && (process.getuid || (() => process.env.SUDO_UID ? 0 : null))() === 0

if (+(process.versions.node.split('.')[0]) < 15) {
  console.error(chalk.redBright`[!] Node.js version 15 or higher is recommended, you are currently using version {bold ${process.versions.node}}`)
}

if (!fs.existsSync(path.join(appPath, 'app.asar'))) {
  console.error(chalk.redBright`[-] HTTP Toolkit not found${!argv.path ? ', try specifying the path with --path' : ''}`)
  process.exit(1)
}

console.log(chalk.blueBright`[+] HTTP Toolkit found at {bold ${path.dirname(appPath)}}`)

const rm = (/** @type {string} */ dirPath) => {
  if (!fs.existsSync(dirPath)) return
  if (!fs.lstatSync(dirPath).isDirectory()) return fs.rmSync(dirPath, { force: true })
  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry)
    if (fs.lstatSync(entryPath).isDirectory()) rm(entryPath)
    else fs.rmSync(entryPath, { force: true })
  }
}

const canWrite = (/** @type {string} */ dirPath) => {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** @type {Array<import('child_process').ChildProcess>} */
const activeProcesses = []
let isCancelled = false

const cleanUp = async () => {
  isCancelled = true
  console.log(chalk.redBright`[-] Operation cancelled, cleaning up...`)
  if (activeProcesses.length) {
    console.log(chalk.yellowBright`[+] Killing active processes...`)
    for (const proc of activeProcesses) {
      proc.kill('SIGINT')
      console.log(chalk.yellowBright`[+] Process {bold ${proc.pid ? process.pid + ' ' : ''}}killed`)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const paths = [
    path.join(os.tmpdir(), 'httptoolkit-patch'),
    path.join(os.tmpdir(), 'httptoolkit-patcher-temp')
  ]
  try {
    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log(chalk.yellowBright`[+] Removing {bold ${p}}`)
        rm(p)
      }
    }
  } catch (e) {
    console.error(chalk.redBright`[-] An error occurred while cleaning up`, e)
  }
  process.exit(1)
}

const patchApp = async () => {
  const filePath = path.join(appPath, 'app.asar')
  const tempPath = path.join(os.tmpdir(), 'httptoolkit-patcher-temp')

  if (fs.readFileSync(filePath).includes('Injected by HTTP Toolkit Patcher')) {
    console.log(chalk.yellowBright`[!] HTTP Toolkit already patched`)
    return
  }

  console.log(chalk.blueBright`[+] Started patching app...`)

  if (!canWrite(filePath)) {
    console.error(chalk.redBright`[-] Insufficient permissions to write to {bold ${filePath}}, try running ${!isWin ? 'with sudo' : 'node as administrator'}`)
    process.exit(1)
  }

  if (globalProxy) {
    if (!globalProxy.match(/^https?:/)) {
      console.error(chalk.redBright`[-] Global proxy must start with http:// or https://`)
      process.exit(1)
    }
    console.log(chalk.yellowBright`[+] Adding a custom global proxy: {bold ${globalProxy}}`)
  }

  console.log(chalk.yellowBright`[+] Extracting app...`)

  ;['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, cleanUp))

  try {
    rm(tempPath)
    asar.extractAll(filePath, tempPath)
  } catch (e) {
    if (!isSudo && e.errno === -13) { //? Permission denied
      console.error(chalk.redBright`[-] Permission denied, try running ${!isWin ? 'with sudo' : 'node as administrator'}`)
      process.exit(1)
    }
    console.error(chalk.redBright`[-] An error occurred while extracting app`, e)
    process.exit(1)
  }

  const indexPath = path.join(tempPath, 'build', 'index.js')
  if (!fs.existsSync(indexPath)) {
    console.error(chalk.redBright`[-] Index file not found`)
    await cleanUp()
  }
  const data = fs.readFileSync(indexPath, 'utf-8')
  ;['SIGINT', 'SIGTERM'].forEach(signal => process.off(signal, cleanUp))
  const { email } = await prompts({
    type: 'text',
    name: 'email',
    message: 'Enter a email for the pro plan',
    validate: value => value.includes('@') || 'Invalid email'
  })
  if (!email || typeof email !== 'string') {
    console.error(chalk.redBright`[-] Email not provided`)
    await cleanUp()
  }
  ;['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, cleanUp))
  const patch = fs.readFileSync('patch.js', 'utf-8')
  const patchedData = data
    .replace('const APP_URL =', `// ------- Injected by HTTP Toolkit Patcher -------\nconst email = \`${email.replace(/`/g, '\\`')}\`\nconst globalProxy = process.env.PROXY ?? \`${globalProxy ? globalProxy.replace(/`/g, '\\`') : ''}\`\n${patch}\n// ------- End patched content -------\nconst APP_URL =`)

  if (data === patchedData || !patchedData) {
    console.error(chalk.redBright`[-] Patch failed`)
    await cleanUp()
  }

  fs.writeFileSync(indexPath, patchedData, 'utf-8')
  console.log(chalk.greenBright`[+] Patched index.js`)
  console.log(chalk.yellowBright`[+] Installing dependencies...`)
  try {
    const proc = spawn('npm install express axios', { cwd: tempPath, stdio: 'inherit', shell: true })
    activeProcesses.push(proc)
    await new Promise(resolve =>
      proc.on('close', resolve)
    )
    activeProcesses.splice(activeProcesses.indexOf(proc), 1)
    if (isCancelled) return
  } catch (e) {
    console.error(chalk.redBright`[-] An error occurred while installing dependencies`, e)
    await cleanUp()
  }
  rm(path.join(tempPath, 'package-lock.json'))
  fs.copyFileSync(filePath, `${filePath}.bak`)
  console.log(chalk.greenBright`[+] Backup created at {bold ${filePath}.bak}`)
  console.log(chalk.yellowBright`[+] Building app...`)
  await asar.createPackage(tempPath, filePath)
  rm(tempPath)
  console.log(chalk.greenBright`[+] HTTP Toolkit patched successfully`)
}

switch (argv._[0]) {
  case 'patch':
    await patchApp()
    break
  case 'restore':
    try {
      console.log(chalk.blueBright`[+] Restoring HTTP Toolkit...`)
      if (!fs.existsSync(path.join(appPath, 'app.asar.bak')))
        console.error(chalk.redBright`[-] HTTP Toolkit not patched or backup file not found`)
      else {
        fs.copyFileSync(path.join(appPath, 'app.asar.bak'), path.join(appPath, 'app.asar'))
        console.log(chalk.greenBright`[+] HTTP Toolkit restored`)
      }
      rm(path.join(os.tmpdir(), 'httptoolkit-patch'))
    } catch (e) {
      if (!isSudo && e.errno === -13) { //? Permission denied
        console.error(chalk.redBright`[-] Permission denied, try running ${!isWin ? 'with sudo' : 'node as administrator'}`)
        process.exit(1)
      }
      console.error(chalk.redBright`[-] An error occurred`, e)
      process.exit(1)
    }
    break
  case 'start':
    console.log(chalk.blueBright`[+] Starting HTTP Toolkit...`)
    try {
      const command =
        isWin ? `"${path.resolve(appPath, '..', 'HTTP Toolkit.exe')}"`
        : isMac ? 'open -a "HTTP Toolkit"'
        : 'httptoolkit'
      const proc = spawn(command, { stdio: 'inherit', shell: true })
      proc.on('close', code => process.exit(code))
    } catch (e) {
      console.error(chalk.redBright`[-] An error occurred`, e)
      if (isSudo) console.error(chalk.redBright`[-] Try running without sudo`)
      process.exit(1)
    }
    break
  default:
    console.error(chalk.redBright`[-] Unknown command`)
    process.exit(1)
}

if (!isCancelled) console.log(chalk.greenBright`[+] Done`)
