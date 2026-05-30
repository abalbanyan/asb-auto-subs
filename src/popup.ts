import { AnimeMetaData, DisabledSeries, SubtitlePatterns } from "./types";

const subtitlePatternsKeyName = "subtitlePatterns";
const disabledSeriesKeyName = "disabledSeries";
let currentAnimeTitle: string | null = null;
let editingSeriesTitle: string | null = null;

document
  .getElementById("apiKeyForm")
  ?.addEventListener("submit", async function (event) {
    event.preventDefault();
    const inputAPIKey = (document.getElementById("apiKey") as HTMLInputElement)
      .value;
    await chrome.storage.sync.set({ apiKey: inputAPIKey });
    setApiKeyInfo();
  });

async function setApiKeyInfo() {
  const storageItem = await chrome.storage.sync.get("apiKey");
  if (Object.keys(storageItem).length === 0) return;
  (document.getElementById("apiKey") as HTMLInputElement)!.value =
    storageItem["apiKey"];
  const keyInfo = document.querySelector(".key-info");
  keyInfo!.textContent = "API Key set!";
  keyInfo!.classList.add("set");
}
setApiKeyInfo();

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
    const savedTitle = editingSeriesTitle;
    await saveSubtitlePattern(savedTitle, pattern);
    setEditingSeries(savedTitle, await loadSubtitlePatterns());
    await refreshSavedSeries(editingSeriesTitle);
    if (savedTitle === currentAnimeTitle) {
      await refreshCurrentSubtitles();
    }
    setPatternInfo(
      pattern ? "Subtitle preference saved." : "Subtitle preference deleted.",
    );
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
      setEditingSeriesLabel();
      setPatternControlsEnabled(false);
    }
    await refreshSavedSeries(editingSeriesTitle);
    setPatternInfo(`Deleted preference for ${deletedTitle}.`);
  });

document
  .getElementById("useCurrentSeries")
  ?.addEventListener("click", async function () {
    if (!currentAnimeTitle) return;
    setEditingSeries(currentAnimeTitle, await loadSubtitlePatterns());
  });

document
  .getElementById("savedSeries")
  ?.addEventListener("change", async function (event) {
    const title = (event.target as HTMLSelectElement).value;
    if (!title) return;
    setEditingSeries(title, await loadSubtitlePatterns());
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

async function refreshCurrentSubtitles() {
  try {
    await chrome.runtime.sendMessage({ action: "refreshCurrentSubtitles" });
  } catch {
    return;
  }
}

function setPatternInfo(text: string) {
  document.getElementById("patternInfo")!.textContent = text;
}

function setPatternControlsEnabled(enabled: boolean) {
  const subtitlePattern = document.getElementById(
    "subtitlePattern",
  ) as HTMLInputElement;
  subtitlePattern.disabled = !enabled;
  subtitlePattern.placeholder = enabled
    ? ""
    : "Select a series to specify a filter";
  (document.querySelector("#subtitlePatternForm button[type='submit']") as HTMLButtonElement).disabled =
    !enabled;
  (document.getElementById("deletePattern") as HTMLButtonElement).disabled =
    !enabled;
  (document.getElementById("useCurrentSeries") as HTMLButtonElement).disabled =
    !currentAnimeTitle;
}

function setEditingSeriesLabel() {
  document.getElementById("editingSeries")!.textContent = editingSeriesTitle
    ? editingSeriesTitle
    : "none";
}

function setEditingSeries(title: string, patterns: SubtitlePatterns) {
  editingSeriesTitle = title;
  setEditingSeriesLabel();
  (document.getElementById("subtitlePattern") as HTMLInputElement).value =
    patterns[title] || "";
  setPatternInfo(
    patterns[title]
      ? "This series has a saved subtitle preference."
      : "No subtitle preference saved for this series.",
  );
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
  setPatternControlsEnabled(false);
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
    const patterns = await loadSubtitlePatterns();
    const firstSavedSeries = Object.keys(patterns).sort((a, b) =>
      a.localeCompare(b),
    )[0];
    if (firstSavedSeries) {
      setEditingSeries(firstSavedSeries, patterns);
      await refreshSavedSeries(firstSavedSeries);
    } else {
      setPatternInfo("Open a supported episode to configure this.");
    }
    return;
  }

  currentAnimeTitle = animeMetaData.title;
  currentSeries.textContent = animeMetaData.title;
  currentEpisode.textContent = `Episode ${animeMetaData.episode}`;
  const disableSeries = document.getElementById(
    "disableSeries",
  ) as HTMLInputElement;
  disableSeries.disabled = false;
  disableSeries.checked = !!(await loadDisabledSeries())[animeMetaData.title];
  const patterns = await loadSubtitlePatterns();
  setEditingSeries(animeMetaData.title, patterns);
  await refreshSavedSeries(animeMetaData.title);
}

loadCurrentAnime();
