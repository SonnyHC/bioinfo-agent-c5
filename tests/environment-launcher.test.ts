import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { launcherActionIds, launcherDownloads, launcherUrl } from '../web/src/environment-launcher.ts';

interface LauncherAction {
  id: string;
  platform: 'windows' | 'macos';
  title: string;
  envName: string;
  condaPackages: string[];
  rPackages?: string[];
}

const actions = JSON.parse(readFileSync(new URL('../native/environment-launcher/catalog.json', import.meta.url), 'utf8')) as LauncherAction[];
const sourceFile = (path: string) => readFileSync(new URL(`../web/public/resources/v1/${path}`, import.meta.url), 'utf8');
function archiveFile(id: string, filename: string): string {
  const archive = unzipSync(readFileSync(new URL(`../web/public/resources/v1/environments/${id}.zip`, import.meta.url)));
  assert(archive[filename], `${id} must contain ${filename}`);
  return new TextDecoder().decode(archive[filename]);
}
function action(id: string): LauncherAction {
  const found = actions.find(item => item.id === id);
  assert(found, `Missing action: ${id}`);
  return found;
}
function yamlEnvironment(text: string): {name: string; packages: string[]} {
  const name = /^name:\s*(\S+)\s*$/m.exec(text)?.[1];
  const dependencies = /^dependencies:\s*\r?\n([\s\S]+)$/m.exec(text)?.[1];
  assert(name && dependencies, 'Expected a named environment with dependencies');
  const packages = [...dependencies.matchAll(/^\s+-\s+(\S+)\s*$/gm)].map(match => match[1]);
  assert(packages.length > 0);
  return {name, packages};
}

test('launcher actions are a fixed platform-specific set with executable package arguments', () => {
  assert.deepEqual(actions.map(item => item.id).sort(), [
    'case-single-cell-macos', 'case-single-cell-windows',
    'case-spatial-macos', 'case-spatial-windows',
    'single-cell-macos', 'single-cell-windows', 'spatial-macos', 'spatial-windows',
  ]);
  for (const item of actions) {
    assert.equal(item.platform, item.id.endsWith('-windows') ? 'windows' : 'macos');
    assert.match(item.envName, /^[a-z][a-z0-9_-]*$/);
    assert(item.condaPackages.length > 0);
    assert.equal(new Set(item.condaPackages).size, item.condaPackages.length);
    for (const packageSpec of item.condaPackages) assert.match(packageSpec, /^[a-z][a-z0-9_-]*(?:=[A-Za-z0-9_.]+)?$/);
    for (const packageName of item.rPackages ?? []) assert.match(packageName, /^[A-Za-z][A-Za-z0-9.]*$/);
  }
});

test('web links address only packaged installation actions and reject injected destinations or arguments', () => {
  assert.deepEqual([...launcherActionIds].sort(), actions.map(item => item.id).sort());
  for (const item of actions) {
    const destination = new URL(launcherUrl(item.id));
    assert.equal(destination.protocol, 'bioinfobuddy:');
    assert.equal(destination.hostname, 'install');
    assert.equal(destination.pathname, `/${item.id}`);
    assert.equal(destination.username + destination.password + destination.port + destination.search + destination.hash, '');
  }
  for (const id of [
    '', 'unknown', 'single-cell-windows/extra', '../single-cell-windows',
    'single-cell-windows?command=whoami', 'single-cell-windows#extra',
    'single-cell-windows%2Fextra', 'single-cell-windows%0Awhoami',
    'single-cell-windows\nwhoami', 'single-cell-windows;whoami',
    'single-cell-windows && whoami', 'single-cell-windows"',
    'bioinfobuddy://install/single-cell-windows', 'https://example.com/install',
  ]) assert.throws(() => launcherUrl(id), Error, `Unexpected accepted action: ${JSON.stringify(id)}`);
});

test('Windows environment actions retain the supplied YAML names and dependencies', () => {
  for (const id of ['single-cell-windows', 'spatial-windows']) {
    const source = yamlEnvironment(archiveFile(id, 'environment.yml'));
    assert.equal(action(id).envName, source.name);
    assert.deepEqual(action(id).condaPackages, source.packages);
    assert.equal(action(id).rPackages, undefined);
  }
});

test('macOS environment actions derive R dependencies and Python packages from the supplied files', () => {
  const rRows = archiveFile('single-cell-macos', 'sc-conda-packages.txt').split(/\r?\n/)
    .filter(line => /^r-\S+\s+/.test(line)).map(line => line.trim().split(/\s+/));
  assert(rRows.length > 0);
  const rSpecs = rRows.map(([name, version]) => name === 'r-base' ? `${name}=${version}` : name);
  assert.deepEqual([...action('single-cell-macos').condaPackages].sort(), rSpecs.sort());

  const pythonText = archiveFile('spatial-macos', 'st_miniconda.txt');
  const creation = /^conda create -n (\S+) (.+)$/m.exec(pythonText);
  const installation = /^conda install (.+)$/m.exec(pythonText);
  assert(creation && installation);
  const packageArgs = (args: string) => args.trim().split(/\s+/).filter(token => token !== '-y');
  assert.equal(action('spatial-macos').envName, creation[1]);
  assert.deepEqual(action('spatial-macos').condaPackages, [...packageArgs(creation[2]), ...packageArgs(installation[1])]);
  assert(action('spatial-macos').condaPackages.includes('squidpy'));
  assert(!action('spatial-windows').condaPackages.includes('squidpy'));
  assert(action('spatial-windows').condaPackages.includes('scanpy=1.12.1'));
  assert(action('spatial-macos').condaPackages.includes('scanpy'));
});

test('case actions install the dependencies shipped with the actual case workflows', () => {
  const rInstaller = sourceFile('single-cell/install.R');
  const declaration = /^packages\s*<-\s*c\(([^\n]+)\)/m.exec(rInstaller)?.[1];
  assert(declaration, 'Expected the case installer package declaration');
  const rPackages = [...declaration.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert(rPackages.length > 0);
  const spatial = yamlEnvironment(sourceFile('spatial/environment.yml'));
  for (const platform of ['windows', 'macos']) {
    const rCase = action(`case-single-cell-${platform}`);
    const rEnvironment = action(`single-cell-${platform}`);
    assert.equal(rCase.envName, rEnvironment.envName);
    assert.deepEqual(rCase.condaPackages, rEnvironment.condaPackages);
    assert.deepEqual(rCase.rPackages, rPackages);
    const pythonCase = action(`case-spatial-${platform}`);
    assert.equal(pythonCase.envName, spatial.name);
    assert.deepEqual(pythonCase.condaPackages, spatial.packages);
    assert.equal(pythonCase.rPackages, undefined);
  }
});

test('downloaded launchers contain the current platform catalogs and installer sources', () => {
  const archives = Object.fromEntries(Object.entries(launcherDownloads).map(([platform, url]) => [
    platform, unzipSync(readFileSync(new URL(`../web/public${url}`, import.meta.url))),
  ]));
  const decoded = (archive: Record<string, Uint8Array>, member: string) => {
    assert(archive[member]?.byteLength, `Missing packaged file: ${member}`);
    return new TextDecoder().decode(archive[member]).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  };
  const windowsPrefix = 'BioInfoBuddy-Launcher-Windows/';
  assert.deepEqual(JSON.parse(decoded(archives.windows, windowsPrefix + 'catalog.json')),
    actions.filter(item => item.platform === 'windows'));
  const windowsSources = new URL('../native/environment-launcher/windows/', import.meta.url);
  for (const name of readdirSync(windowsSources).filter(name => /\.(?:ps1|cmd)$/.test(name) && name !== 'tests.ps1')) {
    const source = readFileSync(new URL(name, windowsSources), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    assert.equal(decoded(archives.windows, windowsPrefix + name), source, `Rebuild Windows launcher after editing ${name}`);
  }

  const macResources = 'BioInfoBuddy Launcher.app/Contents/Resources/';
  assert.equal(decoded(archives.macos, macResources + 'install.sh'),
    readFileSync(new URL('../native/environment-launcher/macos/install.sh', import.meta.url), 'utf8'),
    'Rebuild macOS launcher after editing install.sh');
  const bundledActions = Object.keys(archives.macos).filter(member => member.startsWith(macResources + 'actions/') && member.endsWith('.command'));
  assert.deepEqual(bundledActions.sort(), actions.filter(item => item.platform === 'macos')
    .map(item => `${macResources}actions/${item.id}.command`).sort());
  for (const member of bundledActions) assert(decoded(archives.macos, member).startsWith('#!/bin/bash\n'));
});
