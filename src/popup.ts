import { AnimeMetaData, DisabledSeries, Subs, SubtitlePatterns } from "./types";

type JimakuSubtitlesLink = {
  url: string;
};

type SeriesSubtitles = {
  subs: Subs[];
  error?: string;
};

type RefreshCurrentSubtitlesResponse = {
  refreshed: boolean;
  alreadyDownloaded?: boolean;
  error?: string;
};

type SubtitleSourceSuggestion = {
  label: string;
  pattern: string;
  fileCount: number;
};

const subtitlePatternsKeyName = "subtitlePatterns";
const disabledSeriesKeyName = "disabledSeries";
const apiKeyAttentionFlagName = "highlightApiKeyOnNextSettingsOpen";
let currentAnimeTitle: string | null = null;
let currentAnimeMetaData: AnimeMetaData | null = null;
let editingSeriesTitle: string | null = null;
let editingSeriesSavedPattern = "";

document
  .getElementById("apiKeyForm")
  ?.addEventListener("submit", async function (event) {
    event.preventDefault();
    const inputAPIKey = (document.getElementById("apiKey") as HTMLInputElement)
      .value
      .trim();
    await chrome.storage.sync.set({ apiKey: inputAPIKey });
    if (hasJimakuApiKey(inputAPIKey)) {
      await chrome.storage.local.remove(apiKeyAttentionFlagName);
    }
    await setApiKeyInfo();
  });

function hasJimakuApiKey(apiKey: unknown) {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function setMissingApiKeyInfo(messageBeforeLink: string, messageAfterLink = "") {
  const keyInfo = document.querySelector(".key-info")!;
  keyInfo.textContent = "";
  keyInfo.append(`${messageBeforeLink} `);

  const link = document.createElement("a");
  link.href = "https://jimaku.cc/account";
  link.textContent = "jimaku";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  keyInfo.append(link);
  keyInfo.append(messageAfterLink);
}

function setApiKeyAttention(enabled: boolean) {
  const form = document.getElementById("apiKeyForm")!;
  const input = document.getElementById("apiKey") as HTMLInputElement;
  form.classList.toggle("api-key-attention", enabled);
  input.classList.toggle("api-key-attention-field", enabled);
  if (enabled) {
    input.focus();
  }
}

async function consumeApiKeyAttentionRequest() {
  const fromUrl =
    new URLSearchParams(window.location.search).get("highlightApiKey") === "1";
  const result = await chrome.storage.local.get(apiKeyAttentionFlagName);
  if (result[apiKeyAttentionFlagName]) {
    await chrome.storage.local.remove(apiKeyAttentionFlagName);
  }
  return fromUrl || !!result[apiKeyAttentionFlagName];
}

async function setApiKeyInfo() {
  const storageItem = await chrome.storage.sync.get("apiKey");
  const apiKey = storageItem["apiKey"];
  const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
  apiKeyInput.value = typeof apiKey === "string" ? apiKey : "";
  const keyInfo = document.querySelector(".key-info");
  if (!hasJimakuApiKey(apiKey)) {
    setMissingApiKeyInfo(
      "A Jimaku API key is required for this extension. Get one on",
      " then add it here.",
    );
    keyInfo!.classList.remove("set");
    setApiKeyAttention(true);
    return;
  }

  apiKeyInput.value = apiKey.trim();
  keyInfo!.textContent = "API Key set!";
  keyInfo!.classList.add("set");
  setApiKeyAttention(false);
}

async function initializeApiKeyForm() {
  await consumeApiKeyAttentionRequest();
  await setApiKeyInfo();
}
initializeApiKeyForm();

document
  .getElementById("autoDelete")
  ?.addEventListener("change", async function (event) {
    const autoDelete = (event.target as HTMLInputElement).checked;
    await chrome.storage.sync.set({ autoDelete });
  });

document
  .getElementById("disableExtension")
  ?.addEventListener("change", async function (event) {
    const disabled = (event.target as HTMLInputElement).checked;
    await chrome.storage.sync.set({ disabled });
    if (!disabled) {
      await refreshCurrentSubtitles();
    }
  });

async function loadSettings() {
  const settings = await chrome.storage.sync.get(["autoDelete", "disabled"]);
  const storedAutoDelete = settings.autoDelete;
  const autoDelete = storedAutoDelete ?? true;
  const autoDeleteCheckbox = <HTMLInputElement>(
    document.getElementById("autoDelete")
  );
  autoDeleteCheckbox.checked = autoDelete;
  (document.getElementById("disableExtension") as HTMLInputElement).checked =
    !!settings.disabled;
}
loadSettings();

document
  .getElementById("disableSeries")
  ?.addEventListener("change", async function (event) {
    if (!currentAnimeTitle) return;

    const disabled = (event.target as HTMLInputElement).checked;
    const disabledSeries = await loadDisabledSeries();
    if (disabled) {
      disabledSeries[currentAnimeTitle] = true;
    } else {
      delete disabledSeries[currentAnimeTitle];
    }
    await chrome.storage.sync.set({ [disabledSeriesKeyName]: disabledSeries });
  });

document
  .getElementById("subtitlePatternForm")
  ?.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!editingSeriesTitle) return;

    const pattern = (
      document.getElementById("subtitlePattern") as HTMLInputElement
    ).value.trim();
    await saveFilterAndApply(
      pattern,
      pattern ? "Subtitle preference saved." : "Subtitle preference deleted.",
    );
  });

document
  .getElementById("subtitlePattern")
  ?.addEventListener("input", function (event) {
    const pattern = (event.target as HTMLInputElement).value.trim();
    setActiveSourceSuggestion(pattern);
    updateSaveButtonState();
  });

document
  .getElementById("deletePattern")
  ?.addEventListener("click", async function () {
    if (!editingSeriesTitle) return;

    const deletedTitle = editingSeriesTitle;
    await saveSubtitlePattern(deletedTitle, "");
    (document.getElementById("subtitlePattern") as HTMLInputElement).value = "";
    const patterns = await loadSubtitlePatterns();
    const firstSavedSeries = Object.keys(patterns).sort((a, b) =>
      a.localeCompare(b),
    )[0];
    const nextTitle = currentAnimeTitle || firstSavedSeries;
    if (nextTitle) {
      setEditingSeries(nextTitle, patterns);
    } else {
      editingSeriesTitle = null;
      editingSeriesSavedPattern = "";
      setPatternControlsEnabled(false);
    }
    await refreshSavedSeries(editingSeriesTitle);
    await refreshSubtitleSourceSuggestionsForEditingSeries();
    setPatternInfo(`Deleted preference for ${deletedTitle}.`);
  });

document
  .getElementById("savedSeries")
  ?.addEventListener("change", async function (event) {
    const title = (event.target as HTMLSelectElement).value;
    if (!title) return;
    setEditingSeries(title, await loadSubtitlePatterns());
    await refreshSubtitleSourceSuggestionsForEditingSeries();
  });

async function saveSubtitlePattern(title: string, pattern: string) {
  const patterns = await loadSubtitlePatterns();
  if (pattern) {
    patterns[title] = pattern;
  } else {
    delete patterns[title];
  }
  await chrome.storage.sync.set({ [subtitlePatternsKeyName]: patterns });
}

async function loadSubtitlePatterns() {
  const result = await chrome.storage.sync.get(subtitlePatternsKeyName);
  return <SubtitlePatterns>(result[subtitlePatternsKeyName] || {});
}

async function loadDisabledSeries() {
  const result = await chrome.storage.sync.get(disabledSeriesKeyName);
  return <DisabledSeries>(result[disabledSeriesKeyName] || {});
}

async function saveFilterAndApply(pattern: string, savedMessage: string) {
  if (!editingSeriesTitle) return;

  const savedTitle = editingSeriesTitle;
  await saveSubtitlePattern(savedTitle, pattern);
  const patterns = await loadSubtitlePatterns();
  setEditingSeries(savedTitle, patterns);
  await refreshSavedSeries(savedTitle);

  if (savedTitle !== currentAnimeTitle) {
    setPatternInfo(savedMessage);
    return;
  }

  const result = await refreshCurrentSubtitles(true);
  if (result?.refreshed) {
    setPatternInfo(`${savedMessage} Loaded matching subtitle.`);
    return;
  }
  if (result?.alreadyDownloaded) {
    setPatternInfo(`${savedMessage} Selected subtitle is unchanged.`);
    return;
  }
  if (result?.error) {
    setPatternInfo(`${savedMessage} Could not load subtitle: ${result.error}`);
    return;
  }
  setPatternInfo(savedMessage);
}

async function refreshCurrentSubtitles(notifySwitch = false) {
  try {
    return <RefreshCurrentSubtitlesResponse>(
      await chrome.runtime.sendMessage({
        action: "refreshCurrentSubtitles",
        notifySwitch,
      })
    );
  } catch {
    return null;
  }
}

function setJimakuSubtitlesLink(url?: string) {
  const link = document.getElementById("jimakuSubtitleLink") as HTMLAnchorElement;
  link.hidden = !url;
  if (url) {
    link.href = url;
  }
}

async function loadJimakuSubtitlesLink(animeMetaData: AnimeMetaData) {
  setJimakuSubtitlesLink();

  let jimakuLink: JimakuSubtitlesLink | null = null;
  try {
    jimakuLink = <JimakuSubtitlesLink | null>(
      await chrome.runtime.sendMessage({
        action: "getJimakuSubtitlesLink",
        anilistId: animeMetaData.anilistId,
        title: animeMetaData.title,
      })
    );
  } catch {
    jimakuLink = null;
  }

  if (!jimakuLink?.url) {
    setJimakuSubtitlesLink();
    return;
  }

  setJimakuSubtitlesLink(jimakuLink.url);
}

function normalizeSubtitlePattern(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function filenameStem(name: string) {
  return name.replace(/\.(?:srt|ass|zip|sub|sup|idx|rar|7z)$/i, "");
}

function splitFilenameParts(value: string) {
  return value
    .split(/[._\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isEpisodeMarkerPart(part: string) {
  const normalized = normalizeSubtitlePattern(part);
  return (
    /^s\d+e\d+$/i.test(part) ||
    /^e\d{1,3}$/i.test(part) ||
    /^\d{1,3}$/.test(normalized) ||
    /第\s*\d+\s*(?:話|幕|章|回)?/.test(part)
  );
}

function isSpecificEpisodeMarkerPart(part: string) {
  return /^s\d+e\d+$/i.test(part) ||
    /^e\d{1,3}$/i.test(part) ||
    /第\s*\d+\s*(?:話|幕|章|回)?/.test(part);
}

function isEpisodeTitlePart(part: string) {
  return /[《》]/.test(part) || /第\s*\d+\s*(?:話|幕|章|回)?/.test(part);
}

function isReleaseStartPart(part: string) {
  const normalized = normalizeSubtitlePattern(part);
  return (
    /^\d{3,4}p$/.test(normalized) ||
    /^(?:web|web dl|webrip|bdrip|bluray|hdtv|dtv|dvd|aac\d*|flac|opus|hevc|avc|x264|x265|h\s?264|h\s?265)$/.test(
      normalized,
    )
  );
}

function unbracketedReleaseSuggestion(name: string) {
  const parts = splitFilenameParts(filenameStem(name.normalize("NFKC")));
  const episodePartIndex = parts.findIndex(isEpisodeMarkerPart);
  let releaseParts =
    episodePartIndex >= 0 ? parts.slice(episodePartIndex + 1) : parts;

  while (releaseParts.length > 0 && isEpisodeTitlePart(releaseParts[0])) {
    releaseParts = releaseParts.slice(1);
  }

  const releaseStartIndex = releaseParts.findIndex(isReleaseStartPart);
  if (releaseStartIndex >= 0) {
    releaseParts = releaseParts.slice(releaseStartIndex);
  } else if (episodePartIndex >= 0 && releaseParts.length > 0) {
    releaseParts = releaseParts.slice(Math.max(0, releaseParts.length - 4));
  } else {
    return null;
  }

  releaseParts = releaseParts.filter(
    (part) => !isSpecificEpisodeMarkerPart(part),
  );
  if (releaseParts.length === 0) return null;

  const pattern = releaseParts.join(".");
  return { label: pattern, pattern };
}

function sourceSuggestionForSubtitleName(name: string) {
  const leadingBracket = name.normalize("NFKC").match(/^\s*\[([^\]]+)\]/);
  if (leadingBracket) {
    const source = leadingBracket[1].trim();
    return { label: source, pattern: source };
  }

  return unbracketedReleaseSuggestion(name);
}

function subtitleSourceSuggestions(subs: Subs[]) {
  const suggestions = new Map<string, SubtitleSourceSuggestion>();

  for (const sub of subs) {
    const sourceSuggestion = sourceSuggestionForSubtitleName(sub.name);
    if (!sourceSuggestion) continue;

    const key = normalizeSubtitlePattern(sourceSuggestion.pattern);
    const existing = suggestions.get(key);
    if (existing) {
      existing.fileCount += 1;
      continue;
    }

    suggestions.set(key, {
      label: sourceSuggestion.label,
      pattern: sourceSuggestion.pattern,
      fileCount: 1,
    });
  }

  return Array.from(suggestions.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

function setActiveSourceSuggestion(pattern: string) {
  const normalizedPattern = normalizeSubtitlePattern(pattern);
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".source-suggestion"),
  );
  for (const button of buttons) {
    button.classList.toggle(
      "active",
      normalizeSubtitlePattern(button.dataset.pattern || "") ===
        normalizedPattern,
    );
  }
}

function renderSubtitleSourceSuggestions(
  suggestions: SubtitleSourceSuggestion[],
  activePattern: string,
) {
  const container = document.getElementById("sourceSuggestions")!;
  const list = document.getElementById("sourceSuggestionList")!;
  list.textContent = "";

  if (suggestions.length === 0) {
    container.hidden = true;
    return;
  }

  for (const suggestion of suggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-suggestion";
    button.dataset.pattern = suggestion.pattern;
    button.textContent = suggestion.label;
    button.title = `Save filter: ${suggestion.pattern}`;
    button.addEventListener("click", async () => {
      (document.getElementById("subtitlePattern") as HTMLInputElement).value =
        suggestion.pattern;
      setActiveSourceSuggestion(suggestion.pattern);
      await saveFilterAndApply(
        suggestion.pattern,
        `Subtitle preference saved for ${suggestion.label}.`,
      );
    });
    list.append(button);
  }

  container.hidden = false;
  setActiveSourceSuggestion(activePattern);
}

function clearSubtitleSourceSuggestions() {
  renderSubtitleSourceSuggestions([], "");
}

async function loadSubtitleSourceSuggestions(
  title: string,
  anilistId?: number,
  fallbackEpisode?: number,
) {
  clearSubtitleSourceSuggestions();

  try {
    const result = <SeriesSubtitles>(
      await chrome.runtime.sendMessage({
        action: "getSeriesSubtitles",
        anilistId,
        title,
        episode: fallbackEpisode,
      })
    );
    renderSubtitleSourceSuggestions(
      subtitleSourceSuggestions(result.subs || []),
      (document.getElementById("subtitlePattern") as HTMLInputElement).value,
    );
  } catch {
    clearSubtitleSourceSuggestions();
  }
}

async function refreshSubtitleSourceSuggestionsForEditingSeries() {
  if (!editingSeriesTitle) {
    clearSubtitleSourceSuggestions();
    return;
  }

  const currentMetaData =
    currentAnimeMetaData && editingSeriesTitle === currentAnimeMetaData.title
      ? currentAnimeMetaData
      : null;
  await loadSubtitleSourceSuggestions(
    editingSeriesTitle,
    currentMetaData?.anilistId,
    currentMetaData?.episode,
  );
}

function setPatternInfo(text: string) {
  document.getElementById("patternInfo")!.textContent = text;
}

function subtitlePatternInput() {
  return document.getElementById("subtitlePattern") as HTMLInputElement;
}

function savePatternButton() {
  return document.querySelector(
    "#subtitlePatternForm button[type='submit']",
  ) as HTMLButtonElement;
}

function updateSaveButtonState() {
  const subtitlePattern = subtitlePatternInput();
  const pattern = subtitlePattern.value.trim();
  savePatternButton().disabled =
    subtitlePattern.disabled ||
    !editingSeriesTitle ||
    pattern === editingSeriesSavedPattern.trim();
}

function setPatternControlsEnabled(enabled: boolean) {
  const subtitlePattern = subtitlePatternInput();
  subtitlePattern.disabled = !enabled;
  subtitlePattern.placeholder = enabled
    ? ""
    : "Select a series to specify a filter";
  updateSaveButtonState();
  (document.getElementById("deletePattern") as HTMLButtonElement).disabled =
    !enabled;
}

function setEditingSeries(title: string, patterns: SubtitlePatterns) {
  editingSeriesTitle = title;
  editingSeriesSavedPattern = patterns[title] || "";
  subtitlePatternInput().value = editingSeriesSavedPattern;
  setActiveSourceSuggestion(editingSeriesSavedPattern);
  setPatternInfo("");
  setPatternControlsEnabled(true);
  (document.getElementById("deletePattern") as HTMLButtonElement).disabled =
    !patterns[title];
}

async function refreshSavedSeries(selectedTitle: string | null) {
  const patterns = await loadSubtitlePatterns();
  const savedSeries = Object.keys(patterns).sort((a, b) => a.localeCompare(b));
  const select = document.getElementById("savedSeries") as HTMLSelectElement;
  select.textContent = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = savedSeries.length ? "Select saved series" : "No saved series";
  select.append(placeholder);

  for (const title of savedSeries) {
    const option = document.createElement("option");
    option.value = title;
    option.textContent = title;
    option.selected = title === selectedTitle;
    select.append(option);
  }
}

async function loadCurrentAnime() {
  const currentSeries = document.getElementById("currentSeries")!;
  const currentEpisode = document.getElementById("currentEpisode")!;
  currentAnimeTitle = null;
  currentAnimeMetaData = null;
  setPatternControlsEnabled(false);
  clearSubtitleSourceSuggestions();
  await refreshSavedSeries(null);

  let animeMetaData: AnimeMetaData | null = null;
  try {
    animeMetaData = <AnimeMetaData | null>(
      await chrome.runtime.sendMessage({ action: "getCurrentAnimeMetaData" })
    );
  } catch {
    animeMetaData = null;
  }
  if (!animeMetaData) {
    currentSeries.textContent = "No supported series detected";
    currentEpisode.textContent = "No supported episode detected";
    setJimakuSubtitlesLink();
    clearSubtitleSourceSuggestions();
    const patterns = await loadSubtitlePatterns();
    const firstSavedSeries = Object.keys(patterns).sort((a, b) =>
      a.localeCompare(b),
    )[0];
    if (firstSavedSeries) {
      setEditingSeries(firstSavedSeries, patterns);
      await refreshSavedSeries(firstSavedSeries);
      await refreshSubtitleSourceSuggestionsForEditingSeries();
    } else {
      setPatternInfo("Open a supported episode to configure this.");
    }
    return;
  }

  currentAnimeTitle = animeMetaData.title;
  currentAnimeMetaData = animeMetaData;
  currentSeries.textContent = animeMetaData.title;
  currentEpisode.textContent = `Episode ${animeMetaData.episode}`;
  await loadJimakuSubtitlesLink(animeMetaData);
  const disableSeries = document.getElementById(
    "disableSeries",
  ) as HTMLInputElement;
  disableSeries.disabled = false;
  disableSeries.checked = !!(await loadDisabledSeries())[animeMetaData.title];
  const patterns = await loadSubtitlePatterns();
  setEditingSeries(animeMetaData.title, patterns);
  await refreshSavedSeries(animeMetaData.title);
  await refreshSubtitleSourceSuggestionsForEditingSeries();
}

loadCurrentAnime();
