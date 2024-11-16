import { spawn } from 'child_process';
import asar from '@electron/asar';
import prompts from 'prompts';
import yargs from 'yargs';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import os from 'os';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

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

const argv = await yargs(process.argv.slice(2))
  .command('patch', 'Patch HTTP Toolkit')
  .command('restore', 'Restore HTTP Toolkit')
  .command('start', 'Start HTTP Toolkit with debug logs enabled')
  .option('proxy', { alias: 'p', type: 'string' })
  .option('path', { alias: 'P', type: 'string' })
  .demandCommand(1)
  .parse();

const globalProxy = argv.proxy;
const appPath = argv.path || getAppPath();

const rm = (dirPath) => {
  if (!fs.existsSync(dirPath)) return;
  if (!fs.lstatSync(dirPath).isDirectory()) return fs.rmSync(dirPath, { force: true });
  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry);
    if (fs.lstatSync(entryPath).isDirectory()) rm(entryPath);
    else fs.rmSync(entryPath, { force: true });
  }
};

const canWrite = (dirPath) => {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// Helper function to find main.js dynamically
const findFile = (dir, fileName) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const result = findFile(fullPath, fileName);
      if (result) return result;
    } else if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }
  return null;
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

  console.log(chalk.yellowBright`[+] Extracting app.asar...`);
  rm(tempPath);

  try {
    asar.extractAll(filePath, tempPath);
  } catch (e) {
    console.error(chalk.redBright`[-] Error extracting app.asar:`, e);
    return;
  }

  // Dynamically find the main.js file
  const indexPath = findFile(tempPath, 'main.js');
  if (!indexPath) {
    console.error(chalk.redBright`[-] main.js file not found in the extracted app.asar`);
    await cleanUp();
  }

  let data = fs.readFileSync(indexPath, 'utf-8');

  // Inject custom account details for Pro plan
  const injectedUserData = `
    const user = {
      email: "${email}",
      subscription: {
        status: "active",
        quantity: 1,
        expiry: new Date("9999-12-31").toISOString(),
        sku: "pro-annual",
        plan: "pro-annual",
        tierCode: "pro",
        interval: "annual",
        canManageSubscription: true,
        updateBillingDetailsUrl: "https://app.httptoolkit.tech/billing"
      }
    };
    user.subscription.expiry = new Date(user.subscription.expiry);
  `;

  const patchedData = `${injectedUserData}\n${data}`;
  
  fs.writeFileSync(indexPath, patchedData, 'utf-8');
  console.log(chalk.greenBright`[+] Patched main.js successfully`);

  try {
    await asar.createPackage(tempPath, filePath);
    console.log(chalk.greenBright`[+] Repacked app.asar with patch`);
  } catch (e) {
    console.error(chalk.redBright`[-] Error repacking app.asar:`, e);
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
