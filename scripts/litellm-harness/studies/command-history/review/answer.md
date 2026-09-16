## Defect 1 — `prioritize` under-counts `visited`, letting a priority path's parent directory be re‑visited by `walk`

`visit()` increments `count` and records `visited`, but `walk()` never checks `visited` before `readdir`. When a priority path is a file inside a directory that `walk` will later descend into, the walk re-reads that directory. With `SNAPSHOT_LIMITS.files` tight enough, this extra `visit` on the file (already visited) is a no-op for `visited` — *but* `prioritize` also calls `visit` on ancestor dirs that `walk` will visit again. The bug: `visited.has(path)` short-circuits the count increment, so `walk`'s `visit(path)` for every already-seen dir is free; but `walk` still `readdir`s them. The consequence is that the entry-limit budget is consumed only by *new* entries, so a priority path can push `walk` to truncate before it reaches a same-name entry, causing a legitimately new file to be silently dropped when `truncated` is later checked. This is the concrete regression the tests do **not** cover: priority coverage suppresses a real creation because `walk` truncates earlier than the unprioritized baseline.

Minimal reproduction:

```ts
import {expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshotWorkspace,snapshotChanges,SNAPSHOT_LIMITS} from '../server/workspace-snapshot';

it('priority visit consumes walk entry budget, fabricating absence', async()=>{
  const root=await mkdtemp(join(tmpdir(),'snap-'));
  const lim=SNAPSHOT_LIMITS.files;
  try{
    SNAPSHOT_LIMITS.files=2;
    await writeFile(join(root,'a'),'A');
    // 'z' will be added later
    const before=await snapshotWorkspace(root,[],['a']); // visits root,a => count=2
    await writeFile(join(root,'z'),'Z');                 // genuinely new
    const after=await snapshotWorkspace(root,[],Object.keys(before.files));
    // walk: visit(root)=noop, a=noop, z=>count=3>2 => truncated, z never captured
    // 'z' is not in absent (priority list didn't include it), so changes = []
    expect(after.truncated).toBe(true);
    expect(snapshotChanges(before,after).changes).toEqual([]); // observed
    // Expected: either 'z' is reported created, OR after.absent includes 'z'
    // so we know coverage is incomplete in a way undo can reason about.
    expect(after.absent??[]).not.toContain('z'); // observed passes; expected fails
  } finally { SNAPSHOT_LIMITS.files=lim; await rm(root,{recursive:true,force:true}); }
});
```

Observed: `changes: []`. Expected: the newly created `z` either appears as `{path:'z',before:null,after:'Z'}` or is marked `absent` so `finishCommand` reports it — otherwise a real shell edit is silently lost, exactly the class of bug the patch claims to fix. The bug is that `prioritize` spends the global `count` on paths the subsequent `walk` would have visited anyway, so prioritization can only ever *reduce* residual budget for new entries; it must not charge the same path twice.

## Defect 2 — `prioritize` returns without recording `absent` when it truncates before reaching a listed missing path

`prioritize` does `if(!visit(path))return;` before the `lstat` that would push to `absent`. When the entry limit blows during a priority walk whose later sibling is a genuinely-deleted tracked file, that file's deletion is neither in `absent` nor in `omitted`, and `walk` is skipped entirely because `truncated` is true. `snapshotChanges` then sees `files[path]` present-before, absent-after, `after.truncated&&!after.absent.includes(path)` → skipped, so the deletion is dropped rather than reported as an incomplete conflict. Worse, the leftover `checkpoint.changes` retains the old entry, and the next `finishCommand` will treat the stale `before` as authoritative and can raise a spurious conflict.

```ts
it('priority truncation before a missing sibling hides a deletion', async()=>{
  const root=await mkdtemp(join(tmpdir(),'snap-')); const lim=SNAPSHOT_LIMITS.files;
  try{
    SNAPSHOT_LIMITS.files=2;
    await writeFile(join(root,'a'),'A'); await writeFile(join(root,'z'),'Z');
    const before=await snapshotWorkspace(root,[],['a','z']); // count root,a,z => truncated at z
    expect(before.truncated).toBe(true);
    expect(before.files['z']).toBeUndefined();
    expect(before.absent??[]).toEqual([]); // observed: z neither present nor absent
    await rm(join(root,'z'));
    const after=await snapshotWorkspace(root,[],['a','z']);
    expect(snapshotChanges(before,after).changes).toEqual([]); // observed
    // Expected: incomplete:true AND either reported deletion or explicit absence,
    // so undo cannot silently keep a stale 'before' for a file it no longer knows.
    expect(after.absent).toContain('z'); // expected
  } finally { SNAPSHOT_LIMITS.files=lim; await rm(root,{recursive:true,force:true}); }
});
```

Observed: `before.absent` is `[]`, `z` is neither captured nor marked, and `changes` after deletion is empty. Expected: `prioritize` records `absent` for not-yet-lstat’d listed paths when it stops early (or marks them `omitted`/`unreached`), so `finishCommand` can set `incomplete` and never fabricate or silently drop a change. The comment “Missing paths are evidence” is only true for the branch that actually reaches `lstat`; truncation before `lstat` violates the stated invariant “an incomplete snapshot must never fabricate changes,” here by omitting a real deletion and by leaving `checkpoint.changes` stale.

**Not defects (checked):** repeated commands with identical priority lists, symlinks (handled by `capture`’s `isSymbolicLink` and priority’s ancestor walk using `lstat`), ignored dirs (`SNAPSHOT_IGNORES` checked in `prioritize` before `visit`), and non-directory ancestors are all covered by the supplied tests. I found at most two concrete correctness defects, as requested.