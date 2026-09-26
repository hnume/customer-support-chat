// ============================================================
// ตรวจกฎการ import ระหว่าง layer — ถ้ามีคน import ย้อนขึ้นจะ fail
// รัน: npm run lint:layers  (และรันใน npm test ด้วย)
// ============================================================
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', 'src');

/** layer → layer ที่อนุญาตให้ import (อ้างด้วย prefix ของ path ใต้ src/) */
const RULES: { layer: string; allow: string[]; forbidPackages?: string[] }[] = [
  { layer: 'business/models', allow: ['business/models', 'pkg/utils'], forbidPackages: ['*'] },
  { layer: 'business/ports', allow: ['business/models'], forbidPackages: ['*'] },
  { layer: 'business/usecases', allow: ['business/models', 'business/ports', 'business/usecases', 'pkg/utils'], forbidPackages: ['*'] },
  { layer: 'repositories', allow: ['repositories', 'business/models', 'business/ports', 'pkg/db', 'pkg/utils'], forbidPackages: ['express', 'socket.io'] },
  { layer: 'pkg', allow: ['pkg', 'business/models', 'business/ports'], forbidPackages: ['express', 'socket.io'] },
  { layer: 'workers', allow: ['workers', 'business/usecases'] },
  { layer: 'api', allow: ['api', 'business/models', 'business/ports', 'business/usecases', 'pkg'], forbidPackages: ['pg', '@electric-sql/pglite'] },
  { layer: 'cmd', allow: [''] }, // entry ประกอบทุกอย่างได้
];

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const NODE_BUILTINS = new Set(['fs', 'path', 'http', 'crypto', 'url', 'os', 'events']);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  );
}

export function checkLayers(): string[] {
  const violations: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const rule = RULES.find((r) => rel.startsWith(r.layer + '/') || rel === r.layer + '.ts');
    if (!rule) { violations.push(`${rel}: ไม่อยู่ใน layer ใดเลย`); continue; }
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) {
        const target = path.relative(SRC, path.resolve(path.dirname(file), spec)).split(path.sep).join('/');
        if (!rule.allow.some((a) => a === '' || target === a || target.startsWith(a + '/'))) {
          violations.push(`${rel} → ${target}  (${rule.layer} ห้าม import ${target.split('/').slice(0, 2).join('/')})`);
        }
      } else {
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const forbid = rule.forbidPackages ?? [];
        const bad = forbid.includes('*') ? !NODE_BUILTINS.has(pkg) : forbid.includes(pkg);
        if (bad) violations.push(`${rel} → package "${pkg}"  (${rule.layer} ต้องไม่ผูกกับ library นี้)`);
      }
    }
  }
  return violations;
}

if (require.main === module) {
  const v = checkLayers();
  if (v.length) {
    console.error(`❌ พบการ import ผิด layer ${v.length} จุด:\n` + v.map((x) => '  - ' + x).join('\n'));
    process.exit(1);
  }
  console.log('✅ ทุก layer import ถูกทิศทาง');
}
