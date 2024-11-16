// @ts-check
import { spawn } from 'child_process';
import asar from '@electron/asar';
import prompts from 'prompts';
import yargs from 'yargs';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import os from 'os';

const argv = await yargs(process.argv.slice(2))
  .command('patch', 'Patch HTTP Toolkit')
  .command('restore', 'Restore HTTP Toolkit')
  .command('start', 'Start HTTP Toolkit with debug logs enabled')
  .option('proxy', { alias: 'p', type: 'string' })
  .option('path', { alias: 'P', type: 'string' })
  .demandCommand(1)
  .parse();

const globalProxy = argv.proxy;
const isWin = process.platform === 'win32';
const isSudo = !isWin && (process.getuid || (() => process.env.SUDO_UID ? 0 : null))() === 0;

const getAppPath = () => {
  if (argv.path) {
    return argv.path.endsWith(isMac ? '/Resources' : '/resources')
      ? argv.path
      : path.join(argv.path, isMac ? '/Resources' : '/resources');
  }
  if (isWin) return path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'httptoolkit', 'resources');
  if (isMac) return '/Applications/HTTP Toolkit.app/Contents/Resources';
  if (fs.existsSync('/opt/HTTP Toolkit/resources')) return '/opt/HTTP Toolkit/resources';
  return '/opt/httptoolkit/resources';
};

const appPath = getAppPath();

const canWrite = (dirPath) => {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const rm = (dirPath) => {
  if (!fs.existsSync(dirPath)) return;
  if (!fs.lstatSync(dirPath).isDirectory()) return fs.rmSync(dirPath, { force: true });
  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry);
    if (fs.lstatSync(entryPath).isDirectory()) rm(entryPath);
    else fs.rmSync(entryPath, { force: true });
  }
};

const cleanUp = async () => {
  console.log(chalk.redBright`[-] Operation cancelled, cleaning up...`);
  const paths = [
    path.join(os.tmpdir(), 'httptoolkit-patch'),
    path.join(os.tmpdir(), 'httptoolkit-patcher-temp')
  ];
  try {
    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log(chalk.yellowBright`[+] Removing {bold ${p}}`);
        rm(p);
      }
    }
  } catch (e) {
    console.error(chalk.redBright`[-] An error occurred while cleaning up`, e);
  }
  process.exit(1);
};

const patchApp = async () => {
  const filePath = path.join(appPath, 'app.asar');
  const tempPath = path.join(os.tmpdir(), 'httptoolkit-patcher-temp');

  if (fs.readFileSync(filePath).includes('Injected by HTTP Toolkit Patcher')) {
    console.log(chalk.yellowBright`[!] HTTP Toolkit already patched`);
    return;
  }

  console.log(chalk.blueBright`[+] Started patching app...`);

  if (!canWrite(filePath)) {
    console.error(chalk.redBright`[-] Insufficient permissions to write to ${filePath}`);
    process.exit(1);
  }

  const { email } = await prompts({
    type: 'text',
    name: 'email',
    message: 'Enter an email for the pro plan',
    validate: (value) => value.includes('@') || 'Invalid email',
  });

  if (!email || typeof email !== 'string') {
    console.error(chalk.redBright`[-] Email not provided`);
    await cleanUp();
  }

  console.log(chalk.yellowBright`[+] Extracting app...`);
  rm(tempPath);

  try {
    asar.extractAll(filePath, tempPath);
  } catch (e) {
    if (!isSudo && e.errno === -13) {
      console.error(chalk.redBright`[-] Permission denied, try running ${!isWin ? 'with sudo' : 'node as administrator'}`);
      process.exit(1);
    }
    console.error(chalk.redBright`[-] An error occurred while extracting app`, e);
    process.exit(1);
  }

  const indexPath = path.join(tempPath, 'build', 'index.js');
  if (!fs.existsSync(indexPath)) {
    console.error(chalk.redBright`[-] Index file not found`);
    await cleanUp();
  }
  const data = fs.readFileSync(indexPath, 'utf-8');
  const patch = fs.readFileSync('patch.js', 'utf-8');
  const patchedData = data.replace(
    'const APP_URL =',
    `// ------- Injected by HTTP Toolkit Patcher -------
const email = \`${email.replace(/`/g, '\\`')}\`;
const globalProxy = process.env.PROXY ?? \`${globalProxy ? globalProxy.replace(/`/g, '\\`') : ''}\`;
${patch}
// ------- End patched content -------
const APP_URL =`
  );

  if (data === patchedData || !patchedData) {
    console.error(chalk.redBright`[-] Patch failed`);
    await cleanUp();
  }

  fs.writeFileSync(indexPath, patchedData, 'utf-8');
  console.log(chalk.greenBright`[+] Patched index.js`);
  console.log(chalk.yellowBright`[+] Installing dependencies...`);

  try {
    const proc = spawn('npm install express axios', { cwd: tempPath, stdio: 'inherit', shell: true });
    await new Promise((resolve) => proc.on('close', resolve));
    rm(path.join(tempPath, 'package-lock.json'));
    fs.copyFileSync(filePath, `${filePath}.bak`);
    console.log(chalk.greenBright`[+] Backup created at ${filePath}.bak`);
    console.log(chalk.yellowBright`[+] Building app...`);
    await asar.createPackage(tempPath, filePath);
    rm(tempPath);
    console.log(chalk.greenBright`[+] HTTP Toolkit patched successfully`);
  } catch (e) {
    console.error(chalk.redBright`[-] An error occurred while installing dependencies`, e);
    await cleanUp();
  }
};

switch (argv._[0]) {
  case 'patch':
    await patchApp();
    break;
  case 'restore':
    try {
      console.log(chalk.blueBright`[+] Restoring HTTP Toolkit...`);
      if (!fs.existsSync(path.join(appPath, 'app.asar.bak')))
        console.error(chalk.redBright`[-] HTTP Toolkit not patched or backup file not found`);
      else {
        fs.copyFileSync(path.join(appPath, 'app.asar.bak'), path.join(appPath, 'app.asar'));
        console.log(chalk.greenBright`[+] HTTP Toolkit restored`);
      }
    } catch (e) {
      console.error(chalk.redBright`[-] An error occurred`, e);
      process.exit(1);
    }
    break;
  case 'start':
    console.log(chalk.blueBright`[+] Starting HTTP Toolkit...`);
    try {
      const command =
        isWin ? `"${path.resolve(appPath, '..', 'HTTP Toolkit.exe')}"`
        : isMac ? 'open -a "HTTP Toolkit"'
        : 'httptoolkit';
      const proc = spawn(command, { stdio: 'inherit', shell: true });
      proc.on('close', (code) => process.exit(code));
    } catch (e) {
      console.error(chalk.redBright`[-] An error occurred`, e);
      process.exit(1);
    }
    break;
  default:
    console.error(chalk.redBright`[-] Unknown command`);
    process.exit(1);
}

console.log(chalk.greenBright`[+] Done`);
