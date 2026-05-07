import { Storage } from "@google-cloud/storage";
import path from "path";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

function getBucketName(): string {
  const paths = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
  const first = paths.split(",")[0]?.trim();
  if (!first) throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set");
  return first.replace(/^\//, "").split("/")[0];
}

export async function uploadMediaToCloud(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<string> {
  const bucketName = getBucketName();
  const ext = path.extname(originalName).toLowerCase();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const objectPath = `public/media/${unique}`;

  const bucket = gcs.bucket(bucketName);
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
  });

  return `/api/media/${unique}`;
}

export async function deleteMediaFromCloud(fileUrl: string): Promise<void> {
  if (!fileUrl.startsWith("/api/media/")) return;
  const filename = fileUrl.replace("/api/media/", "");
  if (!filename) return;
  const bucketName = getBucketName();
  const bucket = gcs.bucket(bucketName);
  const file = bucket.file(`public/media/${filename}`);
  const [exists] = await file.exists();
  if (exists) await file.delete();
}

export async function serveMediaFromCloud(
  filename: string,
  res: import("express").Response
): Promise<void> {
  const bucketName = getBucketName();
  const bucket = gcs.bucket(bucketName);
  const file = bucket.file(`public/media/${filename}`);

  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).json({ message: "File not found" });
    return;
  }

  const [metadata] = await file.getMetadata();
  res.set({
    "Content-Type": (metadata.contentType as string) || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Length": String(metadata.size),
  });

  file.createReadStream().pipe(res);
}
