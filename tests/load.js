// Loads apps-script/JobTracker.gs into a Node vm context without changing it.
// Top-level `const`/`function` declarations don't become context properties, so we
// evaluate the file plus a trailing expression that returns the names we need.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT = path.join(__dirname, '..', 'apps-script', 'JobTracker.gs');
const src = fs.readFileSync(SCRIPT, 'utf8');

const NAMES = ['parseFrontmatter_', 'unquote_', 'clean_', 'oneOf_', 'toDate_', 'key_', 'folderId_',
  'norm_', 'titleOverlap_', 'colLetter_', 'isUS_', 'pastTermsOnly_', 'locationOk_', 'leadPrefs_',
  'buildRow_', 'isApplied_', 'COLS', 'CATEGORIES', 'DEFAULT_LEAD_STATES'];

function loadScript(globals = {}) {
  const context = vm.createContext({ console, ...globals });
  return vm.runInContext(src + `\n;({ ${NAMES.join(', ')} })`, context, { filename: SCRIPT });
}

// Values made inside the vm use its own Array/Object prototypes, which makes
// assert.deepStrictEqual fail. Copy them into this realm before comparing.
const plain = (v) => JSON.parse(JSON.stringify(v));

module.exports = { loadScript, plain };
