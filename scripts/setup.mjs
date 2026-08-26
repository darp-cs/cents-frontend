import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const devEnvPath = path.join(rootDir, 'src', 'environments', 'environment.development.ts');
const prodEnvPath = path.join(rootDir, 'src', 'environments', 'environment.ts');

const devEnvTemplate = `export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:8000',
};
`;

const prodEnvTemplate = `export const environment = {
  production: true,
  apiBaseUrl: 'https://api.example.com',
};
`;

function runNpmInstall() {
  const installMode = existsSync(path.join(rootDir, 'package-lock.json')) ? 'ci' : 'install';
  console.log(`\n[setup] Installing dependencies with npm ${installMode}...\n`);

  const result = spawnSync(npmCommand, [installMode], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureEnvironmentFile(filePath, templateContent) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, templateContent, 'utf8');
    console.log(`[setup] Created ${path.relative(rootDir, filePath)} from template.`);
    return;
  }

  const current = readFileSync(filePath, 'utf8');
  if (!current.includes('apiBaseUrl')) {
    writeFileSync(filePath, templateContent, 'utf8');
    console.log(`[setup] Replaced ${path.relative(rootDir, filePath)} with a valid template.`);
  } else {
    console.log(`[setup] Found ${path.relative(rootDir, filePath)}.`);
  }
}

function printNextSteps() {
  console.log('\n[setup] Setup complete.');
  console.log('[setup] Next steps:');
  console.log('  1) Update src/environments/environment.development.ts apiBaseUrl if needed.');
  console.log('  2) Start dev server: npm run start');
  console.log('  3) Open: http://localhost:4200');
}

runNpmInstall();
ensureEnvironmentFile(devEnvPath, devEnvTemplate);
ensureEnvironmentFile(prodEnvPath, prodEnvTemplate);
printNextSteps();
