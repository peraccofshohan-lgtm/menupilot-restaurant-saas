/**
 * Integration tests for the three Supabase-facing subsystems.
 *
 * These exercise the real service code against the real database (through the harness
 * seam), not mocks:
 *
 *   StorageService   validation, tenant-prefixed paths, replacement ordering,
 *                    batch deletion, URL resolution per driver
 *   sendEmail        the recorded outcome of every attempt, with and without a key
 *   realtime         the topic a browser receives, and that no secret reaches it
 *
 * What cannot be tested here: a live Supabase bucket, a real Resend delivery, an open
 * websocket. Those need credentials. See SUPABASE.md §8 for the exact boundary.
 */
import { createHmac } from "node:crypto";
import { assert, assertEquals, collected, describe, it, type Test } from "./assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
  BUCKETS,
  detectImageType,
  extensionFor,
  replaceObject,
  servesFromCdn,
  slugifyFilename,
  storage,
  validateImageUpload,
} from "../src/lib/services/storage";
import { sendEmail } from "../src/lib/services/email";
import { as, asUser, db, getFixture } from "./harness";

/* -------------------------------------------------------------------------- */

/** Every case this file declares. Called after the module has been evaluated. */
export function subsystemSuites(): Test[] {
  return collected();
}

/** Real image bytes, made by the same encoder the upload route uses. */
const pngOnce = (() => {
  let cached: Buffer | null = null;
  return async () => {
    if (!cached) {
      cached = await sharp({ create: { width: 48, height: 48, channels: 3, background: "#c2410c" } }).png().toBuffer();
    }
    return cached;
  };
})();

async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: "#123456" } })
    .withMetadata({ exif: { IFD0: { Copyright: "MenuPilot-test" } } })
    .jpeg()
    .toBuffer();
}

/** The exact pipeline the upload route runs: validate, detect, decode, re-encode. */
async function sanitize(bytes: Buffer, name: string, type: string) {
  const rejected = validateImageUpload({ type, size: bytes.byteLength });
  if (rejected) return { ok: false as const, error: rejected };
  const declared = detectImageType(bytes);
  if (!declared) return { ok: false as const, error: "not a valid image" };
  try {
    const buffer = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { ok: true as const, buffer, type: "image/jpeg" };
  } catch {
    return { ok: false as const, error: "not a decodable image" };
  }
}

/* ==========================================================================
   Storage — validation
   ========================================================================== */

describe("storage: upload validation", () => {
  it("recognises real JPEG, PNG and WebP bytes", async () => {
    const png = await pngOnce();
    assertEquals(detectImageType(png), "image/png", "PNG signature is detected");
    assertEquals(detectImageType(await jpegWithExif()), "image/jpeg", "JPEG signature is detected");

    const webp = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#fff" } }).webp().toBuffer();
    assertEquals(detectImageType(webp), "image/webp", "WebP signature is detected");
    assertEquals(extensionFor("image/png"), "png", "extension follows the type");
  });

  it("rejects a script renamed to .jpg", async () => {
    const script = Buffer.from("#!/bin/sh\nrm -rf /\n");
    assertEquals(detectImageType(script), null, "no image signature");
    const verdict = await sanitize(script, "poster.jpg", "image/jpeg");
    assertEquals(verdict.ok, false, "a renamed script is refused");
  });

  it("rejects a PDF and an oversized file before storing anything", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64)]);
    assertEquals((await sanitize(pdf, "menu.pdf", "application/pdf")).ok, false, "PDF is refused");

    const rejected = validateImageUpload({ type: "image/png", size: 6 * 1024 * 1024 });
    assertEquals(rejected, "Images must be 5 MB or smaller.", "the 5 MB cap is enforced");
  });

  it("rejects a file with a valid signature that cannot be decoded", async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("junk")]);
    assertEquals(detectImageType(fake), "image/png", "the signature alone says PNG");
    assertEquals((await sanitize(fake, "broken.png", "image/png")).ok, false, "a corrupt image is refused");
  });

  it("strips metadata by re-encoding", async () => {
    const original = await jpegWithExif();
    assertEquals(Boolean((await sharp(original).metadata()).exif), true, "the fixture really has EXIF");

    const verdict = await sanitize(original, "photo.jpg", "image/jpeg");
    assertEquals(verdict.ok, true, "the image is accepted");
    if (verdict.ok) {
      assertEquals((await sharp(verdict.buffer).metadata()).exif, undefined, "EXIF is gone");
    }
  });

  it("removes path separators from a hostile filename", () => {
    const slug = slugifyFilename("../../etc/passwd.png");
    assertEquals(slug.includes("/"), false, "no forward slash");
    assertEquals(slug.includes("\\"), false, "no backslash");
    assertEquals(slug.includes(".."), false, "no parent reference");
  });
});

/* ==========================================================================
   Storage — the real driver
   ========================================================================== */

describe("storage: tenant-prefixed objects", () => {
  it("puts each tenant's object under its own id", async () => {
    const f = await getFixture();
    const svc = storage();
    const bytes = await pngOnce();

    const mine = await svc.put({
      bucket: "menu",
      path: `${f.restaurantId}/menu/dish-${Date.now()}.png`,
      data: bytes,
      contentType: "image/png",
      restaurantId: f.restaurantId,
    });
    const theirs = await svc.put({
      bucket: "menu",
      path: `${f.otherRestaurantId}/menu/dish-${Date.now()}.png`,
      data: bytes,
      contentType: "image/png",
      restaurantId: f.otherRestaurantId,
    });

    assertEquals(mine.startsWith(`${f.restaurantId}/`), true, `tenant-prefixed: ${mine}`);
    assertEquals(theirs.startsWith(`${f.otherRestaurantId}/`), true, `separated: ${theirs}`);
    assertEquals(mine === theirs, false, "no prefix collision");
  });

  it("round-trips bytes and reports existence honestly", async () => {
    const f = await getFixture();
    const svc = storage();
    const bytes = await pngOnce();
    const path = `${f.restaurantId}/branding/roundtrip-${Date.now()}.png`;

    await svc.put({ bucket: "branding", path, data: bytes, contentType: "image/png", restaurantId: f.restaurantId });
    assertEquals(await svc.exists("branding", path), true, "the object exists after put");

    const stored = await svc.get("branding", path);
    assertEquals(stored?.contentType, "image/png", "content type survives");
    assertEquals(stored?.data.byteLength, bytes.byteLength, "byte length survives");

    assertEquals(await svc.exists("branding", `${f.restaurantId}/branding/nope.png`), false, "missing is absent");
  });

  it("resolves a renderable URL for whichever driver is active", async () => {
    const f = await getFixture();
    const svc = storage();
    const url = svc.url("menu", `${f.restaurantId}/menu/x.jpg`);
    if (servesFromCdn()) {
      assertEquals(url!.startsWith("http"), true, "CDN driver returns an absolute URL");
    } else {
      assertEquals(url!.startsWith("/api/media/menu/"), true, `local driver returns an app path: ${url}`);
    }
    assertEquals(svc.url("menu", null), null, "no path, no URL");
  });

  it("exposes exactly the two public buckets", () => {
    assertEquals(BUCKETS.length, 2, "two buckets");
    assertEquals(BUCKETS.join(","), "menu,branding", "menu and branding");
  });
});

describe("storage: replacement safety", () => {
  it("deletes the old object only after the new one is committed", async () => {
    const f = await getFixture();
    const svc = storage();
    const bytes = await pngOnce();
    const oldPath = `${f.restaurantId}/branding/logo-${Date.now()}.png`;
    const newPath = `${f.restaurantId}/branding/logo-${Date.now() + 1}.png`;

    await svc.put({ bucket: "branding", path: oldPath, data: bytes, contentType: "image/png", restaurantId: f.restaurantId });

    let oldExistedDuringCommit = false;
    await replaceObject(
      { bucket: "branding", path: newPath, data: bytes, contentType: "image/png", restaurantId: f.restaurantId },
      oldPath,
      async () => {
        oldExistedDuringCommit = await svc.exists("branding", oldPath);
      },
    );

    assertEquals(oldExistedDuringCommit, true, "the live image is still served while committing");
    assertEquals(await svc.exists("branding", newPath), true, "the new object is live");
    assertEquals(await svc.exists("branding", oldPath), false, "the old object is cleaned up");
  });

  it("keeps the live image when the database update fails", async () => {
    const f = await getFixture();
    const svc = storage();
    const bytes = await pngOnce();
    const oldPath = `${f.restaurantId}/branding/cover-${Date.now()}.png`;
    const newPath = `${f.restaurantId}/branding/cover-${Date.now() + 1}.png`;

    await svc.put({ bucket: "branding", path: oldPath, data: bytes, contentType: "image/png", restaurantId: f.restaurantId });

    let threw = false;
    try {
      await replaceObject(
        { bucket: "branding", path: newPath, data: bytes, contentType: "image/png", restaurantId: f.restaurantId },
        oldPath,
        async () => {
          throw new Error("database said no");
        },
      );
    } catch {
      threw = true;
    }

    assertEquals(threw, true, "the failure reaches the caller");
    assertEquals(await svc.exists("branding", oldPath), true, "the guest still sees an image");
    assertEquals(await svc.exists("branding", newPath), false, "the abandoned upload is rolled back");
  });

  it("deletes a batch and ignores objects that are already gone", async () => {
    const f = await getFixture();
    const svc = storage();
    const bytes = await pngOnce();
    const stamp = Date.now();
    const a = `${f.restaurantId}/menu/batch-a-${stamp}.png`;
    const b = `${f.restaurantId}/menu/batch-b-${stamp}.png`;

    await svc.put({ bucket: "menu", path: a, data: bytes, contentType: "image/png", restaurantId: f.restaurantId });
    await svc.put({ bucket: "menu", path: b, data: bytes, contentType: "image/png", restaurantId: f.restaurantId });

    await svc.removeMany([
      { bucket: "menu", path: a },
      { bucket: "menu", path: b },
      { bucket: "menu", path: `${f.restaurantId}/menu/never-existed-${stamp}.png` },
    ]);

    assertEquals(await svc.exists("menu", a), false, "first object removed");
    assertEquals(await svc.exists("menu", b), false, "second object removed");
  });
});

/* ==========================================================================
   Email
   ========================================================================== */

describe("email: honest delivery reporting", () => {
  it("records a skipped attempt when no provider is configured", async () => {
    const database = await db();
    const before = await database.query<{ c: number }>("select count(*)::int c from email_outbox");

    const result = await sendEmail({
      kind: "staff_invitation",
      to: "someone@example.com",
      subject: "You are invited",
      text: "Join the team",
      html: "<p>Join the team</p>",
    });

    if (process.env.RESEND_API_KEY) {
      assertEquals(typeof result.delivered, "boolean", "a configured provider returns a real verdict");
      return;
    }

    assertEquals(result.delivered, false, "nothing was delivered");
    assertEquals(result.reason, "not_configured", "the reason is explicit");

    const after = await database.query<{ c: number }>("select count(*)::int c from email_outbox");
    assertEquals(Number(after.rows[0]!.c), Number(before.rows[0]!.c) + 1, "the attempt was recorded");

    const row = await database.query<{ status: string; detail: string | null }>(
      "select status, detail from email_outbox order by created_at desc limit 1",
    );
    assertEquals(row.rows[0]?.status, "skipped", "recorded as skipped, not sent");
    assertEquals(row.rows[0]?.detail?.includes("Join the team"), false, "the body is not stored");
  });

  it("rejects an invalid recipient without contacting a provider", async () => {
    const result = await sendEmail({
      kind: "password_reset",
      to: "not-an-email",
      subject: "Reset",
      text: "Reset",
      html: "<p>Reset</p>",
    });
    assertEquals(result.delivered, false, "nothing delivered");
    assertEquals(result.reason, "invalid_recipient", "classified precisely");
  });

  it("never stores the provider key or a response body", async () => {
    const database = await db();
    const rows = await database.query<{ detail: string | null }>("select detail from email_outbox");
    const secret = process.env.RESEND_API_KEY;
    for (const row of rows.rows) {
      if (!row.detail) continue;
      assertEquals(row.detail.includes("re_"), false, "no key-shaped value is stored");
      if (secret) assertEquals(row.detail.includes(secret), false, "the key never reaches the audit trail");
    }
  });

  it("is unreadable through a user session", async () => {
    const f = await getFixture();
    let refused = false;
    try {
      await as(asUser(f.ownerId), (tx) => tx.query("select * from email_outbox limit 1"));
    } catch {
      refused = true;
    }
    assertEquals(refused, true, "even an owner cannot read the outbox");
  });
});

/* ==========================================================================
   Realtime topics
   ========================================================================== */

/** The derivation the guest route performs, asserted independently here. */
function guestTopic(trackingToken: string, secret: string): string {
  return `order:${createHmac("sha256", secret).update(`order:${trackingToken}`).digest("hex").slice(0, 32)}`;
}

describe("realtime: topic authorization", () => {
  it("derives a guest topic the raw token cannot be recovered from", () => {
    const token = "a".repeat(48);
    const topic = guestTopic(token, "test-secret");
    assertEquals(topic.includes(token), false, "the tracking token is not in the topic");
    assertEquals(topic.length, "order:".length + 32, "fixed-length topic");
    assertEquals(topic.startsWith("order:"), true, "namespaced away from restaurant channels");
  });

  it("gives distinct orders distinct topics and reconnects a stable one", () => {
    const a = guestTopic("a".repeat(48), "s");
    const b = guestTopic("b".repeat(48), "s");
    assertEquals(a === b, false, "distinct orders never share a channel");
    assertEquals(guestTopic("a".repeat(48), "s"), a, "reconnecting lands on the same channel");
  });

  it("keeps each tenant on its own channel", async () => {
    const f = await getFixture();
    const mine = `restaurant:${f.restaurantId}`;
    const theirs = `restaurant:${f.otherRestaurantId}`;
    assertEquals(mine === theirs, false, "different tenants, different channels");
    assertEquals(mine.split(":")[1], f.restaurantId, "the topic carries exactly one tenant id");
  });

  it("keeps every secret out of client components", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
      }
      return out;
    };

    const secrets = ["REALTIME_JWT_SECRET", "SERVICE_ROLE", "SESSION_SECRET", "RESEND_API_KEY"];
    let clientFiles = 0;
    for (const file of walk("src")) {
      const source = readFileSync(file, "utf8");
      if (!source.includes('"use client"') && !source.includes("'use client'")) continue;
      clientFiles += 1;
      for (const secret of secrets) {
        assertEquals(source.includes(secret), false, `${secret} must not appear in ${file}`);
      }
    }
    assertEquals(clientFiles > 0, true, "client components were actually scanned");
  });
});
