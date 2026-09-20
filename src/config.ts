import * as fs from 'fs';
import * as path from 'path';

/** The shape of wiki.config.json. The schema beside this package is the source of truth
 *  for editors; this type is what the preset and defineWikiConfig read. */
export interface WikiConfig {
  title: string;
  tagline: string;
  url: string;
  organizationName: string;
  projectName: string;
  copyright: string;
  noindex: boolean;
  description: string;
  gate?: {
    type?: 'password' | 'freedom-account' | 'none';
    unlockParam?: string | null;
    machinePaths?: 'open' | 'gated';
    signInUrl?: string;
    openPaths?: string;
    grantDays?: number;
    title?: string;
  };
  og?: { bg?: string; accent?: string; text?: string; muted?: string };
  intake_mode?: 'source-grounded' | 'authored-canon';
  skill_prefix?: string;
  hero_register?: Record<string, unknown>;
  hero?: Record<string, unknown>;
  $schema?: string;
}

const REQUIRED: (keyof WikiConfig)[] = [
  'title', 'tagline', 'url', 'organizationName', 'projectName', 'copyright', 'noindex', 'description',
];

/** Options passed to the preset win; `<siteDir>/wiki.config.json` fills the rest. */
export function readWikiConfig(siteDir: string, options: Partial<WikiConfig> = {}): WikiConfig {
  const file = path.join(siteDir, 'wiki.config.json');
  let fromFile: Partial<WikiConfig> = {};
  if (fs.existsSync(file)) {
    fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else if (Object.keys(options).length === 0) {
    throw new Error(`No wiki.config.json at ${file} and no preset options given.`);
  }
  const merged = { ...fromFile, ...options } as Partial<WikiConfig>;
  for (const key of REQUIRED) {
    if (merged[key] === undefined) {
      throw new Error(`wiki.config.json is missing required field "${key}" (looked in ${file} and preset options).`);
    }
  }
  return merged as WikiConfig;
}
