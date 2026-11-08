# Corrupted demo database archive

**Do not attempt to start this database.** It is retained for forensic purposes only.

## What this is

A byte-for-byte copy of the local PGlite data directory that was in use by the
MATI Kitchen demo before it became unopenable on 2026-11-08. It is preserved so
the failure can be inspected later; it is not a backup you can restore from.

## How it was damaged

PGlite is an embedded Postgres with a single-writer lock, and its data directory
must never be opened by two processes at once. During image verification the
long-running `next dev` server held the directory while a `tsx` script also
attempted to open it. A subsequent `kill -9` against those auxiliary processes
interrupted a write and left a torn write-ahead log.

## The failure, verbatim

```
LOG:  invalid checkpoint record
LOG:  invalid resource manager ID 60 at 0/3C23CF0
PANIC:  could not locate a valid checkpoint record at 0/3C23CF0
```

`PGlite.create()` aborts on this directory. It was reproduced on three
independent copies of the directory, so the tear is in the data itself and not
an artefact of a stale `postmaster.pid` or of process contention. Deleting the
lock file does not help, and neither does dropping the last WAL segment.

## Why the checkpoint cannot simply be rebuilt

`pg_control` records the checkpoint at WAL offset `0x3C23CF0`. The bytes at that
offset in `pg_wal/000000010000000000000003` begin:

```
60 19 04 00 00 0a 00 00 22 00 00 00 19 04 00 00
b0 3c c2 03 00 00 00 00 00 01 00 00 0c 66 91 a2
```

A checkpoint record carries `xl_tot_len = 224` at offset zero, followed by
`xl_rmid = 0` and `xl_info = 16`. Here `xl_rmid` reads 96, which is not a valid
resource manager id. The record is misaligned or only partially written, so
there is no intact checkpoint to fall back on.

## Contents, for reference

At the time of failure the directory held 76 MB of PGlite data reachable through
`base/`, with the two WAL segments `000000010000000000000003` (touched 12:26:42,
the write in progress) and `000000010000000000000004` (12:23:41). Whatever was
committed before the tear is in there but cannot be read without a working
checkpoint.

## Contents of the old system, as known before the loss

- Restaurant: MATI Kitchen
- Tenant id: `64c8e751-2fa5-4f06-a8a7-6d6adb4f408f` (old — replaced by the rebuild)
- 7 categories, 50 menu items, 20 dining tables, 20 QR tokens
- 313 orders, 610 order items, 1507 order status rows

The old tenant id, QR tokens and order history are gone. The rebuild generates a
new tenant with fresh cryptographically random tokens; no old token was reused
and no token was generated deterministically.

## Recovery attempts recorded

| Attempt | Result |
| --- | --- |
| `PGlite.create()` on original | abort, panic above |
| Remove stale `postmaster.pid`, retry | abort, same panic |
| Same on an independent copy | abort, same panic |
| Same after dropping the newest WAL segment | abort, same panic |

The 50 dish photographs are unaffected by this failure: they are standalone
files under `public/seed-images/menu/`, committed to Git.
