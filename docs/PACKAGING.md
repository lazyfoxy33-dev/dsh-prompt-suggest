# Packaging and installation: npm vs. GitHub

This project is a **DSH bundle**. It is not published to npm. This page explains how npm packages work,
how DSH installs a bundle from GitHub, and why the repository is distributed the way it is.

中文摘要见文末。

## 1. What npm actually is

npm is a package registry plus a client. A package is identified by `name` and `version`:

- Unscoped: `dsh-prompt-suggest`
- Scoped: `@scope/name` (the scope is also the publish permission boundary)

A published version is essentially a **gzipped tarball** of the package directory plus metadata. The
registry stores the tarball, its integrity hash, and a manifest extracted from `package.json`.

Key `package.json` fields for a CLI/plugin package:

| Field | Meaning |
|---|---|
| `name`, `version` | Identity. A version should be immutable after publish. |
| `main` / `module` / `exports` | Entry points the consumer may import. |
| `files` | Allowlist of paths included in the tarball (`npm pack` respects it). |
| `dependencies` / `peerDependencies` | Runtime and host-provided dependencies. |
| `engines` | Declared runtime constraints; npm warns or errors depending on settings. |
| `scripts` | Lifecycle commands such as `prepare`, `install`, `postinstall`. |
| `bin` | Executables linked into `node_modules/.bin`. |
| `license`, `repository`, `homepage` | Metadata shown on npm and used by tooling. |

Publishing:

```sh
npm pack --dry-run     # inspect exactly what would be uploaded
npm publish            # upload tarball + metadata (requires auth and 2FA if enabled)
```

The registry adds a **dist-tag** (usually `latest`) pointing at the new version. Consumers install by
range (`^1.2.0`), by exact version, or by tag. npm resolves a version, verifies the tarball integrity
hash, and writes it into `node_modules`.

Lifecycle scripts matter for supply-chain safety: `preinstall`/`install`/`postinstall` run with the
installing user's privileges. `npm install --ignore-scripts` skips them. DSH's bundle installer may also
require explicit build-script approval; this project deliberately has **no install scripts**.

## 2. How npm installs a dependency

A simplified flow:

1. Read the root `package.json` and existing lockfile.
2. Resolve each dependency to an exact version (semver range + dist-tags + lockfile).
3. Fetch the tarball, verify integrity, extract into `node_modules`.
4. Link `bin` entries and write/refresh the lockfile.
5. Run lifecycle scripts, subject to configuration.

A lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) records exact resolved versions and
integrity hashes so installs are reproducible. `npm ci` is the reproducible install path.

Git dependencies are different: `npm install github:user/repo#tag` fetches a Git repository (or a tarball
built from it), reads its `package.json`, and runs the `prepare` script if present. Git tags are mutable
unless protected; a commit SHA is the reproducible reference.

## 3. What a DSH bundle is

A DSH plugin can be shipped as a **bundle package**. The package declares:

```json
{
  "name": "dsh-prompt-suggest",
  "version": "1.0.0",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["..."] }
  }
}
```

- `dsh.bundle.patch` points to a Cordis composition patch. DSH applies it to the profile's composition
  when the bundle is loaded, inserting the plugin row.
- `dsh.client` tells DSH that the package also has a Web client module to load into the browser UI.
- The Host half (`index.js`) runs in the DSH Host; the client half (`client.js`) runs in the browser
  module loader. In this project both are plain JavaScript and have no build step.

A profile records installed bundles in its `package.json`, roughly:

```json
{
  "dependencies": {
    "dsh-prompt-suggest": "github:lazyfoxy33-dev/dsh-prompt-suggest#v1.0.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-prompt-suggest"]
    }
  }
}
```

The package manager places the code under the profile's `node_modules`; DSH reads the bundle manifest,
applies the patch, and mounts the plugin. This is why a GitHub dependency is sufficient without npm.

## 4. Installing this repository

Pin a tag or commit for reproducibility:

```sh
dsh plugin --profile <profile> add github:lazyfoxy33-dev/dsh-prompt-suggest#v1.0.0
```

Desktop app equivalent: **Plugins → install bundle** with the same spec.

The package has no install scripts and no runtime dependencies. After installation, enable the bundle if
needed and reload the page.

The repository also publishes a Discover index pinned to a specific commit:

```text
https://lazyfoxy33-dev.github.io/dsh-prompt-suggest/index.json
```

The Discover entry's `source.commit` is what the client installs; it is intentionally **not** floating on
`main`. Documentation-only commits do not change that pinned source.

## 5. Why this project does not publish to npm

- **Distribution is not a goal for this project.** GitHub plus the Discover index is enough for the
  intended audience.
- npm publication adds account, 2FA, name-ownership, and supply-chain obligations. A public package name
  can be squatted or imitated if ownership lapses.
- A GitHub tag/commit is a narrower, auditable reference: users can read the exact code they install.
- Updates are explicit: change the tag/commit, or reinstall.

If npm publication is ever desired, the minimum checklist is:

1. Choose an available name (scoped if necessary) and set `private` to `false`.
2. Verify `files` includes only runtime code, locale files, docs, and license.
3. Bump `version`, run tests, `npm pack --dry-run`, then publish with 2FA/provenance.
4. Configure dist-tags and document the install command.
5. Keep the GitHub tag and npm version aligned.

## 6. Trust and review

A DSH plugin runs inside the Host process and can read files and call tools. Treat installation like
running code, not like loading a stylesheet.

Before installing:

- Read `index.js` (Host routes and model calls) and `client.js` (browser UI and Tab handling).
- Check for install scripts (`scripts.install`, `postinstall`, `prepare`) and network calls.
- Pin a tag or commit; compare it with `git ls-remote` / the GitHub release.
- Run `node --test test/host.test.mjs` from the package directory if you want to exercise the Host tests.
- Review the privacy section of the README: suggestion generation sends conversation context and bounded
  accepted/dismissed examples to the selected model provider.

---

## 中文摘要

- npm 是「注册表 + 客户端」：包由 `name@version` 标识，发布时上传 tarball（按 `files` 白名单打包）
  和元数据，注册表用 dist-tag（通常 `latest`）指向版本。
- 安装时 npm 解析 semver 范围、下载 tarball、校验完整性、解压到 `node_modules`，并可能执行
  `preinstall`/`install`/`postinstall` 脚本。锁文件记录精确版本和哈希，`npm ci` 可复现。
- DSH bundle 也是 npm 包格式，只是多声明 `dsh.bundle.patch` 和 `dsh.client`。DSH 把包放进 profile 的
  `node_modules`，读取 manifest 并应用 Cordis patch 来挂载插件。
- 从 GitHub 安装（`github:user/repo#tag`）不需要 npm 发布；tag 或 commit 就是版本。
- 本项目**没有发布 npm 包**，也不以分发为目标；GitHub + Discover 索引已足够。仓库没有安装脚本，
  建议固定 tag/commit、审阅代码后再安装。
- 生成建议时，对话上下文和有限的采纳/忽略示例会发给所选模型提供商；学习记录本身只存本机。
