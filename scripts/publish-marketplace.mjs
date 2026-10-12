import console from 'node:console';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function publishMarketplace(
  { dryRun = false, azureCredential = false } = {},
  { root = projectRoot, env = process.env, vsce } = {},
) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(manifest.name ?? '')
    || !/^[a-z0-9][a-z0-9-]*$/i.test(manifest.publisher ?? '')
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version ?? '')) {
    throw new Error('package.json must define a publisher, name, and stable major.minor.patch version.');
  }
  if (lockfile.version !== manifest.version || lockfile.packages?.['']?.version !== manifest.version) {
    throw new Error('Package and lockfile versions differ. Use npm version patch --no-git-tag-version to update them together.');
  }

  const packagePath = path.join(root, 'out', `${manifest.name}-${manifest.version}.vsix`);
  const api = vsce ?? await import('@vscode/vsce');
  await mkdir(path.dirname(packagePath), { recursive: true });
  console.log(`Preparing ${manifest.publisher}.${manifest.name} ${manifest.version}`);
  // createVSIX runs vscode:prepublish, including the project's checks and build.
  await api.createVSIX({ cwd: root, packagePath, dependencies: false, useYarn: false });
  if ((await stat(packagePath)).size === 0) {
    throw new Error('The generated VSIX is empty. Publishing was stopped.');
  }

  if (dryRun) {
    console.log(`Preview complete: ${packagePath}. Nothing was uploaded.`);
  } else {
    await api.publishVSIX(packagePath, azureCredential
      ? { azureCredential: true }
      : { pat: env.VSCE_PAT || undefined });
    console.log(`Published: https://marketplace.visualstudio.com/items?itemName=${manifest.publisher}.${manifest.name}`);
  }
  return packagePath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      'dry-run': { type: 'boolean', default: false },
      'azure-credential': { type: 'boolean', default: false },
    } });
    await publishMarketplace({ dryRun: values['dry-run'], azureCredential: values['azure-credential'] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Marketplace publishing failed: ${process.env.VSCE_PAT ? message.replaceAll(process.env.VSCE_PAT, '[REDACTED]') : message}`);
    process.exitCode = 1;
  }
}
