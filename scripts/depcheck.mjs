/**
 * scripts/depcheck.mjs — prints the "dependency card" for one npm package.
 *
 * Layer: tooling (never shipped). Usage: `npm run depcheck -- <package>`. Every PR that adds
 * a runtime dependency pastes this card into its "Dependencies & bundle" section, so the
 * numbers behind a library decision are measured, not remembered. It asks the npm registry
 * (`npm view`), npm's download-count API (fetch) and GitHub (`gh api`), then checks each
 * value against the floors in plan §11.3 "The dependency card". Plain JavaScript that runs
 * ahead of the primer's order: `?.`, `??`, destructuring, `...` spread and `try`/`catch` get
 * their primer sections when they first appear in src/. Read it for what it does, not how.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// execFile with a callback → a version that returns a Promise, so we can `await` it.
const execFileAsync = promisify(execFile);

const packageName = process.argv[2];
if (packageName === undefined) {
  console.error('usage: npm run depcheck -- <package>');
  process.exit(2);
}

/** `npm view <name> <fields...> --json`, parsed. Throws if the package does not exist. */
async function npmView(name, fields) {
  const { stdout } = await execFileAsync('npm', ['view', name, ...fields, '--json']);
  return JSON.parse(stdout);
}

/** One line saying why `npm view` failed. With --json, npm puts {error: {summary}} on stdout. */
function npmErrorSummary(error) {
  try {
    return JSON.parse(error.stdout).error.summary;
  } catch {
    // stdout was not npm's JSON (npm itself missing, network down): use the generic message.
    return String(error.message).split('\n')[0];
  }
}

/** npm's public download counter for the last 7 days; null when the API has no answer. */
async function weeklyDownloads(name) {
  // Scoped names (@scope/name) go into the URL as-is; encoding the slash breaks the API.
  const response = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`);
  if (!response.ok) {
    // Say so rather than report 0: a 404 here means "unknown package", not "unused".
    console.error(`downloads API returned ${response.status} for ${name}`);
    return null;
  }
  const body = await response.json();
  return body.downloads ?? 0;
}

/** "owner/repo" from the registry's repository URL, or null when it is not on GitHub. */
function githubRepoFromUrl(url) {
  const match = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/.exec(url ?? '');
  return match === null ? null : `${match[1]}/${match[2]}`;
}

/** Repo facts via the gh CLI (already logged in); null when gh is missing or fails. */
async function githubFacts(repo) {
  const jqFilter = '{stars: .stargazers_count, pushed: .pushed_at, archived: .archived, openIssues: .open_issues_count}';
  try {
    const { stdout } = await execFileAsync('gh', ['api', `repos/${repo}`, '--jq', jqFilter]);
    return JSON.parse(stdout);
  } catch (error) {
    console.error(`gh api failed for ${repo}: ${error.message.split('\n')[0]}`);
    return null;
  }
}

/** Where the TypeScript types come from: the package itself, DefinitelyTyped, or nowhere. */
async function typesSource(name, view) {
  if (view.types !== undefined || view.typings !== undefined) {
    return 'shipped by the package';
  }
  // @scope/name is published on DefinitelyTyped as @types/scope__name.
  const typesName = `@types/${name.replace(/^@/, '').replace('/', '__')}`;
  try {
    const version = await npmView(typesName, ['version']);
    return `${typesName}@${version}`;
  } catch {
    return 'none found';
  }
}

/** Days between an ISO date and now, for the "≤ N months" floors. */
function daysSince(isoDate) {
  return Math.round((Date.now() - Date.parse(isoDate)) / 86_400_000);
}

// Registry text and the package name from the command line end up on the terminal. A
// description or maintainer string could carry control characters — an escape sequence that
// recolours or rewrites the terminal, or a newline that forges an extra line of the card —
// so everything printed passes through here first. `\p{Cc}` is Unicode's "control"
// category (the C0 and C1 ranges, tab and newline included); ordinary letters, spaces and
// punctuation in any language survive.
function printable(text) {
  return String(text).replace(/\p{Cc}/gu, '');
}

const fields = ['version', 'time', 'license', 'maintainers', 'dependencies', 'scripts',
  'deprecated', 'types', 'typings', 'gypfile', 'binary', 'repository.url', 'dist.unpackedSize'];
// top-level await: see primer §6 (async / await)
let view;
try {
  view = await npmView(packageName, fields);
} catch (error) {
  // A misspelled name is the common failure; one line beats npm's stack trace.
  console.error(`depcheck: npm view failed for ${packageName}: ${npmErrorSummary(error)}`);
  process.exit(1);
}

const version = view.version;
const lastRelease = (view.time?.[version] ?? '').slice(0, 10);
const downloads = await weeklyDownloads(packageName);
const repo = githubRepoFromUrl(view['repository.url']);
const github = repo === null ? null : await githubFacts(repo);
// The registry returns "name <email>" strings; the card only needs the names. The `<…>` is
// cut first and the space before it trimmed afterwards. Two details keep the regex engine
// from re-trying work (SonarQube rule S8786): no leading `\s*`, which would make it restart
// from every space, and `[^<>]` rather than `[^>]`, so a scan that starts at one `<` can
// never run past another. A name is far too short for that to matter, but this form is
// also the easier read.
const maintainers = (view.maintainers ?? []).map((entry) => String(entry.name ?? entry).replace(/<[^<>]*>$/, '').trimEnd());
const directDependencies = Object.keys(view.dependencies ?? {});
const installScripts = ['preinstall', 'install', 'postinstall'].filter((key) => view.scripts?.[key]);
const types = await typesSource(packageName, view);
const unpackedKilobytes = Math.round((view['dist.unpackedSize'] ?? 0) / 1024);
const lastPush = (github?.pushed ?? '').slice(0, 10);
const downloadsText = downloads === null ? '?' : downloads.toLocaleString();

// The card, in the exact shape plan §11.3 asks for.
console.log(printable(
  `${packageName}@${version} · ${downloadsText} downloads/week · last release ${lastRelease || '?'}` +
  ` · last push ${lastPush || '?'} · archived: ${github?.archived ?? '?'} · deprecated: ${view.deprecated ? 'yes' : 'no'}` +
  ` · license ${view.license ?? '?'}`,
));
console.log(printable(
  `maintainers (${maintainers.length}): ${maintainers.join(', ') || '?'}` +
  ` · direct deps (${directDependencies.length}): ${directDependencies.join(', ') || 'none'}` +
  ` · install scripts: ${installScripts.join(', ') || 'none'} · types: ${types} · unpacked ${unpackedKilobytes} KB` +
  ' · bundle delta: run `npm run analyze` before and after',
));

// Pass/fail against the floors in plan §11.3. `?` means the value could not be measured.
const allowedLicenses = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];
const checks = [
  ['downloads/week ≥ 500,000', downloads !== null && downloads >= 500_000],
  ['last release ≤ 12 months', lastRelease !== '' && daysSince(lastRelease) <= 365],
  ['last push ≤ 6 months', lastPush !== '' && daysSince(lastPush) <= 183],
  ['not archived', github?.archived === false],
  ['not deprecated', !view.deprecated],
  ['license MIT/ISC/BSD/Apache-2.0', allowedLicenses.includes(view.license)],
  ['no install scripts', installScripts.length === 0],
  // `gypfile` means node-gyp compiles C++ on install; `binary` is how node-pre-gyp and
  // prebuild describe a downloaded .node file. Neither can ship in one .vsix.
  ['no native build fields (gypfile / binary)', view.gypfile !== true && view.binary === undefined],
  ['types available', types !== 'none found'],
  ['bus factor: ≥ 2 maintainers or ≥ 10M downloads/week (org-owned packages pass by hand)',
    maintainers.length >= 2 || (downloads !== null && downloads >= 10_000_000)],
];
console.log('');
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`);
}
// Two §11.3 floors that no registry field settles; the PR body records the answer.
console.log('CHECK BY HAND  native code: .node files or per-platform optionalDependencies in the tarball');
console.log('CHECK BY HAND  bus factor: org-owned (npm, Microsoft, GitHub, …) passes with one maintainer');
if (github !== null) {
  console.log(printable(`\nstars ${github.stars} · open issues ${github.openIssues} (stars are a tiebreak only, plan §11.3)`));
}
