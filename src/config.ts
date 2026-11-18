import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface AdvisorConfig {
  saveDir: string | null;
  gameDir: string | null;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AdvisorConfig {
  return {
    saveDir: env.CK3_SAVE_DIR ?? null,
    gameDir: env.CK3_GAME_DIR ?? null,
  };
}

const SAVE_TAIL = "Paradox Interactive/Crusader Kings III/save games";
// Windows localizes the Documents folder; OneDrive "known folder backup" moves it under OneDrive.
const DOC_FOLDERS = ["Documents", "Documentos"];

export interface DiscoverOptions {
  env?: NodeJS.ProcessEnv;
  /** WSL mount of the Windows users folder. */
  usersRoot?: string;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function discoverSaveDir(opts: DiscoverOptions = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const usersRoot = opts.usersRoot ?? "/mnt/c/Users";

  // Native Windows: OneDrive-redirected Documents first, then the plain profile folder.
  const home = env.USERPROFILE;
  const roots = [env.OneDrive, home && join(home, "OneDrive"), home].filter(
    (r): r is string => !!r,
  );
  for (const root of roots) {
    for (const doc of DOC_FOLDERS) {
      const candidate = join(root, doc, SAVE_TAIL);
      if (await isDir(candidate)) return candidate;
    }
  }

  // WSL: scan the Windows users mounted under /mnt/c.
  let users: string[];
  try {
    users = await readdir(usersRoot);
  } catch {
    return null;
  }
  for (const u of users) {
    const candidate = `${usersRoot}/${u}/Documents/${SAVE_TAIL}`;
    if (await isDir(candidate)) return candidate;
  }
  return null;
}

const GAME_FOLDER = "Crusader Kings III";

export interface DiscoverGameOptions {
  env?: NodeJS.ProcessEnv;
  /** Steam install folders to look in; defaults to the usual Windows and WSL locations. */
  steamRoots?: string[];
}

function defaultSteamRoots(env: NodeJS.ProcessEnv): string[] {
  const programFiles = [env["ProgramFiles(x86)"], env.ProgramFiles].filter((p): p is string => !!p);
  return [
    ...programFiles.map((p) => join(p, "Steam")),
    join("C:\\", "Program Files (x86)", "Steam"),
    "/mnt/c/Program Files (x86)/Steam",
  ];
}

// libraryfolders.vdf lists every Steam library as `"path" "E:\SteamLibrary"` (backslashes doubled).
async function steamLibraries(steamRoot: string): Promise<string[]> {
  let vdf: string;
  try {
    vdf = await readFile(join(steamRoot, "steamapps", "libraryfolders.vdf"), "utf8");
  } catch {
    return [steamRoot];
  }
  const extra = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1]!.replaceAll("\\\\", "\\"));
  return [steamRoot, ...extra];
}

// The install root holds `game/localization`; accept the `game` folder itself as well.
async function hasGameFiles(dir: string): Promise<boolean> {
  return (
    (await isDir(join(dir, "game", "localization"))) || (await isDir(join(dir, "localization")))
  );
}

/** Finds the Steam install of CK3 (checking every Steam library). CK3_GAME_DIR overrides it. */
export async function discoverGameDir(opts: DiscoverGameOptions = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const seen = new Set<string>();
  for (const root of opts.steamRoots ?? defaultSteamRoots(env)) {
    for (const lib of await steamLibraries(root)) {
      const candidate = join(lib, "steamapps", "common", GAME_FOLDER);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (await hasGameFiles(candidate)) return candidate;
    }
  }
  return null;
}
