const { classifyCommit } = require('./classify');
const pad = ['import os', 'import sys', '', 'def helper(value):', '    return value', ''];
const cases = [
  ['precedence: drop parens before operator', 'x = (a + b) * c', 'x = a + b * c', 'py', false],
  ['precedence: parens after ==', 'ok = flag == (a or b)', 'ok = flag == a or b', 'py', false],
  ['tuple comma removed', 'point = (x,)', 'point = (x)', 'py', false],
  ['method on grouped expr', 'n = (a + b).bit_length()', 'n = a + b.bit_length()', 'py', false],
  ['docstring inner whitespace', 'def f():\n    """Return the  total."""\n    return 1', 'def f():\n    """Return the total."""\n    return 1', 'py', false],
  ['multi-line string middle edit', 's = """first\nmiddle line\nlast"""', 's = """first\nmiddle  line\nlast"""', 'py', false],
  ['escaped quote string', "s = 'it\\'s'", 's = "it\'s"', 'py', false],
  ['python dedent out of if', 'if ready:\n    start()\n    stop()', 'if ready:\n    start()\nstop()', 'py', false],
  ['yaml re-nesting', 'a:\n  b: 1\n  c: 2', 'a:\n  b: 1\nc: 2', 'yaml', false],
  ['js template literal spacing', 'const s = `a  b`;', 'const s = `a b`;', 'ts', false],
  // positives that should be explained
  ['grouping parens added on wrap', 'x = compute_total(items)', 'x = (\n    compute_total(items)\n)', 'py', true],
  ['quote style', "name = 'value'", 'name = "value"', 'py', true],
  ['trailing comma list', 'v = [1, 2, 3]', 'v = [\n    1,\n    2,\n    3,\n]', 'py', true],
  ['continuation indent', 'total = fn(a,\n           b)', 'total = fn(\n    a,\n    b,\n)', 'py', true],
];
let wrong = 0;
for (const [name, l, r, ext, shouldExplain] of cases) {
  const left = [...pad, l, ...pad.map(x => x.replace('helper', 'helper2'))].join('\n');
  const right = [...pad, r, ...pad.map(x => x.replace('helper', 'helper2'))].join('\n');
  const res = classifyCommit([{ path: `x.${ext}`, left, right }], { renames: false });
  const c = res.counts; const explained = c.formatting + c.rename + c.moved;
  const ok = shouldExplain ? explained === c.raw : explained === 0;
  if (!ok) wrong++;
  console.log(ok ? 'ok  ' : 'FAIL', name.padEnd(38), JSON.stringify({ raw: c.raw, fmt: c.formatting, ws: c.semanticWs, res: c.residual, line: c.lineLevel }));
}
console.log('wrong', wrong);
