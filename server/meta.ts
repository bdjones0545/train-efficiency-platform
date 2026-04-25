import { storage } from "./storage";

const DEFAULT_TITLE = "TrainEfficiency | Coaching, Scheduling & Performance Management";
const DEFAULT_DESCRIPTION =
  "Build your coaching business with smarter scheduling, athlete management, team training, payments, and performance tools in one platform.";
const DEFAULT_IMAGE = "https://trainefficiency.com/social-preview.png?v=1";
const DEFAULT_URL = "https://trainefficiency.com";
const SITE_NAME = "TrainEfficiency";

interface MetaTags {
  title: string;
  description: string;
  image: string;
  url: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toAbsoluteUrl(url: string, baseUrl: string): string {
  if (!url || !url.trim()) return DEFAULT_IMAGE;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${baseUrl}${trimmed}`;
  return trimmed;
}

async function getOrgMetaTags(slug: string, baseUrl: string): Promise<MetaTags> {
  try {
    const org = await storage.getOrganizationBySlug(slug);
    if (!org) return getDefaultMetaTags();

    const orgName = org.name && org.name.trim() ? org.name.trim() : null;

    const title = orgName
      ? `${orgName} | Powered by ${SITE_NAME}`
      : DEFAULT_TITLE;

    const description = (() => {
      if (org.tagline && org.tagline.trim()) return org.tagline.trim();
      if (org.tagline2 && org.tagline2.trim()) return org.tagline2.trim();
      if (orgName) {
        return `Book sessions, view training options, and connect with ${orgName} through their ${SITE_NAME} landing page.`;
      }
      return DEFAULT_DESCRIPTION;
    })();

    const rawImage = (() => {
      if ((org as any).socialPreviewImageUrl && (org as any).socialPreviewImageUrl.trim())
        return (org as any).socialPreviewImageUrl.trim();
      if (org.logoUrl && org.logoUrl.trim()) return org.logoUrl.trim();
      return DEFAULT_IMAGE;
    })();

    const image = rawImage === DEFAULT_IMAGE ? DEFAULT_IMAGE : toAbsoluteUrl(rawImage, baseUrl);
    const url = `${baseUrl}/org/${slug}`;

    return { title, description, image, url };
  } catch {
    return getDefaultMetaTags();
  }
}

function getDefaultMetaTags(): MetaTags {
  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_IMAGE,
    url: DEFAULT_URL,
  };
}

function buildMetaBlock(tags: MetaTags): string {
  const t = escapeHtml(tags.title);
  const d = escapeHtml(tags.description);
  const i = escapeHtml(tags.image);
  const u = escapeHtml(tags.url);

  return `<!-- Primary Meta -->
    <title>${t}</title>
    <meta name="description" content="${d}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${i}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${t}" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${i}" />`;
}

function stripExistingMetaTags(html: string): string {
  return html
    .replace(/<title>[^<]*<\/title>/gi, "")
    .replace(/<meta\s+name="description"[^>]*>/gi, "")
    .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, "")
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, "")
    .replace(/<!--\s*Primary Meta\s*-->/gi, "")
    .replace(/<!--\s*Open Graph\s*-->/gi, "")
    .replace(/<!--\s*Twitter Card\s*-->/gi, "");
}

export async function injectMetaTags(
  html: string,
  url: string,
  requestHost: string
): Promise<string> {
  const orgMatch = url.match(/^\/org\/([^/?#]+)/);

  const baseUrl = requestHost
    ? `https://${requestHost.replace(/:\d+$/, "")}` 
    : DEFAULT_URL;

  let tags: MetaTags;
  if (orgMatch) {
    tags = await getOrgMetaTags(orgMatch[1], baseUrl);
  } else {
    tags = getDefaultMetaTags();
  }

  const cleaned = stripExistingMetaTags(html);
  const metaBlock = buildMetaBlock(tags);

  return cleaned.replace(/<head>/, `<head>\n    ${metaBlock}`);
}
