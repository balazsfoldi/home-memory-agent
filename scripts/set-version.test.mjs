import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setVersion, validateVersion } from './set-version.mjs';

test('accepts stable semantic versions and rejects malformed input', () => {
  assert.deepEqual(validateVersion('1.0.0'), [1, 0, 0]);
  assert.throws(() => validateVersion('v1.0.0'), /MAJOR\.MINOR\.PATCH/u);
  assert.throws(() => validateVersion('1.01.0'), /leading zeroes/u);
  assert.throws(() => validateVersion('1.0.0-rc.1'), /MAJOR\.MINOR\.PATCH/u);
});

test('updates package versions, lockfile, README, architecture, and UI badge together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'home-memory-version-'));
  try {
    for (const directory of ['apps/api', 'apps/web/src', 'packages/shared', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const packagePaths = [
      'package.json',
      'apps/api/package.json',
      'apps/web/package.json',
      'packages/shared/package.json',
    ];
    for (const path of packagePaths) {
      await writeFile(
        join(root, path),
        `${JSON.stringify({ name: path, version: '0.5.0' }, null, 2)}\n`,
      );
    }
    await writeFile(
      join(root, 'package-lock.json'),
      `${JSON.stringify(
        {
          packages: Object.fromEntries(
            ['', 'apps/api', 'apps/web', 'packages/shared'].map((path) => [
              path,
              { version: '0.5.0' },
            ]),
          ),
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(root, 'README.md'),
      'The current application version is **v0.5.0**.\n',
    );
    await writeFile(
      join(root, 'docs/architecture.md'),
      'Home Memory Agent v0.5.0 is a test app.\n',
    );
    await writeFile(
      join(root, 'apps/web/src/App.tsx'),
      '<span className="version-tag">v0.5</span>\n',
    );

    const result = await setVersion(root, '1.0.0');
    assert.deepEqual(result, { currentVersion: '0.5.0', nextVersion: '1.0.0' });
    for (const path of packagePaths) {
      assert.equal(JSON.parse(await readFile(join(root, path), 'utf8')).version, '1.0.0');
    }
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    assert.deepEqual(
      Object.values(lock.packages).map((entry) => entry.version),
      ['1.0.0', '1.0.0', '1.0.0', '1.0.0'],
    );
    assert.match(await readFile(join(root, 'README.md'), 'utf8'), /\*\*v1\.0\.0\*\*/u);
    assert.match(await readFile(join(root, 'docs/architecture.md'), 'utf8'), /v1\.0\.0/u);
    assert.match(await readFile(join(root, 'apps/web/src/App.tsx'), 'utf8'), />v1\.0</u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses to downgrade or reuse the current version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'home-memory-version-'));
  try {
    for (const directory of ['apps/api', 'apps/web/src', 'packages/shared', 'docs']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    for (const path of [
      'package.json',
      'apps/api/package.json',
      'apps/web/package.json',
      'packages/shared/package.json',
    ]) {
      await writeFile(join(root, path), '{"version":"0.5.0"}\n');
    }
    await writeFile(
      join(root, 'package-lock.json'),
      JSON.stringify({
        packages: Object.fromEntries(
          ['', 'apps/api', 'apps/web', 'packages/shared'].map((path) => [
            path,
            { version: '0.5.0' },
          ]),
        ),
      }),
    );
    await writeFile(
      join(root, 'README.md'),
      'The current application version is **v0.5.0**.\n',
    );
    await writeFile(
      join(root, 'docs/architecture.md'),
      'Home Memory Agent v0.5.0 is a test app.\n',
    );
    await writeFile(
      join(root, 'apps/web/src/App.tsx'),
      '<span className="version-tag">v0.5</span>\n',
    );
    await assert.rejects(setVersion(root, '0.5.0'), /must be greater/u);
    assert.equal(
      JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
      '0.5.0',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
