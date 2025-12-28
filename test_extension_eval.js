const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('extension.js', 'utf8');

function extract(pattern) {
  const m = code.match(pattern);
  return m ? m[0] : null;
}

// Extract a contiguous helper block starting from `const SPEED_UNITS` up to
// (but not including) `const toSpeedParts`, then append the full
// `toSpeedParts` definition. This ensures constants moved outside the
// function (like DOWN_ARROW, UNIT_WIDTH, NBSP) are included.
const startIdx = code.indexOf('const SPEED_UNITS');
const toSpeedIdx = code.indexOf('const toSpeedParts');

if (startIdx === -1 || toSpeedIdx === -1) {
  console.error('Could not find helper block boundaries in extension.js');
  process.exit(1);
}

const helperBlock = code.slice(startIdx, toSpeedIdx);
const toSpeedFnCode = extract(/const\s+toSpeedParts\s*=\s*\([\s\S]*?\n\};/m);
if (!toSpeedFnCode) {
  console.error('Failed to extract toSpeedParts from extension.js');
  process.exit(1);
}

const sandbox = { console, require };
vm.createContext(sandbox);

const wrapped = `${helperBlock}\n${toSpeedFnCode}\n\nthis.formatSpeedWithUnit = formatSpeedWithUnit;\nthis.toSpeedParts = toSpeedParts;`;

try {
  const script = new vm.Script(wrapped, { filename: 'extracted_helpers.js' });
  script.runInContext(sandbox);

  const fn = sandbox.toSpeedParts || (sandbox.module && sandbox.module.exports && sandbox.module.exports.toSpeedParts);
  if (!fn) {
    console.error('toSpeedParts not found after evaluating extracted code');
    process.exit(1);
  }

  const examples = [
    { down: 0, up: 0 },
    { down: 1.23, up: 12.3 },
    { down: 123.45, up: 1234.5 },
    { down: 1234567, up: 9876543 }
  ];

  // Simulate colored output using ANSI codes for demonstration
  const downloadColor = '\x1b[36m'; // Cyan
  const uploadColor = '\x1b[33m';   // Yellow/Orange
  const reset = '\x1b[0m';

  for (const ex of examples) {
    const { downloadText, uploadText } = fn(ex);
    // Show colorized output in terminal
    console.log(`${downloadColor}${downloadText}${reset}  ${uploadColor}${uploadText}${reset}`);
  }
} catch (e) {
  console.error('Error evaluating extracted helpers:', e);
  process.exit(1);
}
