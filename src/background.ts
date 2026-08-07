import { animeSites } from "./animeSites";
import {
  AnimeMetaData,
  DisabledSeries,
  JimakuEntry,
  Subs,
  AnilistObject,
  SubtitlePatterns,
} from "./types";

const lastDownloadedKeyName = "lastDownloadedKey";
const subtitlePatternsKeyName = "subtitlePatterns";
const disabledSeriesKeyName = "disabledSeries";
const disabledKeyName = "disabled";
const apiKeyAttentionFlagName = "highlightApiKeyOnNextSettingsOpen";
const jimakuBaseUrl = "https://jimaku.cc";
const jimakuApiBaseUrl = `${jimakuBaseUrl}/api`;
const jimakuErrors = new Map([
  [400, "Something went wrong! This shouldn't happen"],
  [401, "Authentification failed. Check your API Key"],
  [404, "Entry not found"],
  [
    429,
    "You downloaded too many subtitles in a short amount of time. Try again in a short bit",
  ],
]);
let lastProcessedUrl = "";
let lastMissingApiKeyPromptUrl = "";

function episodeKey(id: number, episode: number) {
  return `${id}_${episode}`;
}

function selectedSubtitleKey(id: number, episode: number) {
  return `${episodeKey(id, episode)}_selectedSubtitle`;
}

async function alreadyDownloaded(
  id: number,
  episode: number,
  selectedSubtitleName: string,
) {
  const key = episodeKey(id, episode);
  const selectedKey = selectedSubtitleKey(id, episode);
  const result = await chrome.storage.local.get([key, selectedKey]);
  if (
    Object.keys(result).length > 0 &&
    result[selectedKey] === selectedSubtitleName
  ) {
    return true;
  }
  await chrome.storage.local.set({ [key]: true, [selectedKey]: selectedSubtitleName });
  return false;
}

function getAnimeSiteKey(url: string) {
  const baseDomainMatcher = /^(?:https?:\/\/)?(?:www\.)?([^\/:?#]+)/;
  const matches = url.match(baseDomainMatcher);
  if (!matches) {
    return null;
  }
  const animeSiteKey = matches[1];
  const animeSite = animeSites.get(animeSiteKey);
  if (!animeSite) {
    return null;
  }
  if (!animeSite.isOnEpSite(url)) {
    return null;
  }
  return animeSiteKey;
}

async function notifyError(tabId: number, error: string) {
  await chrome.tabs.sendMessage(tabId, { action: "notifyError", error });
}

async function notifyMissingJimakuApiKey(tabId: number) {
  await chrome.tabs.sendMessage(tabId, {
    action: "notifyMissingJimakuApiKey",
    message: "A Jimaku API key is required to download subtitles. Click here to set your key.",
  });
}

async function notifySuccess(
  tabId: number,
  loadedIntoAsb: boolean,
  animeMetaData: Pick<AnimeMetaData, "title" | "episode">,
) {
  await chrome.tabs.sendMessage(tabId, {
    action: loadedIntoAsb ? "notifyLoadedIntoAsb" : "notifySuccess",
    title: animeMetaData.title,
    episode: animeMetaData.episode,
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function loadSubsIntoAsb(tabId: number, url: string, name: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const base64 = arrayBufferToBase64(await response.arrayBuffer());
    return <boolean>await chrome.tabs.sendMessage(tabId, {
      action: "loadSubsIntoAsb",
      name,
      base64,
    });
  } catch {
    return false;
  }
}

async function fetchAnilistId(title: string) {
  const query = `
  query ($title: String) {
    Media (search: $title, type: ANIME) {
      id
    }
  }
  `;
  const url = "https://graphql.anilist.co";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: query,
      variables: { title: title },
    }),
  };
  try {
    const anilistResponse = await fetch(url, options);
    if (!anilistResponse.ok) {
      return;
    }
    const anilistObject: AnilistObject = await anilistResponse.json();
    return anilistObject.data.Media.id;
  } catch (e) {
    if (typeof e === "string") {
      e.toUpperCase();
    } else if (e instanceof Error) {
      console.error(e.message);
    }
    return;
  }
}

async function getJimakuApiKey() {
  const localStorageAPIKey = await chrome.storage.sync.get("apiKey");
  return localStorageAPIKey["apiKey"];
}

function hasJimakuApiKey(apiKey: unknown) {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

async function hasStoredJimakuApiKey() {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  return hasJimakuApiKey(apiKey);
}

async function openExtensionPopup(highlightApiKey = false) {
  if (highlightApiKey) {
    await chrome.storage.local.set({ [apiKeyAttentionFlagName]: true });
  }

  try {
    await chrome.action.openPopup();
  } catch {
    return;
  }
}

async function promptForMissingJimakuApiKey(
  tabId: number,
  url: string,
  showTabNotification = true,
) {
  if (lastMissingApiKeyPromptUrl !== url) {
    lastMissingApiKeyPromptUrl = url;
    await openExtensionPopup(true);
  }
  if (!showTabNotification) return;
  await notifyMissingJimakuApiKey(tabId);
}

function jimakuErrorForStatus(status: number) {
  return jimakuErrors.get(status) || "Something went wrong";
}

async function fetchJimakuEntries(anilistId: number) {
  const jimakuAPIKey = await getJimakuApiKey();

  try {
    const searchResponse = await fetch(
      `${jimakuApiBaseUrl}/entries/search?anilist_id=${anilistId}`,
      {
        method: "GET",
        headers: {
          Authorization: `${jimakuAPIKey}`,
        },
      },
    );

    if (!searchResponse.ok) {
      return jimakuErrorForStatus(searchResponse.status);
    }

    return <JimakuEntry[]>await searchResponse.json();
  } catch (e) {
    if (typeof e === "string") {
      e.toUpperCase();
    } else if (e instanceof Error) {
      console.error(e.message);
    }
    return "There was an error";
  }
}

function jimakuEntryUrl(entryId: number) {
  const url = new URL(`/entry/${entryId}`, jimakuBaseUrl);
  return url.toString();
}

async function getAnimeMetaData(tabId: number, animeSiteKey: string) {
  const animeMetaData: AnimeMetaData = await chrome.tabs.sendMessage(tabId, {
    action: "getAnimeMetaData",
    animeSiteKey,
  });
  console.table(animeMetaData);
  return animeMetaData || null;
}

async function getCurrentAnimeMetaData() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) return null;

  const animeSiteKey = getAnimeSiteKey(tab.url);
  if (!animeSiteKey) return null;

  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["css/index.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["dist/injectScript.js"],
  });

  return await getAnimeMetaData(tab.id, animeSiteKey);
}

async function currentAnimeContext() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) return null;

  const animeSiteKey = getAnimeSiteKey(tab.url);
  if (!animeSiteKey) return null;

  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["css/index.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["dist/injectScript.js"],
  });

  const animeMetaData = await getAnimeMetaData(tab.id, animeSiteKey);
  if (!animeMetaData?.title || !animeMetaData.episode) return null;

  let anilistId = animeMetaData.anilistId;
  if (!anilistId) {
    anilistId = await fetchAnilistId(animeMetaData.title);
  }
  if (!anilistId) return null;

  return { ...animeMetaData, tabId: tab.id, anilistId };
}

async function fetchSubs(anilistId: number, episode: number) {
  const jimakuAPIKey = await getJimakuApiKey();

  try {
    const jimakuEntry = await fetchJimakuEntries(anilistId);
    if (typeof jimakuEntry === "string") {
      return jimakuEntry;
    }
    if (jimakuEntry.length === 0) {
      return `No subtitles found for this anime`;
    }
    const id = jimakuEntry[0].id;
    const filesResponse = await fetch(
      jimakuApiBaseUrl + `/entries/${id}/files?episode=${episode}`,
      {
        method: "GET",
        headers: {
          Authorization: `${jimakuAPIKey}`,
        },
      },
    );
    if (!filesResponse.ok) {
      return jimakuErrorForStatus(filesResponse.status);
    }
    const subs: Subs[] = await filesResponse.json();
    if (subs.length === 0) {
      return `No subtitles for episode ${episode} could be found`;
    }
    return subs;
  } catch (e) {
    if (typeof e === "string") {
      e.toUpperCase();
    } else if (e instanceof Error) {
      console.error(e.message);
    }
    return "There was an error";
  }
}

async function markMultipleAsDownloaded(filename: string, anilistId: number) {
  const rangePattern = /\d+[-~]\d+/;
  const match = filename.match(rangePattern);
  if (!match) return;
  const episodeRange = match[0];
  let episodes;
  if (episodeRange.includes("-")) {
    episodes = episodeRange.split("-").map((episode) => parseInt(episode));
  } else {
    episodes = episodeRange.split("~").map((episode) => parseInt(episode));
  }
  for (let i = episodes[0]; i < episodes[1]; i++) {
    const key = `${anilistId}_${i}`;
    await chrome.storage.local.set({ [key]: true });
  }
}

async function subtitlePatternForTitle(title: string) {
  const result = await chrome.storage.sync.get(subtitlePatternsKeyName);
  const patterns = <SubtitlePatterns>(result[subtitlePatternsKeyName] || {});
  return patterns[title]?.trim();
}

async function isSeriesDisabled(title: string) {
  const result = await chrome.storage.sync.get(disabledSeriesKeyName);
  const disabledSeries = <DisabledSeries>(result[disabledSeriesKeyName] || {});
  return !!disabledSeries[title];
}

async function isExtensionDisabled() {
  return !!(await chrome.storage.sync.get(disabledKeyName))[disabledKeyName];
}

function selectSubtitleFile(subs: Subs[], preferredPattern?: string) {
  if (preferredPattern) {
    const normalizedPattern = normalizeSubtitlePattern(preferredPattern);
    const preferredSub = subs.find((sub) =>
      normalizeSubtitlePattern(sub.name).includes(normalizedPattern),
    );
    if (preferredSub) return preferredSub;
  }

  const compressedFileEndings = [".zip", ".rar", ".7z"];
  const nonCompressedSub = subs.find((sub) => {
    for (let cfe of compressedFileEndings) {
      if (sub.name.endsWith(cfe)) return false;
    }
    return true;
  });
  return nonCompressedSub ? nonCompressedSub : subs[0];
}

function normalizeSubtitlePattern(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function downloadSubs(
  tabId: number,
  title: string,
  anilistId: number,
  episode: number,
) {
  const subs = await fetchSubs(anilistId, episode);
  if (typeof subs === "string") {
    return { error: subs };
  }

  const compressedFileEndings = [".zip", ".rar", ".7z"];
  const preferredPattern = await subtitlePatternForTitle(title);
  const { url, name } = selectSubtitleFile(subs, preferredPattern);
  const hasAlreadyBeenDownloaded = await alreadyDownloaded(
    anilistId,
    episode,
    name,
  );
  if (hasAlreadyBeenDownloaded) {
    return { alreadyDownloaded: true };
  }

  const shouldLoadIntoAsb = !compressedFileEndings.some((ending) =>
    name.endsWith(ending),
  );
  let loadedIntoAsb = false;

  if (shouldLoadIntoAsb) {
    loadedIntoAsb = await loadSubsIntoAsb(tabId, url, name);
  }

  chrome.downloads.download(
    {
      url,
      filename: `subs/${name}`,
      saveAs: false,
    },
    async (downloadId) => {
      if (chrome.runtime.lastError) {
        return chrome.runtime.lastError.message;
      }
      if (name.endsWith(".zip") || name.endsWith(".rar")) {
        await markMultipleAsDownloaded(name, anilistId);
      } else {
        const key = episodeKey(anilistId, episode);
        await chrome.storage.local.set({
          [lastDownloadedKeyName]: key,
          [key]: downloadId,
          [selectedSubtitleKey(anilistId, episode)]: name,
        });
      }
    },
  );
  return { loadedIntoAsb };
}

async function removeLastDownloaded() {
  const storedAutoDelete = (await chrome.storage.sync.get("autoDelete"))
    .autoDelete;
  const autoDelete = storedAutoDelete ?? true;
  if (autoDelete)  {
    let lastDownloadedKey: string;
    lastDownloadedKey = (await chrome.storage.local.get(lastDownloadedKeyName))[lastDownloadedKeyName];
    chrome.storage.local.get(lastDownloadedKey, async (result) => {
      if (Object.keys(result).length === 0) return;
      const downloadId = result[lastDownloadedKey];
      if (downloadId === true) return;
      try {
        await chrome.downloads.removeFile(downloadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Download file already deleted")) {
          throw error;
        }
      }
      await chrome.storage.local.remove(lastDownloadedKey);
      await chrome.storage.local.remove(`${lastDownloadedKey}_selectedSubtitle`);
    });
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  openExtensionPopup().catch((error) => {
    console.error("Failed to open extension popup on install", error);
  });
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  chrome.tabs.get(details.tabId, async (tab) => {
    if (!tab.url || !getAnimeSiteKey(tab.url)) return;
    if (await isExtensionDisabled()) return;
    if (await hasStoredJimakuApiKey()) return;
    await promptForMissingJimakuApiKey(details.tabId, tab.url, false);
  });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  chrome.tabs.get(details.tabId, async (tab) => {
    if (tab.url !== details.url || lastProcessedUrl === details.url) return;
    if (await isExtensionDisabled()) return;
    await removeLastDownloaded();
    lastProcessedUrl = tab.url;
    const animeSiteKey = getAnimeSiteKey(tab.url);
    if (!animeSiteKey) return;
    await chrome.scripting.insertCSS({
      target: { tabId: details.tabId },
      files: ["css/index.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ["dist/injectScript.js"],
    });

    if (!(await hasStoredJimakuApiKey())) {
      await promptForMissingJimakuApiKey(details.tabId, tab.url);
      return;
    }

    const animeMetaData = await getAnimeMetaData(details.tabId, animeSiteKey);
    if (!animeMetaData) return;
    let anilistId = animeMetaData.anilistId;
    const { title, episode } = animeMetaData;
    if (!episode || !title) {
      notifyError(details.tabId, "Couldn't get anime data");
      return;
    }
    if (await isSeriesDisabled(title)) return;
    if (!anilistId) {
      const id = await fetchAnilistId(title);
      if (!id) {
        notifyError(details.tabId, "Failed fetching AnilistId");
        return;
      }
      anilistId = id;
    }
    if (await isExtensionDisabled() || await isSeriesDisabled(title)) return;
    const result = await downloadSubs(details.tabId, title, anilistId, episode);
    if (result.alreadyDownloaded) {
      chrome.tabs.sendMessage(details.tabId, {
        action: "alreadyDownloadedInfo",
      });
    } else if (result.error) notifyError(details.tabId, result.error);
    else {
      notifySuccess(details.tabId, !!result.loadedIntoAsb, { title, episode });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getCurrentAnimeMetaData") {
    getCurrentAnimeMetaData().then(sendResponse);
    return true;
  }

  if (message.action === "getJimakuSubtitlesLink") {
    (async () => {
      const title = typeof message.title === "string" ? message.title : "";
      let anilistId =
        typeof message.anilistId === "number" &&
        Number.isFinite(message.anilistId)
          ? message.anilistId
          : null;

      if (!anilistId && !title) {
        sendResponse(null);
        return;
      }

      if (!anilistId) {
        anilistId = (await fetchAnilistId(title)) || null;
      }
      if (!anilistId) {
        sendResponse(null);
        return;
      }

      const jimakuEntry = await fetchJimakuEntries(anilistId);
      if (typeof jimakuEntry === "string" || jimakuEntry.length === 0) {
        sendResponse(null);
        return;
      }

      sendResponse({ url: jimakuEntryUrl(jimakuEntry[0].id) });
    })();
    return true;
  }

  if (message.action === "openExtensionPopup") {
    openExtensionPopup(true).then(sendResponse);
    return true;
  }

  if (message.action === "refreshCurrentSubtitles") {
    (async () => {
      if (await isExtensionDisabled()) {
        sendResponse({ refreshed: false });
        return;
      }
      const context = await currentAnimeContext();
      if (
        !context ||
        await isExtensionDisabled() ||
        await isSeriesDisabled(context.title)
      ) {
        sendResponse({ refreshed: false });
        return;
      }

      const result = await downloadSubs(
        context.tabId,
        context.title,
        context.anilistId,
        context.episode,
      );
      sendResponse({
        refreshed: !result.error && !result.alreadyDownloaded,
        alreadyDownloaded: !!result.alreadyDownloaded,
        error: result.error,
      });
    })();
    return true;
  }

  return;
});
