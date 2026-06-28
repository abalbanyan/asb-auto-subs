export interface AnimeSite {
  isOnEpSite(url: string): boolean;
  getEpisode(): number | null;
  getAnilistId(): number | null;
  getTitle(): string | null;
  // Returns true when metadata can be read without using stale SPA route data.
  isMetaDataReady?(): boolean;
}

type JsonLdObject = {
  [key: string]: any;
};

function normalizeText(text: string | null | undefined) {
  return text?.replace(/\s+/g, " ").trim() || null;
}

function parseEpisodeNumber(text: string | null | undefined) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return null;
  const match = normalizedText.match(/\bE(?:pisode)?\s*(\d+)\b/i);
  return match ? parseInt(match[1]) : null;
}

function jsonLdObjects() {
  const objects: JsonLdObject[] = [];
  document
    .querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
    .forEach((script) => {
      if (!script.textContent) return;
      try {
        const parsed = JSON.parse(script.textContent);
        const values = Array.isArray(parsed) ? parsed : [parsed];
        values.forEach((value) => {
          if (value && typeof value === "object") {
            objects.push(value);
            if (Array.isArray(value["@graph"])) {
              value["@graph"].forEach((graphValue: JsonLdObject) => {
                if (graphValue && typeof graphValue === "object") {
                  objects.push(graphValue);
                }
              });
            }
          }
        });
      } catch {
        return;
      }
    });
  return objects;
}

function jsonLdTypeMatches(object: JsonLdObject, type: string) {
  const objectType = object["@type"];
  return Array.isArray(objectType)
    ? objectType.indexOf(type) !== -1
    : objectType === type;
}

function urlMatchesCurrentPage(url: string | null | undefined) {
  if (!url) return false;
  try {
    return new URL(url, window.location.origin).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

class Crunchyroll implements AnimeSite {
  private getEpisodeJsonLd() {
    const episodes = jsonLdObjects().filter((object) =>
      jsonLdTypeMatches(object, "TVEpisode"),
    );
    const currentEpisode = episodes.find(
      (episode) =>
        urlMatchesCurrentPage(episode.url) ||
        urlMatchesCurrentPage(episode["@id"]),
    );
    if (currentEpisode) return currentEpisode;
    return episodes.find((episode) => !episode.url && !episode["@id"]);
  }

  getTitle(): string | null {
    const episodeJsonLd = this.getEpisodeJsonLd();
    const seriesTitle = normalizeText(episodeJsonLd?.partOfSeries?.name);
    const seasonTitle = normalizeText(episodeJsonLd?.partOfSeason?.name);
    const seasonNumber = Number(episodeJsonLd?.partOfSeason?.seasonNumber);
    const jsonLdTitle =
      seasonTitle && seasonTitle !== seriesTitle
        ? seasonTitle
        : seriesTitle && seasonNumber > 1
          ? `${seriesTitle} Season ${seasonNumber}`
          : seriesTitle || seasonTitle;
    if (jsonLdTitle) return jsonLdTitle;

    const ogTitle = normalizeText(
      this.getCurrentPageMeta("og:title")?.getAttribute("content"),
    );
    const titleFromMeta = normalizeText(ogTitle?.split("|")[0]);
    if (titleFromMeta) return titleFromMeta;

    return normalizeText(
      document.querySelector('a[href*="/series/"] h4')?.textContent,
    );
  }

  isOnEpSite(url: string): boolean {
    const epSiteRegEx = new RegExp(
      /^https:\/\/(?:www\.)?crunchyroll\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/[^/?#]+(?:\/[^/?#]+)?/i,
    );
    return epSiteRegEx.test(url);
  }

  getEpisode(): number | null {
    const episodeJsonLd = this.getEpisodeJsonLd();
    const episodeNumber = episodeJsonLd?.episodeNumber;
    if (typeof episodeNumber === "number") return episodeNumber;
    if (typeof episodeNumber === "string") return parseInt(episodeNumber);

    const ogTitle = this.getCurrentPageMeta("og:title")?.getAttribute("content");
    const episodeFromMeta = parseEpisodeNumber(ogTitle);
    if (episodeFromMeta) return episodeFromMeta;

    return parseEpisodeNumber(document.querySelector("h1.title")?.textContent);
  }

  getAnilistId(): number | null {
    return null;
  }

  private getCurrentPageMeta(property: string) {
    const metaUrl = document
      .querySelector<HTMLMetaElement>('meta[property="og:url"]')
      ?.getAttribute("content");
    if (!urlMatchesCurrentPage(metaUrl)) return null;
    return document.querySelector<HTMLMetaElement>(
      `meta[property="${property}"]`,
    );
  }

  isMetaDataReady() {
    return !!this.getEpisodeJsonLd() || !!this.getCurrentPageMeta("og:title");
  }
}

export const animeSites = new Map<string, AnimeSite>([
  ["crunchyroll.com", new Crunchyroll()],
]);
