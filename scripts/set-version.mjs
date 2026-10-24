import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const packageFiles = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];
const lockPackagePaths = ['', 'apps/api', 'apps/web', 'packages/shared'];

export function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error('Version must use stable MAJOR.MINOR.PATCH format, for example 1.0.0.');
  }

  const parts = version.split('.').map(Number);
  if (parts.some((part, index) => String(part) !== version.split('.')[index])) {
    throw new Error('Version components must not contain leading zeroes.');
  }
  return parts;
}

function compareVersions(left, right) {
  const leftParts = validateVersion(left);
  const rightParts = validateVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function setVersion(repositoryRoot, nextVersion) {
  validateVersion(nextVersion);
  const root = resolve(repositoryRoot);
  const packageJsonFiles = await Promise.all(
    packageFiles.map(async (path) => [path, await readJson(resolve(root, path))]),
  );
  const currentVersion = packageJsonFiles[0][1].version;
  if (packageJsonFiles.some(([, packageJson]) => packageJson.version !== currentVersion)) {
    throw new Error('All workspace package versions must match before preparing a release.');
  }
  if (compareVersions(nextVersion, currentVersion) <= 0) {
    throw new Error(
      `Version ${nextVersion} must be greater than the current ${currentVersion}.`,
    );
  }

  const lockPath = resolve(root, 'package-lock.json');
  const lock = await readJson(lockPath);
  for (const path of lockPackagePaths) {
    if (!lock.packages?.[path] || lock.packages[path].version !== currentVersion) {
      throw new Error(
        `package-lock.json does not contain the expected ${path || 'root'} version.`,
      );
    }
    lock.packages[path].version = nextVersion;
  }

  const readmePath = resolve(root, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const currentVersionPattern = new RegExp(
    `(current application version is \\*\\*v)${escapeRegExp(currentVersion)}(\\*\\*)`,
    'u',
  );
  if (!currentVersionPattern.test(readme)) {
    throw new Error('README.md does not contain the current application version.');
  }

  const architecturePath = resolve(root, 'docs/architecture.md');
  const architecture = await readFile(architecturePath, 'utf8');
  const architecturePattern = new RegExp(
    `Home Memory Agent v${escapeRegExp(currentVersion)} is`,
    'u',
  );
  if (!architecturePattern.test(architecture)) {
    throw new Error('docs/architecture.md does not contain the current application version.');
  }

  const appPath = resolve(root, 'apps/web/src/App.tsx');
  const app = await readFile(appPath, 'utf8');
  const versionBadgePattern = /(<span className="version-tag">)v\d+\.\d+(<\/span>)/u;
  if (!versionBadgePattern.test(app)) {
    throw new Error('The application version badge could not be found.');
  }
  const [major, minor] = nextVersion.split('.');

  const updates = [
    ...packageJsonFiles.map(([path, packageJson]) => [
      resolve(root, path),
      `${JSON.stringify({ ...packageJson, version: nextVersion }, null, 2)}\n`,
    ]),
    [lockPath, `${JSON.stringify(lock, null, 2)}\n`],
    [readmePath, readme.replace(currentVersionPattern, `$1${nextVersion}$2`)],
    [
      architecturePath,
      architecture.replace(architecturePattern, `Home Memory Agent v${nextVersion} is`),
    ],
    [appPath, app.replace(versionBadgePattern, `$1v${major}.${minor}$2`)],
  ];

  await Promise.all(updates.map(([path, content]) => writeFile(path, content)));
  return { currentVersion, nextVersion };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const version = process.argv[2];
  if (!version) {
    throw new Error(
      'Pass the new version as an argument, for example: node scripts/set-version.mjs 1.0.0',
    );
  }
  const { currentVersion, nextVersion } = await setVersion(resolve('.'), version);
  console.log(`Updated Home Memory Agent from ${currentVersion} to ${nextVersion}.`);
}
