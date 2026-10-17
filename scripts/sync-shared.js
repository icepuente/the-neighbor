// Copies shared/*.js into web/js/shared/ (served to browsers) and functions/shared/ (uploaded with
// the Cloud Functions). Firebase deploys only those two folders, so code used by both lives in
// shared/ and is copied before the emulators start and before every deploy. The copies are
// git-ignored: edit shared/, never the copies.
// A copy is only written when it differs: rewriting an unchanged file makes the running Functions
// emulator reload, and requests during the reload fail.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'shared');
const targets = [join(root, 'web', 'js', 'shared'), join(root, 'functions', 'shared')];

const files = readdirSync(source).filter((f) => f.endsWith('.js'));
for (const target of targets) {
  // functions/ arrives in phase 1 step 3; until then there is nothing to copy into.
  if (!existsSync(dirname(target))) continue;
  mkdirSync(target, { recursive: true });
  const changed = files.filter((f) => !existsSync(join(target, f))
    || !readFileSync(join(source, f)).equals(readFileSync(join(target, f))));
  for (const f of changed) copyFileSync(join(source, f), join(target, f));
  console.log(`shared: ${changed.length} of ${files.length} file(s) updated -> ${target.slice(root.length + 1)}`);
}
