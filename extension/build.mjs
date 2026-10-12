import { build } from 'esbuild'; import fs from 'node:fs';
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (public values only).'); process.exit(1); }
if (/service_role/i.test(key)) { console.error('Refusing: service-role key detected.'); process.exit(1); }
fs.rmSync('dist', { recursive: true, force: true }); fs.mkdirSync('dist', { recursive: true });
await build({ entryPoints: ['src/background.ts', 'src/popup.ts', 'src/content.ts'], bundle: true, outdir: 'dist', format: 'esm', target: 'chrome120', minify: true,
  define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_KEY__: JSON.stringify(key) } });
fs.copyFileSync('src/popup.html', 'dist/popup.html');
const iconSrc = fs.existsSync('src/icons') ? 'src/icons' : fs.existsSync('icons') ? 'icons' : null;
if (iconSrc) { fs.cpSync(iconSrc, 'dist/icons', { recursive: true }); }
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8')); m.host_permissions = [new URL(url).origin + '/*'];
fs.writeFileSync('dist/manifest.json', JSON.stringify(m, null, 2)); console.log('Built dist/');
