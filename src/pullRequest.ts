import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_COMMAND_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const PULL_REQUEST_REF_NAMESPACE = 'refs/bygone/pr';
const PULL_REQUEST_BASE_REF_NAMESPACE = 'refs/bygone/base';
const DEFAULT_PARTIAL_CLONE_FILTER = 'blob:none';
const LOGIN_SHELL_PATH_TIMEOUT_MS = 3000;

/**
 * Absolute locations to check when the GitHub CLI is not on the current PATH.
 * A macOS app launched from Finder or the Dock inherits a minimal PATH that
 * excludes Homebrew, so `gh` has to be located rather than assumed.
 */
const GITHUB_CLI_FALLBACK_PATHS = Object.freeze([
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    '/usr/bin/gh',
    '/bin/gh',
    '/snap/bin/gh',
    'C:\\Program Files\\GitHub CLI\\gh.exe'
]);

export interface PullRequestRef {
    host?: string;
    owner?: string;
    repo?: string;
    number: number;
}

/**
 * The author's own account of a change. This travels into change tours and LLM
 * dossiers so narrative comes from stated intent rather than inference alone.
 */
export interface PullRequestSummary {
    number: number;
    title: string;
    body: string;
    author: string;
    url: string;
    state: string;
    baseRefName: string;
    headRefName: string;
    isCrossRepository: boolean;
}

export interface PullRequestMetadata extends PullRequestSummary {
    baseRefOid: string;
    headRefOid: string;
}

export function toPullRequestSummary(metadata: PullRequestMetadata): PullRequestSummary {
    return {
        number: metadata.number,
        title: metadata.title,
        body: metadata.body,
        author: metadata.author,
        url: metadata.url,
        state: metadata.state,
        baseRefName: metadata.baseRefName,
        headRefName: metadata.headRefName,
        isCrossRepository: metadata.isCrossRepository
    };
}

export interface PullRequestWorkspace {
    repoRoot: string;
    headRef: string;
    baseRef: string;
    /** True when Bygone provisioned its own cache repository instead of using the caller's clone. */
    provisioned: boolean;
    pullRequest: PullRequestMetadata;
}

export type RunCommand = (
    command: string,
    args: readonly string[],
    cwd: string,
    env?: NodeJS.ProcessEnv
) => string;

const PULL_REQUEST_URL_PATTERN = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pulls?\/(\d+)(?:[/?#].*)?$/i;
const QUALIFIED_PULL_REQUEST_PATTERN = /^(?:([^/\s]+)\/)?([^/\s]+)\/([^/\s#]+)#(\d+)$/;
const BARE_PULL_REQUEST_PATTERN = /^#?(\d+)$/;

export function createCommandRunner(maxBuffer = DEFAULT_COMMAND_MAX_BUFFER_BYTES): RunCommand {
    return (command, args, cwd, env) => execFileSync(command, [...args], {
        cwd,
        encoding: 'utf8',
        maxBuffer,
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe']
    }).trimEnd();
}

/**
 * Parse the pull request forms a user can reasonably paste or type.
 *
 * Owner and repository stay optional so a bare number keeps working inside a
 * clone, where the GitHub CLI already infers the repository from the remote.
 */
export function parsePullRequestRef(input: string): PullRequestRef | undefined {
    const trimmed = input.trim();
    if (!trimmed) {
        return undefined;
    }

    const url = PULL_REQUEST_URL_PATTERN.exec(trimmed);
    if (url) {
        return {
            host: url[1].toLowerCase(),
            owner: url[2],
            repo: stripGitSuffix(url[3]),
            number: Number.parseInt(url[4], 10)
        };
    }

    const qualified = QUALIFIED_PULL_REQUEST_PATTERN.exec(trimmed);
    if (qualified) {
        return {
            host: qualified[1]?.toLowerCase(),
            owner: qualified[2],
            repo: stripGitSuffix(qualified[3]),
            number: Number.parseInt(qualified[4], 10)
        };
    }

    const bare = BARE_PULL_REQUEST_PATTERN.exec(trimmed);
    if (bare) {
        return { number: Number.parseInt(bare[1], 10) };
    }

    return undefined;
}

/**
 * Whether a positional argument should be treated as a pull request rather than
 * a path. Bare numbers are excluded on purpose: `bygone 1753` must keep meaning
 * "open the file or directory named 1753".
 */
export function isPullRequestInput(value: string): boolean {
    const trimmed = value.trim();
    if (BARE_PULL_REQUEST_PATTERN.test(trimmed)) {
        return false;
    }
    return parsePullRequestRef(trimmed) !== undefined;
}

export function formatPullRequestRepository(ref: PullRequestRef): string | undefined {
    if (!ref.owner || !ref.repo) {
        return undefined;
    }
    const repository = `${ref.owner}/${ref.repo}`;
    return ref.host && ref.host !== 'github.com' ? `${ref.host}/${repository}` : repository;
}

export interface ResolveGitHubCliOptions {
    env?: NodeJS.ProcessEnv;
    candidates?: readonly string[];
    isExecutable?: (candidate: string) => boolean;
    readLoginShellPath?: (env: NodeJS.ProcessEnv) => string | undefined;
}

let cachedGitHubCliCommand: string | undefined;

/**
 * Locate the GitHub CLI.
 *
 * Resolution order is cheapest first: an explicit override, the current PATH,
 * well-known install locations, then the login shell's PATH. The last two exist
 * because a desktop app started outside a shell does not inherit the PATH the
 * user installed `gh` onto.
 *
 * Returns `gh` when nothing is found, so the caller still fails with the
 * install-and-authenticate message rather than a different error.
 */
export function resolveGitHubCliCommand(options: ResolveGitHubCliOptions = {}): string {
    const env = options.env ?? process.env;
    const isExecutable = options.isExecutable ?? isExecutableFile;

    if (env.BYGONE_GH_PATH) {
        return env.BYGONE_GH_PATH;
    }

    const onPath = findExecutableOnPath('gh', env.PATH, isExecutable);
    if (onPath) {
        return onPath;
    }

    for (const candidate of options.candidates ?? GITHUB_CLI_FALLBACK_PATHS) {
        if (isExecutable(candidate)) {
            return candidate;
        }
    }

    const readLoginShellPath = options.readLoginShellPath ?? readPathFromLoginShell;
    const loginShellPath = readLoginShellPath(env);
    const onLoginShellPath = loginShellPath
        ? findExecutableOnPath('gh', loginShellPath, isExecutable)
        : undefined;
    if (onLoginShellPath) {
        return onLoginShellPath;
    }

    return 'gh';
}

function resolveCachedGitHubCliCommand(): string {
    if (cachedGitHubCliCommand === undefined) {
        cachedGitHubCliCommand = resolveGitHubCliCommand();
    }
    return cachedGitHubCliCommand;
}

function findExecutableOnPath(
    command: string,
    searchPath: string | undefined,
    isExecutable: (candidate: string) => boolean
): string | undefined {
    if (!searchPath) {
        return undefined;
    }
    const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    for (const entry of searchPath.split(path.delimiter)) {
        if (!entry) {
            continue;
        }
        for (const extension of extensions) {
            const candidate = path.join(entry, `${command}${extension}`);
            if (isExecutable(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

function isExecutableFile(candidate: string): boolean {
    try {
        if (!fs.statSync(candidate).isFile()) {
            return false;
        }
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function readPathFromLoginShell(env: NodeJS.ProcessEnv): string | undefined {
    const shell = env.SHELL;
    if (!shell || process.platform === 'win32') {
        return undefined;
    }
    try {
        return execFileSync(shell, ['-lc', 'printf %s "$PATH"'], {
            encoding: 'utf8',
            timeout: LOGIN_SHELL_PATH_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim() || undefined;
    } catch {
        return undefined;
    }
}

const PULL_REQUEST_FIELDS = [
    'number',
    'title',
    'body',
    'author',
    'url',
    'state',
    'baseRefName',
    'headRefName',
    'baseRefOid',
    'headRefOid',
    'isCrossRepository'
].join(',');

export interface ResolvePullRequestOptions {
    /** Overrides the located GitHub CLI executable. Tests pass a stub here. */
    command?: string;
}

export function resolvePullRequest(
    ref: PullRequestRef,
    cwd: string,
    runCommand: RunCommand = createCommandRunner(),
    options: ResolvePullRequestOptions = {}
): PullRequestMetadata {
    const args = ['pr', 'view', String(ref.number), '--json', PULL_REQUEST_FIELDS];
    const repository = formatPullRequestRepository(ref);
    if (repository) {
        args.push('--repo', repository);
    }

    let output: string;
    try {
        output = runCommand(options.command ?? resolveCachedGitHubCliCommand(), args, cwd);
    } catch (error) {
        throw new Error(describeGitHubCliFailure(error, ref));
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(output);
    } catch {
        throw new Error(`The GitHub CLI returned output Bygone could not read for pull request ${ref.number}.`);
    }
    if (!isRecord(parsed)) {
        throw new Error(`The GitHub CLI returned no details for pull request ${ref.number}.`);
    }

    return {
        number: readNumber(parsed.number) ?? ref.number,
        title: readString(parsed.title) ?? `Pull request ${ref.number}`,
        body: readString(parsed.body) ?? '',
        author: readAuthorLogin(parsed.author),
        url: readString(parsed.url) ?? '',
        state: readString(parsed.state) ?? '',
        baseRefName: requireField(readString(parsed.baseRefName), 'baseRefName', ref),
        headRefName: readString(parsed.headRefName) ?? '',
        baseRefOid: requireField(readString(parsed.baseRefOid), 'baseRefOid', ref),
        headRefOid: requireField(readString(parsed.headRefOid), 'headRefOid', ref),
        isCrossRepository: parsed.isCrossRepository === true
    };
}

export interface EnsurePullRequestWorkspaceOptions {
    cacheRoot?: string;
    remoteUrl?: string;
    partialCloneFilter?: string | false;
    runCommand?: RunCommand;
}

/**
 * Guarantee that both sides of a pull request exist as local Git objects, and
 * return the repository and refs the existing branch-review pipeline expects.
 *
 * The caller's own clone is reused whenever it already tracks the same
 * repository. Otherwise Bygone provisions a cache repository, which the user is
 * never asked to think about.
 */
export function ensurePullRequestWorkspace(
    ref: PullRequestRef,
    pullRequest: PullRequestMetadata,
    cwd: string,
    options: EnsurePullRequestWorkspaceOptions = {}
): PullRequestWorkspace {
    const runCommand = options.runCommand ?? createCommandRunner();
    const headRef = `${PULL_REQUEST_REF_NAMESPACE}/${pullRequest.number}`;
    const baseRef = `${PULL_REQUEST_BASE_REF_NAMESPACE}/${pullRequest.number}`;
    const refspecs = [
        `+refs/pull/${pullRequest.number}/head:${headRef}`,
        `+refs/heads/${pullRequest.baseRefName}:${baseRef}`
    ];

    const local = findLocalRepositoryForPullRequest(ref, cwd, runCommand);
    if (local) {
        // Never add a partial-clone filter to a repository the user owns; that
        // would rewrite their fetch configuration as a side effect of a review.
        fetchRefspecs(local.repoRoot, local.remote, refspecs, undefined, runCommand);
        return { repoRoot: local.repoRoot, headRef, baseRef, provisioned: false, pullRequest };
    }

    const repository = formatPullRequestRepository(ref);
    if (!repository) {
        throw new Error(
            `Bygone could not tell which repository pull request ${pullRequest.number} belongs to. `
            + 'Run the command inside a clone, or pass the full pull request URL.'
        );
    }

    const repoRoot = provisionCacheRepository(ref, options, runCommand);
    const filter = options.partialCloneFilter === false
        ? undefined
        : options.partialCloneFilter ?? DEFAULT_PARTIAL_CLONE_FILTER;
    fetchRefspecs(repoRoot, 'origin', refspecs, filter, runCommand);
    return { repoRoot, headRef, baseRef, provisioned: true, pullRequest };
}

export function resolvePullRequestCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
    if (env.BYGONE_CACHE_DIR) {
        return path.join(env.BYGONE_CACHE_DIR, 'repos');
    }
    const xdgCacheHome = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
    return path.join(xdgCacheHome, 'bygone', 'repos');
}

function provisionCacheRepository(
    ref: PullRequestRef,
    options: EnsurePullRequestWorkspaceOptions,
    runCommand: RunCommand
): string {
    const cacheRoot = options.cacheRoot ?? resolvePullRequestCacheRoot();
    const host = ref.host || 'github.com';
    const repoRoot = path.join(cacheRoot, host, ref.owner as string, ref.repo as string);
    const remoteUrl = options.remoteUrl ?? `https://${host}/${ref.owner}/${ref.repo}.git`;

    if (!fs.existsSync(path.join(repoRoot, '.git'))) {
        fs.mkdirSync(repoRoot, { recursive: true });
        // An empty, never-checked-out repository is deliberate. It is an object
        // store, so `git status` reports a clean tree and reviews are never
        // marked dirty by a working tree that does not exist.
        runCommand('git', ['init', '--quiet'], repoRoot);
    }

    const existingRemote = tryRunCommand(runCommand, 'git', ['remote', 'get-url', 'origin'], repoRoot);
    if (!existingRemote) {
        runCommand('git', ['remote', 'add', 'origin', remoteUrl], repoRoot);
    } else if (existingRemote !== remoteUrl) {
        runCommand('git', ['remote', 'set-url', 'origin', remoteUrl], repoRoot);
    }

    return fs.realpathSync(repoRoot);
}

function fetchRefspecs(
    repoRoot: string,
    remote: string,
    refspecs: readonly string[],
    filter: string | undefined,
    runCommand: RunCommand
): void {
    const credentialArgs = buildGitCredentialArgs();
    const env = buildGitEnvironment();
    const fetchArgs = ['fetch', '--no-tags', '--quiet'];

    if (filter) {
        try {
            runCommand('git', [...credentialArgs, ...fetchArgs, `--filter=${filter}`, remote, ...refspecs], repoRoot, env);
            return;
        } catch {
            // Not every host supports partial clone. A full fetch is slower but
            // always correct, so fall through rather than failing the review.
        }
    }

    try {
        runCommand('git', [...credentialArgs, ...fetchArgs, remote, ...refspecs], repoRoot, env);
    } catch (error) {
        throw new Error(
            `Could not fetch the pull request from ${remote}: ${getErrorMessage(error)}\n`
            + 'Check network access and that your GitHub account can read the repository. '
            + 'Run `gh auth status` to confirm the GitHub CLI is signed in to the right host.'
        );
    }
}

/**
 * Authenticate Bygone's own fetches through the GitHub CLI.
 *
 * Passed with `-c` so nothing is written to a repository the user owns. Git
 * consults configured helpers first, so this only supplies credentials that
 * were not already available, which is what a private repository over HTTPS
 * needs when `gh auth setup-git` has never been run.
 */
export function buildGitCredentialArgs(command = resolveCachedGitHubCliCommand()): string[] {
    return ['-c', `credential.helper=!${quoteForShell(command)} auth git-credential`];
}

/**
 * A desktop app has no terminal, so a credential prompt cannot be answered and
 * surfaces as "Device not configured". Disabling prompts turns that into a
 * deterministic failure. The GitHub CLI's directory joins PATH so a credential
 * helper the user already configured as `!gh ...` still resolves.
 */
export function buildGitEnvironment(
    baseEnv: NodeJS.ProcessEnv = process.env,
    command = resolveCachedGitHubCliCommand()
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...baseEnv, GIT_TERMINAL_PROMPT: '0' };
    const commandDirectory = path.dirname(command);
    if (path.isAbsolute(command) && !splitSearchPath(env.PATH).includes(commandDirectory)) {
        env.PATH = env.PATH ? `${commandDirectory}${path.delimiter}${env.PATH}` : commandDirectory;
    }
    return env;
}

function splitSearchPath(searchPath: string | undefined): string[] {
    return searchPath ? searchPath.split(path.delimiter) : [];
}

function quoteForShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface LocalRepositoryMatch {
    repoRoot: string;
    remote: string;
}

function findLocalRepositoryForPullRequest(
    ref: PullRequestRef,
    cwd: string,
    runCommand: RunCommand
): LocalRepositoryMatch | undefined {
    if (!ref.owner || !ref.repo) {
        // Without an explicit repository the pull request number was resolved
        // against this clone in the first place, so this clone is the match.
        const repoRoot = tryRunCommand(runCommand, 'git', ['rev-parse', '--show-toplevel'], cwd);
        return repoRoot ? { repoRoot: fs.realpathSync(repoRoot), remote: 'origin' } : undefined;
    }

    const repoRoot = tryRunCommand(runCommand, 'git', ['rev-parse', '--show-toplevel'], cwd);
    if (!repoRoot) {
        return undefined;
    }

    const remotes = tryRunCommand(runCommand, 'git', ['remote'], repoRoot);
    if (!remotes) {
        return undefined;
    }

    for (const remote of remotes.split('\n').map((line) => line.trim()).filter(Boolean)) {
        const url = tryRunCommand(runCommand, 'git', ['remote', 'get-url', remote], repoRoot);
        const identity = url ? parseRemoteIdentity(url) : undefined;
        if (identity
            && identity.owner.toLowerCase() === ref.owner.toLowerCase()
            && identity.repo.toLowerCase() === ref.repo.toLowerCase()) {
            return { repoRoot: fs.realpathSync(repoRoot), remote };
        }
    }

    return undefined;
}

export function parseRemoteIdentity(url: string): { host: string; owner: string; repo: string } | undefined {
    const trimmed = url.trim();
    const scp = /^(?:[^@\s]+@)?([^:/\s]+):([^/\s]+)\/(.+)$/.exec(trimmed);
    if (scp && !trimmed.includes('://')) {
        return { host: scp[1].toLowerCase(), owner: scp[2], repo: stripGitSuffix(scp[3]) };
    }

    const remote = /^[a-z+]+:\/\/(?:[^@/\s]+@)?([^/\s]+)\/([^/\s]+)\/(.+)$/i.exec(trimmed);
    if (remote) {
        return { host: remote[1].toLowerCase(), owner: remote[2], repo: stripGitSuffix(remote[3]) };
    }

    return undefined;
}

function describeGitHubCliFailure(error: unknown, ref: PullRequestRef): string {
    if (isRecord(error) && error.code === 'ENOENT') {
        return 'Reviewing a pull request needs the GitHub CLI, and Bygone could not find it. '
            + 'If it is not installed, install it from https://cli.github.com and run `gh auth login`. '
            + 'If it is installed, a desktop app started outside a terminal does not inherit your shell '
            + 'PATH: set BYGONE_GH_PATH to the full path of `gh`.';
    }

    const detail = readCommandStderr(error) || getErrorMessage(error);
    if (/gh auth login|authentication|not logged/i.test(detail)) {
        return `The GitHub CLI is not authenticated: ${detail}\nRun \`gh auth login\`.`;
    }

    const repository = formatPullRequestRepository(ref);
    return `Could not read pull request ${ref.number}${repository ? ` in ${repository}` : ''}: ${detail}`;
}

function requireField(value: string | undefined, field: string, ref: PullRequestRef): string {
    if (!value) {
        throw new Error(`The GitHub CLI did not report \`${field}\` for pull request ${ref.number}.`);
    }
    return value;
}

function readAuthorLogin(value: unknown): string {
    if (isRecord(value)) {
        return readString(value.login) ?? readString(value.name) ?? '';
    }
    return readString(value) ?? '';
}

function readCommandStderr(error: unknown): string {
    if (isRecord(error) && error.stderr) {
        return String(error.stderr).trim();
    }
    return '';
}

function tryRunCommand(
    runCommand: RunCommand,
    command: string,
    args: readonly string[],
    cwd: string
): string {
    try {
        return runCommand(command, args, cwd).trim();
    } catch {
        return '';
    }
}

function stripGitSuffix(value: string): string {
    return value.replace(/\.git$/i, '').replace(/\/$/, '');
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
