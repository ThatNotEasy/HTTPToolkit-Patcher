import { spawn } from 'child_process';
import prompts from 'prompts';
import yargs from 'yargs';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import os from 'os';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const argv = await yargs(process.argv.slice(2))
  .command('patch', 'Patch HTTP Toolkit')
  .option('proxy', { alias: 'p', type: 'string' })
  .option('path', { alias: 'P', type: 'string' })
  .demandCommand(1)
  .parse();

const downloadMainJs = async (url, outputPath) => {
  console.log(chalk.blueBright`[+] Downloading main.js from ${url}`);
  const response = await axios.get(url, { responseType: 'stream' });
  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
};

const patchMainJs = async () => {
  const tempDir = path.join(os.tmpdir(), 'httptoolkit-patcher-temp');
  const mainJsPath = path.join(tempDir, 'main.js');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Download main.js
    await downloadMainJs('https://app.httptoolkit.tech/main.js', mainJsPath);
    console.log(chalk.greenBright`[+] Successfully downloaded main.js`);

    // Get user email for patch
    const { email } = await prompts({
      type: 'text',
      name: 'email',
      message: 'Enter an email for the pro plan',
      validate: (value) => value.includes('@') || 'Invalid email',
    });

    if (!email || typeof email !== 'string') {
      console.error(chalk.redBright`[-] Email not provided`);
      return;
    }

    // Read main.js content
    let data = fs.readFileSync(mainJsPath, 'utf-8');

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
    fs.writeFileSync(mainJsPath, patchedData, 'utf-8');
    console.log(chalk.greenBright`[+] Patched main.js successfully at ${mainJsPath}`);

    // Optional: Replace main.js in local app if required, or serve it as needed
  } catch (error) {
    console.error(chalk.redBright`[-] An error occurred:`, error);
  }
};

switch (argv._[0]) {
  case 'patch':
    await patchMainJs();
    break;
  default:
    console.error(chalk.redBright`[-] Unknown command`);
    process.exit(1);
}

console.log(chalk.greenBright`[+] Done`);
