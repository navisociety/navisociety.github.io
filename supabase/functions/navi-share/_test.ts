// Regression suite for navi-share's pure account/share helpers.
// Run with (dummy Supabase env vars needed because importing index.ts runs
// createClient() and serve() at module load time as a side effect - neither
// is actually exercised by these tests; --no-check because esm.sh's current
// supabase-js@2 resolution pulls types that want @types/node — `deno check
// index.ts` still passes and covers the module):
//   SUPABASE_URL=http://localhost:0 SUPABASE_SERVICE_ROLE_KEY=test \
//     deno test --no-check --allow-net --allow-env supabase/functions/navi-share/_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import {
  cleanHandle,
  clampCaption,
  isPlatform,
  extForType,
  upsertAccount,
  removeAccount,
  base64ToBytes,
  emailToFolder,
  type ConnectedAccount,
} from './index.ts';

Deno.test('isPlatform accepts the five slots and nothing else', () => {
  for (const p of ['Instagram', 'TikTok', 'Facebook', 'YouTube', 'X']) assert(isPlatform(p), p);
  assert(!isPlatform('instagram'));
  assert(!isPlatform('MySpace'));
  assert(!isPlatform(undefined));
});

Deno.test('cleanHandle strips @, whitespace and clamps', () => {
  assertEquals(cleanHandle('@prophet dian '), 'prophetdian');
  assertEquals(cleanHandle('@@double'), 'double');
  assertEquals(cleanHandle('   '), '');
  assertEquals(cleanHandle(undefined), '');
  assertEquals(cleanHandle('x'.repeat(50)).length, 30);
});

Deno.test('clampCaption trims and clamps to 2200', () => {
  assertEquals(clampCaption('  hello  '), 'hello');
  assertEquals(clampCaption(undefined), '');
  assertEquals(clampCaption('a'.repeat(3000)).length, 2200);
});

Deno.test('extForType maps allowed media, rejects the rest', () => {
  assertEquals(extForType('image/png'), 'png');
  assertEquals(extForType('image/jpeg'), 'jpg');
  assertEquals(extForType('video/mp4'), 'mp4');
  assertEquals(extForType('video/quicktime'), 'mov');
  assertEquals(extForType('application/pdf'), null);
  assertEquals(extForType(undefined), null);
});

Deno.test('upsertAccount replaces an existing slot instead of duplicating', () => {
  const now = '2026-07-16T00:00:00.000Z';
  let list: ConnectedAccount[] = [];
  list = upsertAccount(list, 'Instagram', 'old', now);
  list = upsertAccount(list, 'TikTok', 'tik', now);
  list = upsertAccount(list, 'Instagram', 'new', now);
  assertEquals(list.length, 2);
  assertEquals(list.find(a => a.platform === 'Instagram')?.handle, 'new');
});

Deno.test('removeAccount clears only the named slot', () => {
  const now = '2026-07-16T00:00:00.000Z';
  const list = upsertAccount(upsertAccount([], 'Instagram', 'ig', now), 'X', 'ex', now);
  const next = removeAccount(list, 'Instagram');
  assertEquals(next.length, 1);
  assertEquals(next[0].platform, 'X');
  assertEquals(removeAccount(next, 'YouTube').length, 1);
});

Deno.test('base64ToBytes round-trips', () => {
  const bytes = base64ToBytes(btoa('navi'));
  assertEquals(new TextDecoder().decode(bytes), 'navi');
});

Deno.test('emailToFolder is storage-path safe', () => {
  assertEquals(emailToFolder('Prophet.Dian+test@Gmail.com'), 'prophet_dian_test_gmail_com');
  assert(!/[^a-z0-9_]/.test(emailToFolder('weird!#$@x.y')));
});
