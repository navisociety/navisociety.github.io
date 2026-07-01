// Regression suite for navi-create's pure title-derivation logic.
// Run with (dummy Supabase env vars needed because importing index.ts runs
// createClient() and serve() at module load time as a side effect - neither
// is actually exercised by these tests, but the import will throw/bind a
// port without them):
//   SUPABASE_URL=http://localhost:0 SUPABASE_SERVICE_ROLE_KEY=test \
//     deno test --allow-net --allow-env supabase/functions/navi-create/_test.ts
import { assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts';
import { deriveTitle } from './index.ts';

Deno.test('deriveTitle', () => {
  assertEquals(deriveTitle('  '), 'New Creation');
  assertEquals(deriveTitle('Sunday Service Announcement Flyer For Everyone Extra'), 'Sunday Service Announcement Flyer For Everyone');
});
