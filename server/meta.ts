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

async function getOrgMetaTags(slug: string, baseUrl: string): Promise<MetaTags> {
  try {
    const org = await storage.getOrganizationBySlug(slug);
    if (!org) return getDefaultMetaTags();

    const title = org.name
      ? `${org.name} | ${SITE_NAME}`
      : DEFAULT_TITLE;

    const description =
      org.tagline && org.tagline.trim()
        ? org.tagline
        : org.tagline2 && org.tagline2.trim()
        ? org.tagline2
        : DEFAULT_DESCRIPTION;

    const image =
      org.logoUrl && org.logoUrl.trim()
        ? org.logoUrl
        : DEFAULT_IMAGE;

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
  const escaped = (s: string) => s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
    <!-- Primary Meta -->
    <title>${escaped(tags.title)}</title>
    <meta name="description" content="${escaped(tags.description)}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${escaped(tags.title)}" />
    <meta property="og:description" content="${escaped(tags.description)}" />
    <meta property="og:url" content="${escaped(tags.url)}" />
    <meta property="og:image" content="${escaped(tags.image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escaped(tags.title)}" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escaped(tags.title)}" />
    <meta name="twitter:description" content="${escaped(tags.description)}" />
    <meta name="twitter:image" content="${escaped(tags.image)}" />`.trimStart();
}

function stripExistingMetaTags(html: string): string {
  return html
    .replace(/<title>[^<]*<\/title>/gi, "")
    .replace(/<meta name="description"[^>]*>/gi, "")
    .replace(/<meta property="og:[^"]*"[^>]*>/gi, "")
    .replace(/<meta name="twitter:[^"]*"[^>]*>/gi, "")
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
    ? `https://${requestHost}`
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
