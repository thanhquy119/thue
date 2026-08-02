import {mkdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const spec = JSON.parse(readFileSync(new URL('../content/video.json', import.meta.url), 'utf8'));
const slug = String(spec.slug || 'legal-video').replace(/[^a-z0-9-]+/giu, '-').replace(/^-+|-+$/gu, '');
const compositionId = String(spec.compositionId || 'LegalVideo');
const output = `out/${slug || 'legal-video'}.mp4`;

mkdirSync('out', {recursive: true});
const result = spawnSync(
  'npx',
  [
    'remotion',
    'render',
    'src/index.ts',
    compositionId,
    output,
    '--codec=h264',
    '--crf=22',
    '--audio-codec=aac',
    ...process.argv.slice(2),
  ],
  {stdio: 'inherit', shell: process.platform === 'win32'},
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
