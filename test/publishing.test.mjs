import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import console from 'node:console';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishMarketplace } from '../scripts/publish-marketplace.mjs';

let root;
let vsce;

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  root = await mkdtemp(path.join(os.tmpdir(), 'make-run-publish-'));
  const manifest = { name: 'make-run-tasks', publisher: 'ai-follwer', version: '1.7.8' };
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.7.8', packages: { '': manifest } }));
  vsce = {
    createVSIX: vi.fn(async ({ packagePath }) => { await writeFile(packagePath, 'packaged-extension'); }),
    publishVSIX: vi.fn(),
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('local Marketplace publishing', () => {
  it('builds a fresh versioned package in out and uploads that exact artifact', async () => {
    const packagePath = await publishMarketplace({}, { root, env: { VSCE_PAT: 'test-credential' }, vsce });
    expect(packagePath).toBe(path.join(root, 'out', 'make-run-tasks-1.7.8.vsix'));
    expect(vsce.createVSIX).toHaveBeenCalledWith({ cwd: root, packagePath, dependencies: false, useYarn: false });
    expect(vsce.publishVSIX).toHaveBeenCalledWith(packagePath, { pat: 'test-credential' });
  });

  it('does not upload anything in preview mode', async () => {
    await publishMarketplace({ dryRun: true }, { root, env: {}, vsce });
    expect(vsce.createVSIX).toHaveBeenCalledOnce();
    expect(vsce.publishVSIX).not.toHaveBeenCalled();
  });

  it('stops before upload when checks or packaging fail', async () => {
    vsce.createVSIX.mockRejectedValue(new Error('Check failed'));
    await expect(publishMarketplace({}, { root, env: {}, vsce })).rejects.toThrow('Check failed');
    expect(vsce.publishVSIX).not.toHaveBeenCalled();
  });

  it('rejects mismatched versions before packaging or uploading', async () => {
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.7.7' }));
    await expect(publishMarketplace({}, { root, env: {}, vsce })).rejects.toThrow('versions differ');
    expect(vsce.createVSIX).not.toHaveBeenCalled();
    expect(vsce.publishVSIX).not.toHaveBeenCalled();
  });

  it('rejects invalid identities before deriving an artifact path', async () => {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: '../other-file', publisher: 'ai-follwer', version: '1.7.8',
    }));
    await expect(publishMarketplace({}, { root, env: {}, vsce })).rejects.toThrow('package.json');
    expect(vsce.createVSIX).not.toHaveBeenCalled();
  });

  it('does not upload an empty generated artifact', async () => {
    vsce.createVSIX.mockImplementation(async ({ packagePath }) => { await writeFile(packagePath, ''); });
    await expect(publishMarketplace({}, { root, env: {}, vsce })).rejects.toThrow('empty');
    expect(vsce.publishVSIX).not.toHaveBeenCalled();
  });

  it('selects Azure authentication without passing a PAT when both are present locally', async () => {
    const packagePath = await publishMarketplace({ azureCredential: true }, { root, env: { VSCE_PAT: 'unused-test-credential' }, vsce });
    expect(vsce.publishVSIX).toHaveBeenCalledWith(packagePath, { azureCredential: true });
  });

  it('uses vsce login credentials when no PAT environment variable is set', async () => {
    const packagePath = await publishMarketplace({}, { root, env: {}, vsce });
    expect(vsce.publishVSIX).toHaveBeenCalledWith(packagePath, { pat: undefined });
  });

  it('keeps upload failures visible instead of reporting a successful release', async () => {
    vsce.publishVSIX.mockRejectedValue(new Error('Version already exists'));
    await expect(publishMarketplace({}, { root, env: {}, vsce })).rejects.toThrow('Version already exists');
  });
});
